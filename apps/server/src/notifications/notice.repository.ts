import { Injectable } from '@nestjs/common';
import type { DocumentReference, Query, Transaction } from 'firebase-admin/firestore';
import {
  Collections,
  NOTICE_RECIPIENTS,
  RECIPIENT_STATUSES,
  type NoticeRecipientRecord,
  type NoticeRecord,
  type RecipientCounts,
  type RecipientStatus,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/** gRPC status ALREADY_EXISTS, as Firestore reports a `create` of a document that exists. */
const ALREADY_EXISTS = 6;

/**
 * The notices and their recipient records (design §6.8, §11), and the outbox. The only code that knows their paths.
 */
@Injectable()
export class NoticeRepository {
  constructor(private readonly firebase: Firebase) {}

  ref(noticeId: string): DocumentReference {
    return this.firebase.db.collection(Collections.notices).doc(noticeId);
  }

  recipientRef(noticeId: string, accountId: string): DocumentReference {
    return this.ref(noticeId).collection(NOTICE_RECIPIENTS).doc(accountId);
  }

  async find(noticeId: string, tx?: Transaction): Promise<NoticeRecord | null> {
    const snap = tx ? await tx.get(this.ref(noticeId)) : await this.ref(noticeId).get();
    return (snap.data() as NoticeRecord | undefined) ?? null;
  }

  async ofElection(electionId: string): Promise<NoticeRecord[]> {
    const snap = await this.firebase.db.collection(Collections.notices).where('electionId', '==', electionId).get();
    return snap.docs.map((d) => d.data() as NoticeRecord).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Notices whose current round has not finished. */
  async unfinished(): Promise<NoticeRecord[]> {
    const snap = await this.firebase.db.collection(Collections.notices).where('status', 'in', ['preparing', 'sending']).get();
    return snap.docs.map((d) => d.data() as NoticeRecord);
  }

  /**
   * One `pending` recipient record per account, in bulk. Records that exist are left as they are, so a worker that
   * stopped half way through can simply run this again.
   */
  async addRecipients(noticeId: string, accountIds: readonly string[], now: string): Promise<void> {
    const writer = this.firebase.db.bulkWriter();
    writer.onWriteError((e) => e.code !== ALREADY_EXISTS && e.failedAttempts < 5);
    const failures: unknown[] = [];
    for (const accountId of accountIds) {
      const record: NoticeRecipientRecord = {
        accountId,
        status: 'pending',
        round: 1,
        attempts: 0,
        claimedAt: null,
        sentAt: null,
        messageId: null,
        outcome: null,
        updatedAt: now,
      };
      writer.create(this.recipientRef(noticeId, accountId), record).catch((e: { code?: number }) => {
        if (e.code !== ALREADY_EXISTS) failures.push(e);
      });
    }
    await writer.close();
    if (failures.length) throw failures[0];
  }

  /** Up to `limit` recipients a worker may claim in `round`: still to send, or failed in an earlier round. */
  async claimable(noticeId: string, round: number, limit: number): Promise<NoticeRecipientRecord[]> {
    const recipients = this.ref(noticeId).collection(NOTICE_RECIPIENTS);
    const [pending, retry] = await Promise.all([
      recipients.where('status', '==', 'pending').limit(limit).get(),
      round > 1 ? recipients.where('status', '==', 'failed').where('round', '<', round).limit(limit).get() : null,
    ]);
    return [...pending.docs, ...(retry?.docs ?? [])].slice(0, limit).map((d) => d.data() as NoticeRecipientRecord);
  }

  /** Recipients a worker has claimed and not finished, which may have been interrupted. */
  async sending(noticeId: string): Promise<NoticeRecipientRecord[]> {
    const snap = await this.ref(noticeId).collection(NOTICE_RECIPIENTS).where('status', '==', 'sending').get();
    return snap.docs.map((d) => d.data() as NoticeRecipientRecord);
  }

  /** The recipient sent the message with this provider ID, for a bounce report; null if none did. */
  async byMessageId(noticeId: string, messageId: string): Promise<NoticeRecipientRecord | null> {
    const snap = await this.ref(noticeId).collection(NOTICE_RECIPIENTS).where('messageId', '==', messageId).limit(1).get();
    return (snap.docs[0]?.data() as NoticeRecipientRecord | undefined) ?? null;
  }

  /** Recipients by status, counted by Firestore (no record is read). `pending` includes those being sent. */
  async counts(noticeId: string, tx?: Transaction): Promise<RecipientCounts> {
    const count = (status: RecipientStatus) => {
      const query: Query = this.ref(noticeId).collection(NOTICE_RECIPIENTS).where('status', '==', status);
      return (tx ? tx.get(query.count()) : query.count().get()).then((s) => s.data().count);
    };
    const [pending, sending, sent, failed, bounced, skipped] = await Promise.all(RECIPIENT_STATUSES.map(count));
    return { pending: pending! + sending!, sent: sent!, failed: failed!, bounced: bounced!, skipped: skipped! };
  }

  /** Recipients an earlier round failed for, which a resend round tries again. */
  async failedBefore(noticeId: string, round: number, tx: Transaction): Promise<number> {
    const query = this.ref(noticeId).collection(NOTICE_RECIPIENTS).where('status', '==', 'failed').where('round', '<', round);
    return (await tx.get(query.count())).data().count;
  }

  /** Removes an election's notices, their recipient records and its outbox messages (a deleted election, §6.1). */
  async deleteForElection(electionId: string): Promise<void> {
    const db = this.firebase.db;
    const [notices, outbox] = await Promise.all([
      db.collection(Collections.notices).where('electionId', '==', electionId).get(),
      db.collection(Collections.noticeOutbox).where('electionId', '==', electionId).get(),
    ]);
    const writer = db.bulkWriter();
    for (const doc of outbox.docs) void writer.delete(doc.ref);
    for (const doc of notices.docs) await db.recursiveDelete(doc.ref, writer);
    await writer.close();
  }
}
