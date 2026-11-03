import { Injectable } from '@nestjs/common';
import { Timestamp, type DocumentReference, type Query, type Transaction } from 'firebase-admin/firestore';
import {
  Collections,
  MAIL_MESSAGE_RETENTION_DAYS,
  MAIL_SUPPRESSION_DAYS,
  type MailHealthRecord,
  type MailHealthRequest,
  type MailMessageRecord,
  type MailSuppressionRecord,
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

  /** Deletes an account's messages and the suppressions found through its messages (a deleted account, design §4). */
  async forgetAccount(accountId: string): Promise<void> {
    await this.deleteWhere([
      this.firebase.db.collection(Collections.mailMessages).where('accountId', '==', accountId),
      this.firebase.db.collection(Collections.mailSuppressions).where('accountId', '==', accountId),
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
