import { Injectable } from '@nestjs/common';
import { FieldPath, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { Collections, type MemberMatch, type MemberRecord, type MemberStatus, type StatusHistoryRecord } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/** `db.getAll` reads at most this many documents per call. */
const READ_BATCH = 300;

/**
 * Storage of the Member aggregate (design §5.1, §11): `members/{accountId}` and `member_status_history`. Only the
 * membership context uses it; other contexts read members through `MemberDirectory`.
 */
@Injectable()
export class MemberRepository {
  constructor(private readonly firebase: Firebase) {}

  /** The member record, read in `tx`. */
  async get(tx: Transaction, accountId: string): Promise<MemberRecord | null> {
    const snap = await tx.get(this.members().doc(accountId));
    return (snap.data() as MemberRecord | undefined) ?? null;
  }

  async find(accountId: string): Promise<MemberRecord | null> {
    const snap = await this.members().doc(accountId).get();
    return (snap.data() as MemberRecord | undefined) ?? null;
  }

  /** The member record of each account, in order; null where an account has none. */
  async findMany(accountIds: readonly string[]): Promise<(MemberRecord | null)[]> {
    const found: (MemberRecord | null)[] = [];
    for (let i = 0; i < accountIds.length; i += READ_BATCH) {
      const refs = accountIds.slice(i, i + READ_BATCH).map((id) => this.members().doc(id));
      for (const snap of await this.firebase.db.getAll(...refs)) found.push((snap.data() as MemberRecord | undefined) ?? null);
    }
    return found;
  }

  /** The member record of each account, read in `tx`, in order; null where an account has none. */
  async getAll(tx: Transaction, accountIds: readonly string[]): Promise<(MemberRecord | null)[]> {
    if (!accountIds.length) return [];
    const snaps = await tx.getAll(...accountIds.map((id) => this.members().doc(id)));
    return snaps.map((snap) => (snap.data() as MemberRecord | undefined) ?? null);
  }

  /** The accountId of every Active member, read in `tx`, in no particular order. */
  async activeIds(tx: Transaction): Promise<string[]> {
    const active = await tx.get(this.members().where('status', '==', 'active'));
    return active.docs.map((d) => d.id);
  }

  /** Every Active member's names and state, and nothing else (a projection), in no particular order. */
  async activeNames(): Promise<MemberMatch[]> {
    const active = await this.members().where('status', '==', 'active').select('legalName', 'preferredName', 'state').get();
    return active.docs.map((d) => ({
      accountId: d.id,
      legalName: (d.get('legalName') as string | undefined) ?? '',
      preferredName: (d.get('preferredName') as string | null | undefined) ?? null,
      state: (d.get('state') as string | undefined) ?? '',
    }));
  }

  async list(status: MemberStatus | undefined, after: string | undefined, limit: number): Promise<MemberRecord[]> {
    let query = this.members().orderBy(FieldPath.documentId()).limit(limit);
    if (status) query = query.where('status', '==', status);
    if (after) query = query.startAfter(after);
    return (await query.get()).docs.map((d) => d.data() as MemberRecord);
  }

  /** Status history, newest first by ledger sequence number (design §11). */
  async history(accountId: string): Promise<StatusHistoryRecord[]> {
    const snap = await this.firebase.db
      .collection(Collections.memberStatusHistory)
      .where('accountId', '==', accountId)
      .orderBy('ledgerSeq', 'desc')
      .limit(100)
      .get();
    return snap.docs.map((d) => d.data() as StatusHistoryRecord);
  }

  /** The account's member record, if any, and its status history, read in `tx`, for deleting the account (design §4). */
  async refsOf(tx: Transaction, accountId: string): Promise<DocumentReference[]> {
    const [member, history] = await Promise.all([
      tx.get(this.members().doc(accountId)),
      tx.get(this.firebase.db.collection(Collections.memberStatusHistory).where('accountId', '==', accountId).select()),
    ]);
    return [...(member.exists ? [member.ref] : []), ...history.docs.map((d) => d.ref)];
  }

  /** Writes changed details (design §5.2); the status and its history are untouched. */
  update(tx: Transaction, member: MemberRecord): void {
    tx.set(this.members().doc(member.accountId), member);
  }

  /** Writes a status change: the member record and a new history entry. */
  save(tx: Transaction, member: MemberRecord, history: StatusHistoryRecord): void {
    tx.set(this.members().doc(member.accountId), member);
    tx.create(this.firebase.db.collection(Collections.memberStatusHistory).doc(), history);
  }

  private members() {
    return this.firebase.db.collection(Collections.members);
  }
}
