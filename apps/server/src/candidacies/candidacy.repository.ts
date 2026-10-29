import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { Collections, type CandidacyRecord } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/**
 * Storage of candidacies (design §5.8, §11): `candidacies`. Only the candidacies context uses it. Queries are on one
 * field each, so they need no composite index; results are sorted by the caller.
 */
@Injectable()
export class CandidacyRepository {
  constructor(private readonly firebase: Firebase) {}

  private candidacies() {
    return this.firebase.db.collection(Collections.candidacies);
  }

  async all(): Promise<CandidacyRecord[]> {
    return (await this.candidacies().get()).docs.map((d) => d.data() as CandidacyRecord);
  }

  /** The candidacies the public may see, before the member's status is checked. */
  async published(): Promise<CandidacyRecord[]> {
    return (await this.candidacies().where('public', '==', true).get()).docs.map((d) => d.data() as CandidacyRecord);
  }

  async find(candidacyId: string): Promise<CandidacyRecord | null> {
    return ((await this.candidacies().doc(candidacyId).get()).data() as CandidacyRecord | undefined) ?? null;
  }

  async get(tx: Transaction, candidacyId: string): Promise<CandidacyRecord | null> {
    return ((await tx.get(this.candidacies().doc(candidacyId))).data() as CandidacyRecord | undefined) ?? null;
  }

  /** Every candidacy of the member, read in `tx` when given. */
  async of(accountId: string, tx?: Transaction): Promise<CandidacyRecord[]> {
    const query = this.candidacies().where('accountId', '==', accountId);
    return (await (tx ? tx.get(query) : query.get())).docs.map((d) => d.data() as CandidacyRecord);
  }

  create(tx: Transaction, record: CandidacyRecord): void {
    tx.create(this.candidacies().doc(record.candidacyId), record);
  }

  set(tx: Transaction, record: CandidacyRecord): void {
    tx.set(this.candidacies().doc(record.candidacyId), record);
  }
}
