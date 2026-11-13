import { Injectable } from '@nestjs/common';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import {
  Collections,
  MAX_APPLICATIONS_PER_WINDOW,
  type ApplicationQueueSummary,
  type ApplicationRecord,
  type ApplicationStatus,
  type ReferredApplication,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/** Storage of the MembershipApplication aggregate (design §5.2, §11): `applications/{applicationId}`. */
@Injectable()
export class ApplicationRepository {
  constructor(private readonly firebase: Firebase) {}

  newId(): string {
    return this.applications().doc().id;
  }

  /** The application, read in `tx`. */
  async get(tx: Transaction, applicationId: string): Promise<ApplicationRecord | null> {
    const snap = await tx.get(this.applications().doc(applicationId));
    return (snap.data() as ApplicationRecord | undefined) ?? null;
  }

  /** How many applications the account submitted from `since`, read in `tx`; counting stops at the limit. */
  async countSince(tx: Transaction, accountId: string, since: string): Promise<number> {
    const recent = await tx.get(
      this.applications()
        .where('accountId', '==', accountId)
        .where('submittedAt', '>=', since)
        .orderBy('submittedAt', 'desc')
        .limit(MAX_APPLICATIONS_PER_WINDOW),
    );
    return recent.size;
  }

  /** An account's applications, newest first. */
  async ofAccount(accountId: string): Promise<ApplicationRecord[]> {
    const snap = await this.applications().where('accountId', '==', accountId).orderBy('submittedAt', 'desc').limit(20).get();
    return snap.docs.map((d) => d.data() as ApplicationRecord);
  }

  /** Applications in a status, oldest first. */
  async list(status: ApplicationStatus, limit: number): Promise<ApplicationRecord[]> {
    const snap = await this.applications().where('status', '==', status).orderBy('submittedAt').limit(limit).get();
    return snap.docs.map((d) => d.data() as ApplicationRecord);
  }

  /** How many applications wait for a decision, and when the oldest of them was submitted. */
  async queue(): Promise<ApplicationQueueSummary> {
    const pending = this.applications().where('status', '==', 'pending');
    const [count, oldest] = await Promise.all([pending.count().get(), pending.orderBy('submittedAt').limit(1).get()]);
    return {
      pending: count.data().count,
      oldestSubmittedAt: (oldest.docs[0]?.data() as ApplicationRecord | undefined)?.submittedAt ?? null,
    };
  }

  /**
   * The applications that came by a member's referral link (design §5.17), or by `referrer`'s only: who applied, by
   * whose link, and what became of it; no answer.
   */
  async referred(referrer?: string): Promise<ReferredApplication[]> {
    const query = referrer ? this.applications().where('referredBy', '==', referrer) : this.applications().where('referredBy', '>', '');
    const snap = await query.select('accountId', 'referredBy', 'status', 'submittedAt', 'decidedAt').get();
    return snap.docs.map((d) => {
      const a = d.data() as Pick<ApplicationRecord, 'accountId' | 'referredBy' | 'status' | 'submittedAt' | 'decidedAt'>;
      return { accountId: a.accountId, referredBy: a.referredBy!, status: a.status, submittedAt: a.submittedAt, decidedAt: a.decidedAt };
    });
  }

  create(tx: Transaction, application: ApplicationRecord): void {
    tx.create(this.applications().doc(application.applicationId), application);
  }

  /** Writes a decided application; it exists already. */
  save(tx: Transaction, application: ApplicationRecord): void {
    tx.set(this.applications().doc(application.applicationId), application);
  }

  /** Every application of the account, read in `tx`, for deleting the account (design §4). */
  async refsOf(tx: Transaction, accountId: string): Promise<DocumentReference[]> {
    return (await tx.get(this.applications().where('accountId', '==', accountId).select())).docs.map((d) => d.ref);
  }

  private applications() {
    return this.firebase.db.collection(Collections.applications);
  }
}
