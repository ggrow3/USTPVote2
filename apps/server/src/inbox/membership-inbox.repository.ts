import { Injectable } from '@nestjs/common';
import { FieldPath, Timestamp, type DocumentReference, type Query, type Transaction } from 'firebase-admin/firestore';
import {
  Collections,
  INBOX_RETENTION_DAYS,
  MAX_INBOX_CONVERSATION,
  type InboxEmail,
  type InboxStatus,
  type MembershipMessageRecord,
  type MembershipThreadRecord,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

const DAY_MS = 86_400_000;

type Stored<T> = T & { readonly expireAt: Timestamp };

/** Two years after the conversation's last message, for Firestore's TTL policy. */
const expiry = (lastMessageAt: string) => Timestamp.fromMillis(Date.parse(lastMessageAt) + INBOX_RETENTION_DAYS * DAY_MS);

function withoutExpiry<T>(stored: Stored<T> | T): T {
  const { expireAt: _expireAt, ...record } = stored as Stored<T>;
  return record as T;
}

/** Which conversations a page of the shared inbox lists. */
export interface InboxFilter {
  readonly status?: InboxStatus;
  /** One Membership Admin's, or nobody's (null); absent for anyone's. */
  readonly assignedTo?: string | null;
}

/**
 * The membership inbox's records (design §10.13, §11): the conversations between the membership team and each member,
 * and their messages and notes. The only code that knows their paths. A conversation and every message in it are kept
 * two years after its last message (Firestore TTL), so each new message moves its earlier ones' time on too.
 */
@Injectable()
export class MembershipInboxRepository {
  constructor(private readonly firebase: Firebase) {}

  private get db() {
    return this.firebase.db;
  }

  threadRef(threadId?: string): DocumentReference {
    const threads = this.db.collection(Collections.membershipThreads);
    return threadId ? threads.doc(threadId) : threads.doc();
  }

  messageRef(messageId?: string): DocumentReference {
    const messages = this.db.collection(Collections.membershipMessages);
    return messageId ? messages.doc(messageId) : messages.doc();
  }

  async thread(threadId: string, tx?: Transaction): Promise<MembershipThreadRecord | null> {
    const ref = this.threadRef(threadId);
    const snap = tx ? await tx.get(ref) : await ref.get();
    return snap.exists ? withoutExpiry(snap.data() as Stored<MembershipThreadRecord>) : null;
  }

  setThread(tx: Transaction, record: MembershipThreadRecord): void {
    tx.set(this.threadRef(record.threadId), { ...record, expireAt: expiry(record.lastMessageAt) } satisfies Stored<MembershipThreadRecord>);
  }

  /** A message, kept as long as the conversation it is in. */
  createMessage(tx: Transaction, record: MembershipMessageRecord, lastMessageAt: string): void {
    tx.create(this.messageRef(record.messageId), { ...record, expireAt: expiry(lastMessageAt) } satisfies Stored<MembershipMessageRecord>);
  }

  /** Keeps a conversation's earlier messages as long as the conversation, after a new message moved its last one on. */
  async keepMessages(threadId: string, lastMessageAt: string): Promise<void> {
    const snap = await this.db.collection(Collections.membershipMessages).where('threadId', '==', threadId).select().get();
    const writer = this.db.bulkWriter();
    for (const doc of snap.docs) void writer.update(doc.ref, { expireAt: expiry(lastMessageAt) });
    await writer.close();
  }

  /** A conversation's messages and notes, oldest first. */
  async messagesOf(threadId: string): Promise<MembershipMessageRecord[]> {
    const snap = await this.db
      .collection(Collections.membershipMessages)
      .where('threadId', '==', threadId)
      .orderBy('sentAt')
      .limit(MAX_INBOX_CONVERSATION + 10)
      .get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<MembershipMessageRecord>));
  }

  async message(messageId: string, tx?: Transaction): Promise<MembershipMessageRecord | null> {
    const ref = this.messageRef(messageId);
    const snap = tx ? await tx.get(ref) : await ref.get();
    return snap.exists ? withoutExpiry(snap.data() as Stored<MembershipMessageRecord>) : null;
  }

  /** A page of the shared inbox, the latest written to first, after the conversation `after` points at. */
  async page(filter: InboxFilter, after: { lastMessageAt: string; threadId: string } | null, limit: number): Promise<MembershipThreadRecord[]> {
    let query: Query = this.db.collection(Collections.membershipThreads);
    if (filter.status) query = query.where('status', '==', filter.status);
    if (filter.assignedTo !== undefined) query = query.where('assignedTo', '==', filter.assignedTo);
    query = query.orderBy('lastMessageAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    if (after) query = query.startAfter(after.lastMessageAt, after.threadId);
    const snap = await query.limit(limit).get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<MembershipThreadRecord>));
  }

  /** One member's conversations with the team, the latest written to first. */
  async ofMember(accountId: string, limit: number): Promise<MembershipThreadRecord[]> {
    const snap = await this.db
      .collection(Collections.membershipThreads)
      .where('accountId', '==', accountId)
      .orderBy('lastMessageAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<MembershipThreadRecord>));
  }

  /** How many conversations need an answer: in all, and of those assigned to one Membership Admin. Counted by Firestore. */
  async openCounts(accountId: string): Promise<{ open: number; openMine: number }> {
    const open = this.db.collection(Collections.membershipThreads).where('status', '==', 'open');
    const [all, mine] = await Promise.all([open.count().get(), open.where('assignedTo', '==', accountId).count().get()]);
    return { open: all.data().count, openMine: mine.data().count };
  }

  /**
   * How many messages an account wrote on one side since `since`, and conversations it started on that side; read in
   * `tx`, for the day's limits. Counted by Firestore.
   */
  async writtenSince(tx: Transaction, accountId: string, side: 'member' | 'team', since: string): Promise<{ messages: number; started: number }> {
    const [messages, started] = await Promise.all([
      tx.get(
        this.db
          .collection(Collections.membershipMessages)
          .where('authorId', '==', accountId)
          .where('from', '==', side)
          .where('sentAt', '>=', since)
          .count(),
      ),
      tx.get(
        this.db
          .collection(Collections.membershipThreads)
          .where('createdBy', '==', accountId)
          .where('startedBy', '==', side)
          .where('createdAt', '>=', since)
          .count(),
      ),
    ]);
    return { messages: messages.data().count, started: started.data().count };
  }

  // --- the team's emails ----------------------------------------------------------------------------------------------

  /** Team messages whose email the worker has still to send, oldest first. */
  async emailPending(limit: number): Promise<MembershipMessageRecord[]> {
    const snap = await this.db.collection(Collections.membershipMessages).where('emailPending', '==', true).orderBy('sentAt').limit(limit).get();
    return snap.docs.map((d) => withoutExpiry(d.data() as Stored<MembershipMessageRecord>));
  }

  /** Takes a message's email for sending, so no other worker sends it too. False when another took it first. */
  claimEmail(messageId: string): Promise<boolean> {
    const ref = this.messageRef(messageId);
    return this.db.runTransaction(async (tx) => {
      const now = (await tx.get(ref)).data() as MembershipMessageRecord | undefined;
      if (!now?.emailPending) return false;
      tx.update(ref, { emailPending: false });
      return true;
    });
  }

  /** What became of a message's email; `retry` puts it back for the next tick. */
  async setEmail(messageId: string, email: InboxEmail, retry = false): Promise<void> {
    await this.messageRef(messageId).update({ email, emailPending: retry });
  }

  // --- a deleted account (design §4) ----------------------------------------------------------------------------------

  /** Deletes a member's conversations with the team and every message and note in them. Returns the conversations' IDs. */
  async forgetMember(accountId: string): Promise<string[]> {
    const [threads, messages] = await Promise.all([
      this.db.collection(Collections.membershipThreads).where('accountId', '==', accountId).select().get(),
      this.db.collection(Collections.membershipMessages).where('accountId', '==', accountId).select().get(),
    ]);
    const writer = this.db.bulkWriter();
    for (const doc of [...threads.docs, ...messages.docs]) void writer.delete(doc.ref);
    await writer.close();
    return threads.docs.map((d) => d.id);
  }
}
