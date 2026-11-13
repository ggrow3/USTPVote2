import { Injectable } from '@nestjs/common';
import { Timestamp, type DocumentReference, type Query, type Transaction } from 'firebase-admin/firestore';
import {
  APP_NOTIFICATION_RETENTION_DAYS,
  Collections,
  MESSAGE_RETENTION_DAYS,
  blockIdOf,
  type AppNotificationRecord,
  type InboxPreferenceRecord,
  type MemberBlockRecord,
  type MemberMessageRecord,
  type MemberThreadRecord,
  type MessageReportRecord,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

const DAY_MS = 86_400_000;

/** As stored: with the time Firestore's TTL policy deletes it (`expireAt`), which the domain records leave out. */
type Stored<T> = T & { readonly expireAt: Timestamp };

const expiry = (iso: string, days: number) => Timestamp.fromMillis(Date.parse(iso) + days * DAY_MS);

function withoutExpiry<T>(stored: Stored<T> | T): T {
  const { expireAt: _expireAt, ...record } = stored as Stored<T>;
  return record as T;
}

/**
 * The inbox's records (design §10.13, §11): in-app notifications, how each account has them by email, conversations
 * between members, their messages, blocks and reports. The only code that knows their paths. Notifications expire 90
 * days after they last changed; messages and conversations a year after they were last written to, reports a year
 * after they were made.
 */
@Injectable()
export class InboxRepository {
  constructor(private readonly firebase: Firebase) {}

  private get db() {
    return this.firebase.db;
  }

  // --- notifications ------------------------------------------------------------------------------------------------

  notificationRef(notificationId: string): DocumentReference {
    return this.db.collection(Collections.appNotifications).doc(notificationId);
  }

  async notification(notificationId: string, tx?: Transaction): Promise<AppNotificationRecord | null> {
    const ref = this.notificationRef(notificationId);
    const snap = tx ? await tx.get(ref) : await ref.get();
    return snap.exists ? withoutExpiry(snap.data() as Stored<AppNotificationRecord>) : null;
  }

  setNotification(tx: Transaction, record: AppNotificationRecord): void {
    tx.set(this.notificationRef(record.notificationId), { ...record, expireAt: expiry(record.updatedAt, APP_NOTIFICATION_RETENTION_DAYS) } satisfies Stored<AppNotificationRecord>);
  }

  /** An account's latest notifications, newest first. */
  async notificationsOf(accountId: string, limit: number): Promise<AppNotificationRecord[]> {
    const snap = await this.db.collection(Collections.appNotifications).where('accountId', '==', accountId).orderBy('updatedAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<AppNotificationRecord>));
  }

  /** Every account's notifications about one thing. */
  async notificationsAbout(ref: string): Promise<AppNotificationRecord[]> {
    const snap = await this.db.collection(Collections.appNotifications).where('ref', '==', ref).get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<AppNotificationRecord>));
  }

  /** How many of an account's notifications are unread. Counted by Firestore. */
  async unreadCount(accountId: string): Promise<number> {
    const snap = await this.unread(accountId).count().get();
    return snap.data().count;
  }

  private unread(accountId: string): Query {
    return this.db.collection(Collections.appNotifications).where('accountId', '==', accountId).where('readAt', '==', null);
  }

  /** An account's unread notifications that changed after `since`, newest first, at most `limit` (a digest). */
  async unreadSince(accountId: string, since: string, limit: number): Promise<{ records: AppNotificationRecord[]; total: number }> {
    const query = this.unread(accountId).where('updatedAt', '>', since);
    const [snap, total] = await Promise.all([query.orderBy('updatedAt', 'desc').limit(limit).get(), query.count().get()]);
    return { records: snap.docs.map((d) => withoutExpiry(d.data() as Stored<AppNotificationRecord>)), total: total.data().count };
  }

  /** Marks notifications read, in batches; those read already are left as they were. */
  async markRead(records: readonly AppNotificationRecord[], at: string): Promise<void> {
    const writer = this.db.bulkWriter();
    for (const r of records) if (!r.readAt) void writer.update(this.notificationRef(r.notificationId), { readAt: at });
    await writer.close();
  }

  /** Notifications the email step has still to look at, oldest first. */
  async emailPending(limit: number): Promise<AppNotificationRecord[]> {
    const snap = await this.db.collection(Collections.appNotifications).where('emailPending', '==', true).orderBy('updatedAt').limit(limit).get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<AppNotificationRecord>));
  }

  /** Records what the email step did with a notification, unless it changed meanwhile. False when it had. */
  emailDone(record: AppNotificationRecord, emailedAt: string | null): Promise<boolean> {
    const ref = this.notificationRef(record.notificationId);
    return this.db.runTransaction(async (tx) => {
      const now = (await tx.get(ref)).data() as AppNotificationRecord | undefined;
      if (!now?.emailPending || now.createdAt !== record.createdAt) return false;
      tx.update(ref, emailedAt ? { emailPending: false, emailedAt } : { emailPending: false });
      return true;
    });
  }

  /** Puts a claimed notification back for the next tick, since the mail service could not take it just now. */
  async reopenEmail(record: AppNotificationRecord): Promise<void> {
    const ref = this.notificationRef(record.notificationId);
    await this.db.runTransaction(async (tx) => {
      const now = (await tx.get(ref)).data() as AppNotificationRecord | undefined;
      if (now && now.createdAt === record.createdAt && !now.emailedAt) tx.update(ref, { emailPending: true });
    });
  }

  async markEmailed(records: readonly AppNotificationRecord[], at: string): Promise<void> {
    const writer = this.db.bulkWriter();
    for (const r of records) void writer.update(this.notificationRef(r.notificationId), { emailedAt: at, emailPending: false });
    await writer.close();
  }

  // --- notifications by email ---------------------------------------------------------------------------------------

  private preferenceRef(accountId: string): DocumentReference {
    return this.db.collection(Collections.inboxPreferences).doc(accountId);
  }

  async preference(accountId: string, tx?: Transaction): Promise<InboxPreferenceRecord | null> {
    const ref = this.preferenceRef(accountId);
    const snap = tx ? await tx.get(ref) : await ref.get();
    return (snap.data() as InboxPreferenceRecord | undefined) ?? null;
  }

  async preferences(accountIds: readonly string[]): Promise<Map<string, InboxPreferenceRecord>> {
    const snaps = accountIds.length ? await this.db.getAll(...accountIds.map((id) => this.preferenceRef(id))) : [];
    return new Map(snaps.flatMap((s) => (s.exists ? [[s.id, s.data() as InboxPreferenceRecord] as const] : [])));
  }

  setPreference(tx: Transaction, record: InboxPreferenceRecord): void {
    tx.set(this.preferenceRef(record.accountId), record);
  }

  /** Digests due by `now`, earliest first. */
  async digestsDue(now: string, limit: number): Promise<InboxPreferenceRecord[]> {
    const snap = await this.db.collection(Collections.inboxPreferences).where('digestDueAt', '<=', now).orderBy('digestDueAt').limit(limit).get();
    return snap.docs.map((d) => d.data() as InboxPreferenceRecord);
  }

  /**
   * Moves a digest on to its next time, in a transaction, before it is sent, so two workers never both send it. False
   * when another worker moved it, or the member changed their choice meanwhile.
   */
  claimDigest(due: InboxPreferenceRecord, next: string | null, now: string): Promise<boolean> {
    const ref = this.preferenceRef(due.accountId);
    return this.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as InboxPreferenceRecord | undefined;
      if (current?.digestDueAt !== due.digestDueAt || current.notificationEmail !== due.notificationEmail) return false;
      tx.update(ref, { digestDueAt: next, digestSentAt: now });
      return true;
    });
  }

  // --- conversations ------------------------------------------------------------------------------------------------

  threadRef(threadId: string): DocumentReference {
    return this.db.collection(Collections.memberThreads).doc(threadId);
  }

  messageRef(messageId?: string): DocumentReference {
    const messages = this.db.collection(Collections.memberMessages);
    return messageId ? messages.doc(messageId) : messages.doc();
  }

  async thread(threadId: string, tx?: Transaction): Promise<MemberThreadRecord | null> {
    const ref = this.threadRef(threadId);
    const snap = tx ? await tx.get(ref) : await ref.get();
    return snap.exists ? withoutExpiry(snap.data() as Stored<MemberThreadRecord>) : null;
  }

  setThread(tx: Transaction, record: MemberThreadRecord): void {
    tx.set(this.threadRef(record.threadId), { ...record, expireAt: expiry(record.lastMessageAt, MESSAGE_RETENTION_DAYS) });
  }

  createMessage(tx: Transaction, record: MemberMessageRecord): void {
    tx.create(this.messageRef(record.messageId), { ...record, expireAt: expiry(record.sentAt, MESSAGE_RETENTION_DAYS) } satisfies Stored<MemberMessageRecord>);
  }

  async message(messageId: string, tx?: Transaction): Promise<MemberMessageRecord | null> {
    const ref = this.messageRef(messageId);
    const snap = tx ? await tx.get(ref) : await ref.get();
    return snap.exists ? withoutExpiry(snap.data() as Stored<MemberMessageRecord>) : null;
  }

  markMessageReported(tx: Transaction, messageId: string, at: string): void {
    tx.update(this.messageRef(messageId), { reportedAt: at });
  }

  /** An account's conversations, the latest written to first. */
  async threadsOf(accountId: string, limit: number): Promise<MemberThreadRecord[]> {
    const snap = await this.db.collection(Collections.memberThreads).where('members', 'array-contains', accountId).orderBy('lastMessageAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<MemberThreadRecord>));
  }

  /** A conversation's messages before `before` (or the latest), newest first, at most `limit`. */
  async messagesOf(threadId: string, before: string | null, limit: number): Promise<MemberMessageRecord[]> {
    let query = this.db.collection(Collections.memberMessages).where('threadId', '==', threadId).orderBy('sentAt', 'desc');
    if (before) query = query.where('sentAt', '<', before);
    const snap = await query.limit(limit).get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<MemberMessageRecord>));
  }

  /** How many messages an account sent, and conversations it started, since `since`; read in `tx`. Counted by Firestore. */
  async sentSince(tx: Transaction, accountId: string, since: string): Promise<{ messages: number; started: number }> {
    const [messages, started] = await Promise.all([
      tx.get(this.db.collection(Collections.memberMessages).where('from', '==', accountId).where('sentAt', '>=', since).count()),
      tx.get(this.db.collection(Collections.memberThreads).where('createdBy', '==', accountId).where('createdAt', '>=', since).count()),
    ]);
    return { messages: messages.data().count, started: started.data().count };
  }

  // --- blocks -------------------------------------------------------------------------------------------------------

  private blockRef(blockerId: string, blockedId: string): DocumentReference {
    return this.db.collection(Collections.memberBlocks).doc(blockIdOf(blockerId, blockedId));
  }

  async blocks(tx: Transaction | undefined, pairs: readonly (readonly [string, string])[]): Promise<boolean[]> {
    const refs = pairs.map(([a, b]) => this.blockRef(a, b));
    const snaps = tx ? await tx.getAll(...refs) : await this.db.getAll(...refs);
    return snaps.map((s) => s.exists);
  }

  /** Those an account has blocked. */
  async blockedBy(accountId: string): Promise<Set<string>> {
    const snap = await this.db.collection(Collections.memberBlocks).where('blockerId', '==', accountId).get();
    return new Set(snap.docs.map((d) => (d.data() as MemberBlockRecord).blockedId));
  }

  async setBlock(record: MemberBlockRecord): Promise<void> {
    await this.blockRef(record.blockerId, record.blockedId).set(record);
  }

  async deleteBlock(blockerId: string, blockedId: string): Promise<void> {
    await this.blockRef(blockerId, blockedId).delete();
  }

  // --- reports ------------------------------------------------------------------------------------------------------

  reportRef(reportId?: string): DocumentReference {
    const reports = this.db.collection(Collections.messageReports);
    return reportId ? reports.doc(reportId) : reports.doc();
  }

  createReport(tx: Transaction, record: MessageReportRecord): void {
    tx.create(this.reportRef(record.reportId), { ...record, expireAt: expiry(record.createdAt, MESSAGE_RETENTION_DAYS) } satisfies Stored<MessageReportRecord>);
  }

  async report(reportId: string, tx?: Transaction): Promise<MessageReportRecord | null> {
    const ref = this.reportRef(reportId);
    const snap = tx ? await tx.get(ref) : await ref.get();
    return snap.exists ? withoutExpiry(snap.data() as Stored<MessageReportRecord>) : null;
  }

  updateReport(tx: Transaction, reportId: string, fields: Partial<MessageReportRecord>): void {
    tx.update(this.reportRef(reportId), fields);
  }

  /** The latest reports, newest first. */
  async reports(limit: number): Promise<MessageReportRecord[]> {
    const snap = await this.db.collection(Collections.messageReports).orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<MessageReportRecord>));
  }

  // --- a deleted account (design §4) --------------------------------------------------------------------------------

  /** Deletes every account's notifications about these things (conversations that are gone). */
  async deleteNotificationsAbout(refs: readonly string[]): Promise<void> {
    if (!refs.length) return;
    const found = await Promise.all(refs.map((ref) => this.db.collection(Collections.appNotifications).where('ref', '==', ref).select().get()));
    const writer = this.db.bulkWriter();
    for (const snap of found) for (const doc of snap.docs) void writer.delete(doc.ref);
    await writer.close();
  }

  /**
   * Deletes everything of an account's in the inbox: its notifications and preference, its conversations with every
   * message in them (the other member's too, since a conversation is the two of theirs), its blocks either way, and
   * the reports of its messages or by it.
   */
  async forgetAccount(accountId: string): Promise<void> {
    const threads = await this.db.collection(Collections.memberThreads).where('members', 'array-contains', accountId).select().get();
    const queries: Query[] = [
      this.db.collection(Collections.appNotifications).where('accountId', '==', accountId),
      this.db.collection(Collections.memberBlocks).where('blockerId', '==', accountId),
      this.db.collection(Collections.memberBlocks).where('blockedId', '==', accountId),
      this.db.collection(Collections.messageReports).where('from', '==', accountId),
      this.db.collection(Collections.messageReports).where('reportedBy', '==', accountId),
      ...threads.docs.map((t) => this.db.collection(Collections.memberMessages).where('threadId', '==', t.id)),
      // The other member's notifications about those conversations lead nowhere now.
      ...threads.docs.map((t) => this.db.collection(Collections.appNotifications).where('ref', '==', t.id)),
    ];
    const found = await Promise.all(queries.map((q) => q.select().get()));
    // A notification can be found both as the account's and by its conversation.
    const refs = new Map([threads, ...found].flatMap((snap) => snap.docs.map((d) => [d.ref.path, d.ref] as const)));
    refs.set(this.preferenceRef(accountId).path, this.preferenceRef(accountId));
    const writer = this.db.bulkWriter();
    for (const ref of refs.values()) void writer.delete(ref);
    await writer.close();
  }
}
