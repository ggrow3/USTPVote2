import { randomBytes } from 'node:crypto';
import { newSalt, seedCommitment, type BallotPart } from 'ustp-audit';
import {
  buildDefinition,
  definitionHash,
  proposalContentHash,
  rollMerkleRoot,
  sortRoll,
  uuidv7,
  type CandidateRecord,
  type ContestRecord,
  type ElectionRecord,
  type ElectionState,
  type ProposalSnapshotRecord,
  type RollSnapshotRecord,
  type Secrecy,
} from 'ustp-domain';
import type { DocumentReference } from 'firebase-admin/firestore';
import { ElectionReader } from '../elections/election-reader.js';
import { EmulatorSecretStore } from '../infra/secret-store.js';
import type { TestApi } from './emulator.js';

/** Election fixtures for integration tests that vote and seal. */

export const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' as const }, base: 'yes_no' as const };

export interface SeededElection {
  readonly electionId: string;
  /** `/v1/elections/{id}` */
  readonly url: string;
  readonly ref: DocumentReference;
  /** Kept in the emulator secret store, as scheduling keeps it; the worker reveals it at tally. */
  readonly tieBreakSeed: string;
}

/**
 * Writes an election as scheduling would leave it (frozen definition hash, approved roll of `voters`), in any state,
 * with a proposal contest `plank` and a ranked contest `chair` (candidates `alex`, `blair`). Scheduling itself is
 * covered in scheduling.int.test.ts; this lets tests choose the voting window freely.
 */
export async function seedElection(
  api: TestApi,
  opts: {
    readonly voters: readonly string[];
    readonly secrecy?: Secrecy;
    readonly state?: ElectionState;
    readonly opensAt?: string;
    readonly closesAt?: string;
    readonly kAnonymity?: number;
    /** Defaults to the stored seed's; set it to publish a commitment the seed does not match. */
    readonly tieBreakSeedCommitment?: string;
  },
): Promise<SeededElection> {
  const db = api.firebase.db;
  const electionId = uuidv7();
  const now = new Date().toISOString();
  const tieBreakSeed = randomBytes(32).toString('hex');
  const tieBreakSeedRef = await new EmulatorSecretStore(db).create(`tiebreak-seed-${electionId}`, tieBreakSeed);
  const body = 'The party supports the right to repair.';
  const proposal: ProposalSnapshotRecord = {
    snapshotId: `p-${electionId}`,
    title: 'Plank 12',
    body,
    source: null,
    contentHash: proposalContentHash('Plank 12', body),
    capturedAt: now,
    capturedBy: 'seed',
  };
  const contests: ContestRecord[] = [
    {
      contestId: 'plank',
      order: 1,
      title: 'Plank 12',
      description: '',
      spec: { kind: 'proposal', id: 'plank', passRule: MAJORITY },
      proposalSnapshotId: proposal.snapshotId,
    },
    {
      contestId: 'chair',
      order: 2,
      title: 'Chair',
      description: '',
      spec: { kind: 'irv', id: 'chair', candidates: ['alex', 'blair'] },
      proposalSnapshotId: null,
    },
  ];
  const candidates: CandidateRecord[] = [
    { candidateId: 'alex', contestId: 'chair', name: 'Alex Rivera', statement: null, accountId: null },
    { candidateId: 'blair', contestId: 'chair', name: 'Blair Chen', statement: null, accountId: null },
  ];
  const accountIds = sortRoll(opts.voters);
  const roll: RollSnapshotRecord = {
    snapshotId: `r-${electionId}`,
    electionId,
    criteria: { status: 'active' },
    asOf: now,
    accountIds,
    count: accountIds.length,
    merkleRoot: rollMerkleRoot(electionId, accountIds),
    status: 'approved',
    requestedBy: 'seed',
    requestedAt: now,
    approvalId: 'seed',
    decidedBy: 'seed',
    decidedAt: now,
    signature: null,
  };
  const unhashed: ElectionRecord = {
    electionId,
    title: 'Officers',
    description: '',
    secrecy: opts.secrecy ?? 'secret',
    opensAt: opts.opensAt ?? minutes(-1),
    closesAt: opts.closesAt ?? minutes(60),
    kAnonymity: opts.kAnonymity ?? 2,
    state: opts.state ?? 'scheduled',
    createdBy: 'seed',
    createdAt: now,
    updatedAt: now,
    definitionHash: null,
    rollSnapshotId: roll.snapshotId,
    tieBreakSeedCommitment: opts.tieBreakSeedCommitment ?? seedCommitment(tieBreakSeed),
    tieBreakSeedRef,
    scheduledAt: now,
    cancelledAt: null,
    poolKeyVersion: null,
    openedAt: null,
    closedAt: null,
    sealedAt: null,
  };
  const election = { ...unhashed, definitionHash: definitionHash(buildDefinition(unhashed, contests, candidates, [proposal])) };
  const ref = db.collection('elections').doc(electionId);
  await Promise.all([
    db.collection('proposal_snapshots').doc(proposal.snapshotId).set(proposal),
    db.collection('eligibility_snapshots').doc(roll.snapshotId).set(roll),
    ref.set(election),
    ...contests.map((c) => ref.collection('contests').doc(c.contestId).set(c)),
    ...candidates.map((k) => ref.collection('candidates').doc(k.candidateId).set(k)),
  ]);
  return { electionId, url: `/v1/elections/${electionId}`, ref, tieBreakSeed };
}

/**
 * Ends voting now, for tests that do not wait for `closesAt`. The window is part of the frozen definition, so the hash
 * is re-frozen over the new one, as if the election had been scheduled to close now; the tally refuses a definition
 * that no longer hashes to `definitionHash`.
 */
export async function closeNow(api: TestApi, election: SeededElection): Promise<void> {
  await election.ref.update({ closesAt: minutes(-1) });
  const { definition } = await new ElectionReader(api.firebase).load(election.electionId);
  await election.ref.update({ definitionHash: definitionHash(definition) });
}

/** A complete ballot for a seeded election: yes on the plank, Blair then Alex for chair (unless `chair` says otherwise). */
export function seededBallot(
  electionId: string,
  plank: 'yes' | 'no' | 'abstain' = 'yes',
  chair: readonly string[] = ['blair', 'alex'],
): BallotPart[] {
  return [
    { v: 1, electionId, contestId: 'plank', selection: plank, salt: newSalt() },
    { v: 1, electionId, contestId: 'chair', selection: chair, salt: newSalt() },
  ];
}

/** The ledger entry types recorded about one election, in order. */
export async function ledgerTypes(api: TestApi, electionId: string): Promise<string[]> {
  const snap = await api.firebase.db.collection('audit_events').where('subject', '==', electionId).orderBy('seq').get();
  return snap.docs.map((d) => d.data().type as string);
}
