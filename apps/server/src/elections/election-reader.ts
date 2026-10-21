import { Injectable, NotFoundException } from '@nestjs/common';
import type { Query, Transaction } from 'firebase-admin/firestore';
import {
  buildDefinition,
  Collections,
  ElectionCollections,
  type CandidateRecord,
  type ContestRecord,
  type ElectionDefinition,
  type ElectionRecord,
  type ProposalSnapshotRecord,
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
}
