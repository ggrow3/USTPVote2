import { Injectable } from '@nestjs/common';
import { FieldValue, Timestamp, type Query, type Transaction } from 'firebase-admin/firestore';
import {
  Collections,
  newsletterExpiry,
  type NewsletterLimitsRecord,
  type NewsletterStatus,
  type NewsletterSubscriberRecord,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/** A record as stored: one waiting for confirmation also has the time Firestore's TTL policy deletes it. */
type Stored = NewsletterSubscriberRecord & { readonly expireAt?: Timestamp };

const strip = (data: Stored): NewsletterSubscriberRecord => {
  const { expireAt: _expires, ...record } = data;
  return record;
};

/** Addresses read in one `getAll`. */
const BATCH = 300;

/**
 * The newsletter's list and its sign-up limits (design §10.15): `newsletter_subscribers` and `newsletter_limits`. The
 * only code that knows their paths.
 */
@Injectable()
export class NewsletterRepository {
  constructor(private readonly firebase: Firebase) {}

  private subscribers() {
    return this.firebase.db.collection(Collections.newsletterSubscribers);
  }

  private limitsRef(day: string) {
    return this.firebase.db.collection(Collections.newsletterLimits).doc(day);
  }

  /** The record of an address (by `mailAddressKey`), read in `tx` when given. */
  async byAddress(addressKey: string, tx?: Transaction): Promise<NewsletterSubscriberRecord | null> {
    const query = this.subscribers().where('addressKey', '==', addressKey).limit(1);
    const snap = tx ? await tx.get(query) : await query.get();
    return snap.docs[0] ? strip(snap.docs[0].data() as Stored) : null;
  }

  async find(subscriberId: string): Promise<NewsletterSubscriberRecord | null> {
    const snap = await this.subscribers().doc(subscriberId).get();
    return snap.exists ? strip(snap.data() as Stored) : null;
  }

  async byConfirmHash(hash: string): Promise<NewsletterSubscriberRecord | null> {
    const snap = await this.subscribers().where('confirmTokenHash', '==', hash).limit(1).get();
    return snap.docs[0] ? strip(snap.docs[0].data() as Stored) : null;
  }

  async byUnsubscribeToken(token: string): Promise<NewsletterSubscriberRecord | null> {
    const snap = await this.subscribers().where('unsubscribeToken', '==', token).limit(1).get();
    return snap.docs[0] ? strip(snap.docs[0].data() as Stored) : null;
  }

  /**
   * Writes a record. One waiting for confirmation gets its expiry (`NEWSLETTER_PENDING_DAYS` after it was last asked
   * for); a confirmed one has none, so it stays until its owner unsubscribes.
   */
  save(tx: Transaction, record: NewsletterSubscriberRecord): void {
    const expireAt = record.status === 'pending' ? Timestamp.fromDate(newsletterExpiry(record)) : FieldValue.delete();
    tx.set(this.subscribers().doc(record.subscriberId), { ...record, expireAt }, { merge: true });
  }

  /** Reads one record in `tx`. */
  async get(tx: Transaction, subscriberId: string): Promise<NewsletterSubscriberRecord | null> {
    const snap = await tx.get(this.subscribers().doc(subscriberId));
    return snap.exists ? strip(snap.data() as Stored) : null;
  }

  /** Deletes a record, and with it the address. False when there was none. */
  async delete(subscriberId: string): Promise<boolean> {
    const ref = this.subscribers().doc(subscriberId);
    return this.firebase.db.runTransaction(async (tx) => {
      if (!(await tx.get(ref)).exists) return false;
      tx.delete(ref);
      return true;
    });
  }

  /** Those whose confirmation email waits for the worker, oldest request first. */
  async confirmationsDue(limit: number): Promise<NewsletterSubscriberRecord[]> {
    const snap = await this.subscribers().where('confirmDue', '==', true).limit(limit).get();
    return snap.docs.map((d) => strip(d.data() as Stored)).sort((a, b) => a.confirmRequestedAt.localeCompare(b.confirmRequestedAt));
  }

  /** Every confirmed subscriber, for an email to the list. */
  async confirmed(): Promise<NewsletterSubscriberRecord[]> {
    const snap = await this.subscribers().where('status', '==', 'confirmed').get();
    return snap.docs.map((d) => strip(d.data() as Stored));
  }

  /** How many have each status, counted by Firestore; and how many confirmed since `since`. */
  async counts(since: string): Promise<Record<NewsletterStatus, number> & { readonly confirmedSince: number }> {
    const count = (q: Query) =>
      q
        .count()
        .get()
        .then((s) => s.data().count);
    const [confirmed, pending, confirmedSince] = await Promise.all([
      count(this.subscribers().where('status', '==', 'confirmed')),
      count(this.subscribers().where('status', '==', 'pending')),
      count(this.subscribers().where('confirmedAt', '>=', since)),
    ]);
    return { confirmed, pending, confirmedSince };
  }

  /** Of these subscribers, the ones whose record still says confirmed, by ID. */
  async stillConfirmed(subscriberIds: readonly string[]): Promise<Map<string, NewsletterSubscriberRecord>> {
    const found = new Map<string, NewsletterSubscriberRecord>();
    for (let i = 0; i < subscriberIds.length; i += BATCH) {
      const snaps = await this.firebase.db.getAll(...subscriberIds.slice(i, i + BATCH).map((id) => this.subscribers().doc(id)));
      for (const snap of snaps) {
        const record = snap.exists ? strip(snap.data() as Stored) : null;
        if (record?.status === 'confirmed') found.set(record.subscriberId, record);
      }
    }
    return found;
  }

  // --- the sign-up form's limits ----------------------------------------------------------------------------------

  async getLimits(tx: Transaction, day: string): Promise<NewsletterLimitsRecord | null> {
    return ((await tx.get(this.limitsRef(day))).data() as NewsletterLimitsRecord | undefined) ?? null;
  }

  setLimits(tx: Transaction, record: NewsletterLimitsRecord): void {
    tx.set(this.limitsRef(record.day), record);
  }

  /** Deletes the limits (with their salts) of days before `keepFrom`. */
  async deleteLimitsBefore(keepFrom: string): Promise<number> {
    const old = await this.firebase.db.collection(Collections.newsletterLimits).where('day', '<', keepFrom).get();
    await Promise.all(old.docs.map((d) => d.ref.delete()));
    return old.size;
  }
}
