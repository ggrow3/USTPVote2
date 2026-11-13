import { Injectable, NotFoundException } from '@nestjs/common';
import type { Query, Transaction } from 'firebase-admin/firestore';
import {
  buildDefinition,
  Collections,
  ElectionCollections,
  isRehearsalRoll,
  type CandidateRecord,
  type ContestRecord,
  type ElectionDefinition,
  type ElectionRecord,
  type ElectionState,
  type PositionRecord,
  type ProposalSnapshotRecord,
  type RollSnapshotRecord,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

export interface LoadedElection {
  readonly election: ElectionRecord;
  readonly contests: ContestRecord[];
  readonly candidates: CandidateRecord[];
  readonly proposals: ProposalSnapshotRecord[];
  readonly definition: ElectionDefinition;
}

/** Reads an election and everything its definition is built from, inside a transaction when one is given. */
@Injectable()
export class ElectionReader {
  constructor(private readonly firebase: Firebase) {}

  async load(electionId: string, tx?: Transaction): Promise<LoadedElection> {
    const db = this.firebase.db;
    const ref = db.collection(Collections.elections).doc(electionId);
    const query = (q: Query) => (tx ? tx.get(q) : q.get());
    const [electionSnap, contestSnap, candidateSnap] = await Promise.all([
      tx ? tx.get(ref) : ref.get(),
      query(ref.collection(ElectionCollections.contests)),
      query(ref.collection(ElectionCollections.candidates)),
    ]);
    if (!electionSnap.exists) throw new NotFoundException('no such election');
    const election = electionSnap.data() as ElectionRecord;
    const contests = contestSnap.docs.map((d) => d.data() as ContestRecord).sort((a, b) => a.order - b.order);
    const candidates = candidateSnap.docs.map((d) => d.data() as CandidateRecord);
    const proposalRefs = [...new Set(contests.map((c) => c.proposalSnapshotId).filter((id): id is string => !!id))].map((id) =>
      db.collection(Collections.proposalSnapshots).doc(id),
    );
    const proposalSnaps = proposalRefs.length ? await (tx ? tx.getAll(...proposalRefs) : db.getAll(...proposalRefs)) : [];
    const proposals = proposalSnaps.filter((s) => s.exists).map((s) => s.data() as ProposalSnapshotRecord);
    return { election, contests, candidates, proposals, definition: buildDefinition(election, contests, candidates, proposals) };
  }

  async find(electionId: string, tx?: Transaction): Promise<ElectionRecord | null> {
    const ref = this.firebase.db.collection(Collections.elections).doc(electionId);
    return (((tx ? await tx.get(ref) : await ref.get()).data() as ElectionRecord | undefined) ?? null);
  }

  /** Every election in `state`, for the worker's steps. */
  async inState(state: ElectionState): Promise<ElectionRecord[]> {
    const snap = await this.firebase.db.collection(Collections.elections).where('state', '==', state).get();
    return snap.docs.map((d) => d.data() as ElectionRecord);
  }

  /**
   * Certified elections other than rehearsals (design §10.4), whose results stay public for good: what the sitemap
   * lists (§15). A rehearsal is known by its roll, of which only the criteria are read.
   */
  async certifiedResults(): Promise<{ electionId: string; certifiedAt: string | null }[]> {
    const db = this.firebase.db;
    const snap = await db.collection(Collections.elections).where('state', '==', 'certified').select('certifiedAt', 'rollSnapshotId').get();
    const elections = snap.docs.map((d) => ({ electionId: d.id, ...(d.data() as Pick<ElectionRecord, 'certifiedAt' | 'rollSnapshotId'>) }));
    const rollIds = [...new Set(elections.map((e) => e.rollSnapshotId).filter((id): id is string => !!id))];
    const rolls = rollIds.length
      ? await db.getAll(...rollIds.map((id) => db.collection(Collections.eligibilitySnapshots).doc(id)), { fieldMask: ['criteria'] })
      : [];
    const rehearsals = new Set(rolls.filter((r) => isRehearsalRoll((r.data() as RollSnapshotRecord | undefined)?.criteria)).map((r) => r.id));
    return elections
      .filter((e) => !e.rollSnapshotId || !rehearsals.has(e.rollSnapshotId))
      .map(({ electionId, certifiedAt }) => ({ electionId, certifiedAt }))
      .sort((a, b) => (b.certifiedAt ?? '').localeCompare(a.certifiedAt ?? ''));
  }

  /** The roll the election points at (approved before scheduling, design §6.3), or null for none. */
  async approvedRoll(election: Pick<ElectionRecord, 'rollSnapshotId'>): Promise<RollSnapshotRecord | null> {
    if (!election.rollSnapshotId) return null;
    const snap = await this.firebase.db.collection(Collections.eligibilitySnapshots).doc(election.rollSnapshotId).get();
    return (snap.data() as RollSnapshotRecord | undefined) ?? null;
  }

  /**
   * Who on the roll has voted (participation records, never how), for the reminder to those who have not (design
   * §6.8). With `among`, only those of them; otherwise everyone.
   */
  async voted(electionId: string, among?: readonly string[]): Promise<Set<string>> {
    const participation = this.firebase.db.collection(Collections.elections).doc(electionId).collection(ElectionCollections.participation);
    if (among) {
      const snaps = among.length ? await this.firebase.db.getAll(...among.map((id) => participation.doc(id)), { fieldMask: ['castAt'] }) : [];
      return new Set(snaps.filter((s) => s.exists).map((s) => s.id));
    }
    return new Set((await participation.select().get()).docs.map((d) => d.id));
  }

  /** How many have voted in the election, counted by Firestore. */
  async voterCount(electionId: string): Promise<number> {
    const participation = this.firebase.db.collection(Collections.elections).doc(electionId).collection(ElectionCollections.participation);
    return (await participation.count().get()).data().count;
  }

  /** Who has voted since `from`, by the participation records' `castAt` (vote confirmations, design §6.8). */
  async votedSince(electionId: string, from: string): Promise<string[]> {
    const participation = this.firebase.db.collection(Collections.elections).doc(electionId).collection(ElectionCollections.participation);
    return (await participation.where('castAt', '>=', from).select().get()).docs.map((d) => d.id);
  }

  /** When each of these accounts voted, those who have (vote confirmations say when, never how). */
  async castTimes(electionId: string, accountIds: readonly string[]): Promise<Map<string, string>> {
    const participation = this.firebase.db.collection(Collections.elections).doc(electionId).collection(ElectionCollections.participation);
    const snaps = accountIds.length ? await this.firebase.db.getAll(...accountIds.map((id) => participation.doc(id)), { fieldMask: ['castAt'] }) : [];
    return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, s.get('castAt') as string]));
  }

  /** The offices the contests fill (design §6.4), for the advisories and the election setup check (§6.9). */
  async positions(contests: readonly { readonly positionId?: string | null }[]): Promise<PositionRecord[]> {
    const db = this.firebase.db;
    const ids = [...new Set(contests.map((c) => c.positionId).filter((id): id is string => !!id))];
    if (!ids.length) return [];
    const snaps = await db.getAll(...ids.map((id) => db.collection(Collections.positions).doc(id)));
    return snaps.filter((s) => s.exists).map((s) => s.data() as PositionRecord);
  }

  /** Whether the account stands as a candidate in the election (recusal, design §10.1). */
  async isCandidate(tx: Transaction, electionId: string, accountId: string): Promise<boolean> {
    const standing = await tx.get(
      this.firebase.db
        .collection(Collections.elections)
        .doc(electionId)
        .collection(ElectionCollections.candidates)
        .where('accountId', '==', accountId)
        .limit(1),
    );
    return !standing.empty;
  }

  /**
   * Whether the account is on any election's roll (a snapshot an Auditor has not rejected: pending, approved or
   * superseded) or has voted in one, so is never deleted (design §4).
   */
  async inAnyElection(accountId: string, tx?: Transaction): Promise<boolean> {
    const db = this.firebase.db;
    const rolls = db.collection(Collections.eligibilitySnapshots).where('accountIds', 'array-contains', accountId).select('status');
    const elections = db.collection(Collections.elections).select();
    const [onRolls, all] = await Promise.all([tx ? tx.get(rolls) : rolls.get(), tx ? tx.get(elections) : elections.get()]);
    if (onRolls.docs.some((s) => (s.get('status') as RollSnapshotRecord['status']) !== 'rejected')) return true;
    const refs = all.docs.map((e) => e.ref.collection(ElectionCollections.participation).doc(accountId));
    if (!refs.length) return false;
    const found = tx ? await tx.getAll(...refs) : await db.getAll(...refs);
    return found.some((s) => s.exists);
  }
}
