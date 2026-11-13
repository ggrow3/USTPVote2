import { Injectable } from '@nestjs/common';
import { Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import {
  BROADCAST_RECIPIENT_RETENTION_DAYS,
  broadcastRecipientKey,
  Collections,
  type BroadcastCounts,
  type BroadcastRecipientRecord,
  type BroadcastRecord,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

const DAY_MS = 86_400_000;

/** Emails admins wrote to members, and each member's copy (design §10.12). The only code that knows their paths, bar an account's deletion. */
@Injectable()
export class BroadcastRepository {
  constructor(private readonly firebase: Firebase) {}

  ref(broadcastId?: string): DocumentReference {
    const all = this.firebase.db.collection(Collections.broadcasts);
    return broadcastId ? all.doc(broadcastId) : all.doc();
  }

  /** A copy's document: `key` is the account, or `s-` and the newsletter subscriber (`broadcastRecipientKey`). */
  private recipientRef(broadcastId: string, key: string): DocumentReference {
    return this.firebase.db.collection(Collections.broadcastRecipients).doc(`${broadcastId}_${key}`);
  }

  async find(broadcastId: string, tx?: Transaction): Promise<BroadcastRecord | null> {
    const snap = tx ? await tx.get(this.ref(broadcastId)) : await this.ref(broadcastId).get();
    return (snap.data() as BroadcastRecord | undefined) ?? null;
  }

  /** Those the worker has still to prepare or send. */
  async unfinished(tx?: Transaction): Promise<BroadcastRecord[]> {
    const query = this.firebase.db.collection(Collections.broadcasts).where('status', 'in', ['preparing', 'sending']);
    const snap = tx ? await tx.get(query) : await query.get();
    return snap.docs.map((d) => d.data() as BroadcastRecord);
  }

  /** Those waiting for a System Admin's approval, or still to prepare or send: one at a time (design §10.12). */
  async open(tx?: Transaction): Promise<BroadcastRecord[]> {
    const query = this.firebase.db.collection(Collections.broadcasts).where('status', 'in', ['awaiting_approval', 'preparing', 'sending']);
    const snap = tx ? await tx.get(query) : await query.get();
    return snap.docs.map((d) => d.data() as BroadcastRecord);
  }

  async latest(limit: number): Promise<BroadcastRecord[]> {
    const snap = await this.firebase.db.collection(Collections.broadcasts).orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => d.data() as BroadcastRecord);
  }

  update(broadcastId: string, fields: Partial<BroadcastRecord>): Promise<unknown> {
    return this.ref(broadcastId).update(fields);
  }

  /**
   * A copy to send for each account, and for each newsletter subscriber (design §10.15). Run again after an interrupted
   * preparation, before any has been sent.
   */
  async addRecipients(broadcastId: string, accountIds: readonly string[], at: string, subscriberIds: readonly string[] = []): Promise<void> {
    const expireAt = Timestamp.fromMillis(Date.parse(at) + BROADCAST_RECIPIENT_RETENTION_DAYS * DAY_MS);
    const writer = this.firebase.db.bulkWriter();
    const copies: BroadcastRecipientRecord[] = [
      ...accountIds.map((accountId) => ({ broadcastId, accountId, status: 'pending' as const, outcome: null, messageId: null, attempts: 0, claimedAt: null, updatedAt: at })),
      ...subscriberIds.map((subscriberId) => ({ broadcastId, accountId: null, subscriberId, status: 'pending' as const, outcome: null, messageId: null, attempts: 0, claimedAt: null, updatedAt: at })),
    ];
    for (const record of copies) void writer.set(this.recipientRef(broadcastId, broadcastRecipientKey(record)), { ...record, expireAt });
    await writer.close();
  }

  private ofStatus(broadcastId: string, status: BroadcastRecipientRecord['status']) {
    return this.firebase.db.collection(Collections.broadcastRecipients).where('broadcastId', '==', broadcastId).where('status', '==', status);
  }

  async pending(broadcastId: string, limit: number): Promise<BroadcastRecipientRecord[]> {
    const snap = await this.ofStatus(broadcastId, 'pending').limit(limit).get();
    return snap.docs.map((d) => d.data() as BroadcastRecipientRecord);
  }

  async sending(broadcastId: string): Promise<BroadcastRecipientRecord[]> {
    const snap = await this.ofStatus(broadcastId, 'sending').get();
    return snap.docs.map((d) => d.data() as BroadcastRecipientRecord);
  }

  /** Claims a copy for sending in a transaction, so overlapping ticks never both send it. False when another did. */
  claim(broadcastId: string, key: string, now: Date): Promise<BroadcastRecipientRecord | null> {
    const ref = this.recipientRef(broadcastId, key);
    return this.firebase.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as BroadcastRecipientRecord | undefined;
      if (current?.status !== 'pending') return null;
      const at = now.toISOString();
      const claimed = { ...current, status: 'sending' as const, attempts: current.attempts + 1, claimedAt: at, updatedAt: at };
      tx.update(ref, { status: claimed.status, attempts: claimed.attempts, claimedAt: at, updatedAt: at });
      return claimed;
    });
  }

  finish(broadcastId: string, key: string, fields: Partial<BroadcastRecipientRecord>): Promise<unknown> {
    return this.recipientRef(broadcastId, key).update({ ...fields, claimedAt: null, updatedAt: new Date().toISOString() });
  }

  /** How its copies stand, and what the mail service reported of those it took. Counted by Firestore; no record is read. */
  async counts(broadcastId: string): Promise<BroadcastCounts> {
    const count = (status: BroadcastRecipientRecord['status']) =>
      this.ofStatus(broadcastId, status)
        .count()
        .get()
        .then((s) => s.data().count);
    const messages = this.firebase.db.collection(Collections.mailMessages).where('ref', '==', broadcastId);
    const reported = (status: string) =>
      messages
        .where('status', '==', status)
        .count()
        .get()
        .then((s) => s.data().count);
    const [pending, sending, sent, skipped, failed, delivered, bounced, complained] = await Promise.all([
      count('pending'),
      count('sending'),
      count('sent'),
      count('skipped'),
      count('failed'),
      reported('delivered'),
      reported('bounced'),
      reported('complained'),
    ]);
    return { pending: pending + sending, sent, skipped, failed, delivered, bounced, complained };
  }
}
