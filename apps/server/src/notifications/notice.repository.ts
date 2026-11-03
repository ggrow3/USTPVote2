import { Injectable } from '@nestjs/common';
import type { DocumentReference, Query, Transaction } from 'firebase-admin/firestore';
import {
  Collections,
  NOTICE_RECIPIENTS,
  RECIPIENT_STATUSES,
  type NoticeRecipientRecord,
  type NoticeRecord,
  type NoticeTestRecord,
  type ReceiptCounts,
  type RecipientCounts,
  type RecipientStatus,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/** gRPC status ALREADY_EXISTS, as Firestore reports a `create` of a document that exists. */
const ALREADY_EXISTS = 6;

/**
 * The notices and their recipient records (design §6.8, §11), the send receipts, the test emails, and the outbox. The
 * only code that knows their paths.
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

  /** Notices whose last round has finished. */
  async done(): Promise<NoticeRecord[]> {
    const snap = await this.firebase.db.collection(Collections.notices).where('status', '==', 'done').get();
    return snap.docs.map((d) => d.data() as NoticeRecord);
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

  /** Recipients by status, counted by Firestore (no record is read). `pending` includes those being sent. */
  async counts(noticeId: string, tx?: Transaction): Promise<RecipientCounts> {
    const count = (status: RecipientStatus) => {
      const query: Query = this.ref(noticeId).collection(NOTICE_RECIPIENTS).where('status', '==', status);
      return (tx ? tx.get(query.count()) : query.count().get()).then((s) => s.data().count);
    };
    const n = Object.fromEntries(
      await Promise.all(RECIPIENT_STATUSES.map(async (status) => [status, await count(status)] as const)),
    ) as Record<RecipientStatus, number>;
    const { pending, sending, ...rest } = n;
    return { ...rest, pending: pending + sending };
  }

  /** How many recipient records the notice has. */
  async total(noticeId: string): Promise<number> {
    return (await this.ref(noticeId).collection(NOTICE_RECIPIENTS).count().get()).data().count;
  }

  /** Recipients an earlier round failed for, which a resend round tries again. */
  async failedBefore(noticeId: string, round: number, tx: Transaction): Promise<number> {
    const query = this.ref(noticeId).collection(NOTICE_RECIPIENTS).where('status', '==', 'failed').where('round', '<', round);
    return (await tx.get(query.count())).data().count;
  }

  // --- receipts and test emails -----------------------------------------------------------------------------------

  /** A receipt's reference; a new one, with a fresh ID for the receipt to carry, when none is given. */
  receiptRef(receiptId?: string): DocumentReference {
    const receipts = this.firebase.db.collection(Collections.noticeReceipts);
    return receiptId ? receipts.doc(receiptId) : receipts.doc();
  }

  /** The election's receipts as counts, without reading their message IDs. */
  async receiptCounts(electionId: string): Promise<ReceiptCounts[]> {
    const fields: (keyof ReceiptCounts)[] = ['kind', 'test', 'accepted', 'failed', 'skipped', 'finishedAt'];
    const snap = await this.firebase.db
      .collection(Collections.noticeReceipts)
      .where('electionId', '==', electionId)
      .select(...fields)
      .get();
    return snap.docs.map((d) => d.data() as ReceiptCounts);
  }

  /** A test email's reference; a new one when none is given. */
  testRef(testId?: string): DocumentReference {
    const tests = this.firebase.db.collection(Collections.noticeTests);
    return testId ? tests.doc(testId) : tests.doc();
  }

  /** The test emails of an election that went, or go, to this account, newest first. */
  async testsTo(electionId: string, accountId: string, tx?: Transaction): Promise<NoticeTestRecord[]> {
    const query = this.firebase.db.collection(Collections.noticeTests).where('electionId', '==', electionId);
    const snap = tx ? await tx.get(query) : await query.get();
    return snap.docs
      .map((d) => d.data() as NoticeTestRecord)
      .filter((t) => t.accountId === accountId)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  /** Test emails the worker has still to send, or has claimed (some of which may have been interrupted). */
  async unfinishedTests(limit: number): Promise<NoticeTestRecord[]> {
    const snap = await this.firebase.db.collection(Collections.noticeTests).where('status', 'in', ['pending', 'sending']).limit(limit).get();
    return snap.docs.map((d) => d.data() as NoticeTestRecord);
  }

  /**
   * Removes an election's notices, their recipient records, its receipts, its test emails and its outbox messages (a
   * deleted election, §6.1).
   */
  async deleteForElection(electionId: string): Promise<void> {
    const db = this.firebase.db;
    const ofElection = (collection: string) => db.collection(collection).where('electionId', '==', electionId).get();
    const [notices, outbox, receipts, tests] = await Promise.all([
      ofElection(Collections.notices),
      ofElection(Collections.noticeOutbox),
      ofElection(Collections.noticeReceipts),
      ofElection(Collections.noticeTests),
    ]);
    const writer = db.bulkWriter();
    for (const doc of [...outbox.docs, ...receipts.docs, ...tests.docs]) void writer.delete(doc.ref);
    for (const doc of notices.docs) await db.recursiveDelete(doc.ref, writer);
    await writer.close();
  }
}
