import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { Collections, MAX_APPLICATIONS_PER_WINDOW, type ApplicationRecord, type ApplicationStatus } from 'ustp-domain';
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

  /** The account's own applications, newest first. */
  async mine(accountId: string): Promise<ApplicationRecord[]> {
    const snap = await this.applications().where('accountId', '==', accountId).orderBy('submittedAt', 'desc').limit(20).get();
    return snap.docs.map((d) => d.data() as ApplicationRecord);
  }

  /** Applications in a status, oldest first. */
  async list(status: ApplicationStatus, limit: number): Promise<ApplicationRecord[]> {
    const snap = await this.applications().where('status', '==', status).orderBy('submittedAt').limit(limit).get();
    return snap.docs.map((d) => d.data() as ApplicationRecord);
  }

  create(tx: Transaction, application: ApplicationRecord): void {
    tx.create(this.applications().doc(application.applicationId), application);
  }

  /** Writes a decided application; it exists already. */
  save(tx: Transaction, application: ApplicationRecord): void {
    tx.set(this.applications().doc(application.applicationId), application);
  }

  private applications() {
    return this.firebase.db.collection(Collections.applications);
  }
}
