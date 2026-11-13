import { Injectable } from '@nestjs/common';
import { FieldPath, Timestamp, type DocumentReference, type Query, type Transaction } from 'firebase-admin/firestore';
import {
  Collections,
  MAIL_LOG_PAGE,
  MAIL_LOG_SCAN,
  type MailDayRecord,
  MAIL_MESSAGE_RETENTION_DAYS,
  mailLogBounds,
  mailLogCursor,
  mailLogIndex,
  matchesMailLog,
  type MailLogQuery,
  MAIL_SUPPRESSION_DAYS,
  type MailPreferenceRecord,
  type MailHealthRecord,
  type MailHealthRequest,
  MAIL_REQUEST_RETENTION_DAYS,
  type MailMessageRecord,
  type MailRequestRecord,
  type MailSuppressionRecord,
  WELCOME_LINK_MATCH_MINUTES,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

const DAY_MS = 86_400_000;

/** A run of the setup check another worker started this recently is left to finish. */
const HEALTH_RUN_CLAIM_MS = 2 * 60_000;

/** As stored: with the time Firestore's TTL policy deletes it (`expireAt`), which the domain records leave out. */
type Stored<T> = T & { readonly expireAt: Timestamp };

/**
 * The messages the mail service took and what their delivery reports said, the addresses not to mail (design §6.8,
 * §11), and the email setup check's runs (§10.12). The only code that knows their paths. Messages and suppressions
 * expire by Firestore TTL: a message 180 days after it was sent, a suppression a year after its last report.
 */
@Injectable()
export class MailRepository {
  constructor(private readonly firebase: Firebase) {}

  messageRef(messageId: string): DocumentReference {
    return this.firebase.db.collection(Collections.mailMessages).doc(messageId);
  }

  suppressionRef(addressKey: string): DocumentReference {
    return this.firebase.db.collection(Collections.mailSuppressions).doc(addressKey);
  }

  async message(messageId: string, tx?: Transaction): Promise<MailMessageRecord | null> {
    const snap = tx ? await tx.get(this.messageRef(messageId)) : await this.messageRef(messageId).get();
    return snap.exists ? withoutExpiry(snap.data() as Stored<MailMessageRecord>) : null;
  }

  async suppression(addressKey: string, tx?: Transaction): Promise<MailSuppressionRecord | null> {
    const snap = tx ? await tx.get(this.suppressionRef(addressKey)) : await this.suppressionRef(addressKey).get();
    return snap.exists ? withoutExpiry(snap.data() as Stored<MailSuppressionRecord>) : null;
  }

  /** Records a message the worker just sent. */
  async create(record: MailMessageRecord): Promise<void> {
    await this.messageRef(record.messageId).create(storedMessage(record));
  }

  setMessage(tx: Transaction, record: MailMessageRecord): void {
    tx.set(this.messageRef(record.messageId), storedMessage(record));
  }

  setSuppression(tx: Transaction, record: MailSuppressionRecord): void {
    tx.set(this.suppressionRef(record.addressKey), {
      ...record,
      expireAt: Timestamp.fromMillis(Date.parse(record.lastEventAt) + MAIL_SUPPRESSION_DAYS * DAY_MS),
    } satisfies Stored<MailSuppressionRecord>);
  }

  /** An account's messages sent since `since`, newest first, at most `limit` (the member's own list, §10.12). */
  async messagesOf(accountId: string, since: string, limit: number): Promise<MailMessageRecord[]> {
    const snap = await this.firebase.db
      .collection(Collections.mailMessages)
      .where('accountId', '==', accountId)
      .where('sentAt', '>=', since)
      .orderBy('sentAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<MailMessageRecord>));
  }

  /**
   * An account's messages sent from `WELCOME_LINK_MATCH_MINUTES` before `at` on, for matching a welcome sign-in link to
   * Identity Platform's report of it (§5.13); the caller keeps those near enough (`nearestWelcomeLink`).
   */
  messagesNear(accountId: string, at: string): Promise<MailMessageRecord[]> {
    return this.messagesOf(accountId, new Date(Date.parse(at) - WELCOME_LINK_MATCH_MINUTES * 60_000).toISOString(), 20);
  }

  deleteMessage(tx: Transaction, messageId: string): void {
    tx.delete(this.messageRef(messageId));
  }

  /**
   * A page of the email log (§10.12), newest first: read in Firestore by the query's most selective field and its days,
   * the other fields applied to what comes back, until the page is full, the log ends, or `MAIL_LOG_SCAN` records have
   * been read. `after` is where the last page stopped.
   */
  async log(query: MailLogQuery, after: { sentAt: string; messageId: string } | null): Promise<{ records: MailMessageRecord[]; next: string | null; scanLimited: boolean }> {
    const index = mailLogIndex(query);
    const value = { accountId: query.account, causedBy: query.causedBy, kind: query.kind, status: query.status };
    let base: Query = this.firebase.db.collection(Collections.mailMessages);
    if (index) base = base.where(index, '==', value[index]);
    const [from, to] = mailLogBounds(query);
    if (from) base = base.where('sentAt', '>=', from);
    if (to) base = base.where('sentAt', '<', to);
    base = base.orderBy('sentAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    // Filters beyond the one read by in Firestore can pass few of the records, so read more at a time then.
    const batch = Object.values(value).filter(Boolean).length > 1 ? MAIL_LOG_PAGE * 4 : MAIL_LOG_PAGE;
    const records: MailMessageRecord[] = [];
    let last = after;
    let scanned = 0;
    let ended = false;
    while (records.length < MAIL_LOG_PAGE && scanned < MAIL_LOG_SCAN) {
      const limit = Math.min(batch, MAIL_LOG_SCAN - scanned);
      const snap = await (last ? base.startAfter(last.sentAt, last.messageId) : base).limit(limit).get();
      for (const doc of snap.docs) {
        scanned++;
        const record = withoutExpiry(doc.data() as Stored<MailMessageRecord>);
        last = { sentAt: record.sentAt, messageId: doc.id };
        if (matchesMailLog(record, query) && records.push(record) === MAIL_LOG_PAGE) break;
      }
      if (snap.size < limit) {
        ended = records.length < MAIL_LOG_PAGE || snap.docs[snap.size - 1]?.id === last?.messageId;
        break;
      }
    }
    return { records, next: ended || !last ? null : mailLogCursor(last), scanLimited: !ended && records.length < MAIL_LOG_PAGE };
  }

  /** How many messages were sent from `start` up to (not including) `end`, counted by Firestore: no record is read. */
  async countBetween(start: string, end: string): Promise<number> {
    const snap = await this.firebase.db.collection(Collections.mailMessages).where('sentAt', '>=', start).where('sentAt', '<', end).count().get();
    return snap.data().count;
  }

  /**
   * The messages sent from `start` up to (not including) `end`, at most `limit`, the earliest first: only the fields the
   * daily counts read (§10.12).
   */
  async between(start: string, end: string, limit: number): Promise<MailDayRecord[]> {
    const snap = await this.firebase.db
      .collection(Collections.mailMessages)
      .where('sentAt', '>=', start)
      .where('sentAt', '<', end)
      .select('accountId', 'to', 'kind', 'status')
      .limit(limit)
      .get();
    return snap.docs.map((d) => {
      const { accountId, to, kind, status } = d.data() as MailDayRecord;
      return { accountId: accountId ?? null, to: to ?? null, kind, status };
    });
  }

  /** Suppressions found through an account's message, for the Membership Admins' flags (§10.12). */
  async suppressionsOfAccounts(): Promise<MailSuppressionRecord[]> {
    const snap = await this.firebase.db.collection(Collections.mailSuppressions).where('accountId', '!=', null).get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<MailSuppressionRecord>));
  }

  /** Of these addresses (`mailAddressKey`), the ones not to mail. */
  async suppressedAmong(addressKeys: readonly string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < addressKeys.length; i += 300) {
      const snaps = await this.firebase.db.getAll(...addressKeys.slice(i, i + 300).map((key) => this.suppressionRef(key)));
      for (const snap of snaps) if (snap.exists) found.add(snap.id);
    }
    return found;
  }

  /** Takes an address off the app's list of addresses not to mail (its owner asked to try it again). */
  async deleteSuppression(addressKey: string): Promise<void> {
    await this.suppressionRef(addressKey).delete();
  }

  // --- who gets no email (§10.12) -------------------------------------------------------------------------------------

  private preferenceRef(accountId: string): DocumentReference {
    return this.firebase.db.collection(Collections.mailPreferences).doc(accountId);
  }

  async preference(accountId: string, tx?: Transaction): Promise<MailPreferenceRecord | null> {
    const snap = tx ? await tx.get(this.preferenceRef(accountId)) : await this.preferenceRef(accountId).get();
    return (snap.data() as MailPreferenceRecord | undefined) ?? null;
  }

  async preferenceByToken(token: string): Promise<MailPreferenceRecord | null> {
    const snap = await this.firebase.db.collection(Collections.mailPreferences).where('token', '==', token).limit(1).get();
    return (snap.docs[0]?.data() as MailPreferenceRecord | undefined) ?? null;
  }

  setPreference(tx: Transaction, record: MailPreferenceRecord): void {
    tx.set(this.preferenceRef(record.accountId), record);
  }

  /** Accounts that unsubscribed or that an admin stopped email to. */
  async stoppedPreferences(): Promise<MailPreferenceRecord[]> {
    const preferences = this.firebase.db.collection(Collections.mailPreferences);
    const [unsubscribed, stopped] = await Promise.all([preferences.where('unsubscribedAt', '>', '').get(), preferences.where('stoppedAt', '>', '').get()]);
    const found = new Map<string, MailPreferenceRecord>();
    for (const doc of [...unsubscribed.docs, ...stopped.docs]) found.set(doc.id, doc.data() as MailPreferenceRecord);
    return [...found.values()];
  }

  // --- members' requests (§10.12) -------------------------------------------------------------------------------------

  requestRef(requestId?: string): DocumentReference {
    const requests = this.firebase.db.collection(Collections.mailRequests);
    return requestId ? requests.doc(requestId) : requests.doc();
  }

  createRequest(tx: Transaction, record: MailRequestRecord): void {
    const expireAt = Timestamp.fromMillis(Date.parse(record.requestedAt) + MAIL_REQUEST_RETENTION_DAYS * DAY_MS);
    tx.create(this.requestRef(record.requestId), { ...record, expireAt } satisfies Stored<MailRequestRecord>);
  }

  /** An account's requests, newest first. */
  async requestsOf(accountId: string, tx?: Transaction): Promise<MailRequestRecord[]> {
    const query = this.firebase.db.collection(Collections.mailRequests).where('accountId', '==', accountId);
    const snap = tx ? await tx.get(query) : await query.get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<MailRequestRecord>)).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  /** Requests the worker has still to do, or has claimed. */
  async unfinishedRequests(limit: number): Promise<MailRequestRecord[]> {
    const snap = await this.firebase.db.collection(Collections.mailRequests).where('status', 'in', ['pending', 'sending']).limit(limit).get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<MailRequestRecord>));
  }

  /** System Admins' test emails the worker has still to do, or has claimed, which go even while all email is off. */
  async unfinishedAdminTests(): Promise<MailRequestRecord[]> {
    const snap = await this.firebase.db.collection(Collections.mailRequests).where('kind', '==', 'admin_test').get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<MailRequestRecord>)).filter((r) => r.status !== 'done');
  }

  /** Moves a request on from `from` in a transaction; false when it is no longer there, as another worker moved it. */
  moveRequest(requestId: string, from: MailRequestRecord['status'], next: Partial<MailRequestRecord>): Promise<boolean> {
    const ref = this.requestRef(requestId);
    return this.firebase.db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).get('status') !== from) return false;
      tx.update(ref, next);
      return true;
    });
  }

  /** When the last message Identity Platform sent through SES was sent, for the setup check (§10.12). */
  async lastIdentityMail(): Promise<string | null> {
    const snap = await this.firebase.db
      .collection(Collections.mailMessages)
      .where('sender', '==', 'identity_platform')
      .orderBy('sentAt', 'desc')
      .limit(1)
      .select('sentAt')
      .get();
    return (snap.docs[0]?.get('sentAt') as string | undefined) ?? null;
  }

  /** Messages by ID, those missing left out (the setup check's probe). */
  async messages(messageIds: readonly string[]): Promise<MailMessageRecord[]> {
    if (!messageIds.length) return [];
    const snaps = await this.firebase.db.getAll(...messageIds.map((id) => this.messageRef(id)));
    return snaps.filter((s) => s.exists).map((s) => withoutExpiry(s.data() as Stored<MailMessageRecord>));
  }

  /**
   * How many messages counted toward the rates were sent since `since`, how many of them bounced for good, and how many
   * were marked as spam (§10.12). Counted by Firestore; no record is read.
   */
  async rates(since: string): Promise<{ sent: number; bounced: number; complained: number }> {
    const sent = this.firebase.db.collection(Collections.mailMessages).where('counted', '==', true).where('sentAt', '>=', since);
    const count = (q: Query) => q.count().get().then((s) => s.data().count);
    const [all, bounced, complained] = await Promise.all([
      count(sent),
      count(sent.where('bounce.type', '==', 'permanent')),
      count(sent.where('status', '==', 'complained')),
    ]);
    return { sent: all, bounced, complained };
  }

  // --- the setup check (§10.12) -------------------------------------------------------------------------------------

  private healthRef(doc: 'current' | 'request' | 'run'): DocumentReference {
    return this.firebase.db.collection(Collections.mailHealth).doc(doc);
  }

  async health(tx?: Transaction): Promise<MailHealthRecord | null> {
    const snap = tx ? await tx.get(this.healthRef('current')) : await this.healthRef('current').get();
    return (snap.data() as MailHealthRecord | undefined) ?? null;
  }

  async healthRequest(tx?: Transaction): Promise<MailHealthRequest | null> {
    const snap = tx ? await tx.get(this.healthRef('request')) : await this.healthRef('request').get();
    return (snap.data() as MailHealthRequest | undefined) ?? null;
  }

  setHealthRequest(tx: Transaction, request: MailHealthRequest): void {
    tx.set(this.healthRef('request'), request);
  }

  /** Claims a run of the check, so overlapping ticks never both run it. False when another worker has it. */
  claimHealthRun(now: Date): Promise<boolean> {
    const ref = this.healthRef('run');
    return this.firebase.db.runTransaction(async (tx) => {
      const startedAt = (await tx.get(ref)).get('startedAt') as string | undefined;
      if (startedAt && Date.parse(startedAt) > now.getTime() - HEALTH_RUN_CLAIM_MS) return false;
      tx.set(ref, { startedAt: now.toISOString() });
      return true;
    });
  }

  /** Saves a run, and marks the request it answered done. */
  async saveHealth(record: MailHealthRecord, answered: MailHealthRequest | null): Promise<void> {
    const batch = this.firebase.db.batch();
    batch.set(this.healthRef('current'), record);
    if (answered) batch.set(this.healthRef('request'), { ...answered, status: 'done' } satisfies MailHealthRequest);
    await batch.commit();
  }

  /** Deletes an account's messages, the suppressions found through them, its requests and its preference (a deleted account, design §4). */
  async forgetAccount(accountId: string): Promise<void> {
    await this.deleteWhere([
      this.firebase.db.collection(Collections.mailMessages).where('accountId', '==', accountId),
      this.firebase.db.collection(Collections.mailSuppressions).where('accountId', '==', accountId),
      this.firebase.db.collection(Collections.mailRequests).where('accountId', '==', accountId),
      this.firebase.db.collection(Collections.mailPreferences).where('accountId', '==', accountId),
      this.firebase.db.collection(Collections.broadcastRecipients).where('accountId', '==', accountId),
    ]);
  }

  /** Deletes the records of a deleted election's messages (design §6.1). */
  async forgetElection(electionId: string): Promise<void> {
    await this.deleteWhere([this.firebase.db.collection(Collections.mailMessages).where('electionId', '==', electionId)]);
  }

  private async deleteWhere(queries: readonly Query[]): Promise<void> {
    const found = await Promise.all(queries.map((q) => q.select().get()));
    const writer = this.firebase.db.bulkWriter();
    for (const snap of found) for (const doc of snap.docs) void writer.delete(doc.ref);
    await writer.close();
  }
}

function storedMessage(record: MailMessageRecord): Stored<MailMessageRecord> {
  return { ...record, expireAt: Timestamp.fromMillis(Date.parse(record.sentAt) + MAIL_MESSAGE_RETENTION_DAYS * DAY_MS) };
}

function withoutExpiry<T>(stored: Stored<T>): T {
  const { expireAt: _expireAt, ...record } = stored;
  return record as T;
}
