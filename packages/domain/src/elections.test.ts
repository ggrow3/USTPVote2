import { describe, expect, it } from 'vitest';
import { contestInputSchema, createElectionSchema } from './election-api.js';
import {
  buildDefinition,
  definitionHash,
  proposalContentHash,
  validateDefinition,
  type CandidateRecord,
  type ContestRecord,
  type ElectionRecord,
  type ProposalSnapshotRecord,
} from './elections.js';

const now = new Date('2026-10-20T12:00:00Z');

const election: ElectionRecord = {
  electionId: 'e1',
  title: '2026 Officer Election',
  description: '',
  secrecy: 'secret',
  opensAt: '2026-11-01T00:00:00Z',
  closesAt: '2026-11-08T00:00:00Z',
  kAnonymity: 10,
  state: 'draft',
  createdBy: 'ea',
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  definitionHash: null,
  rollSnapshotId: null,
  tieBreakSeedCommitment: null,
  tieBreakSeedRef: null,
  scheduledAt: null,
  cancelledAt: null,
  poolKeyVersion: null,
  openedAt: null,
  closedAt: null,
};

const proposal: ProposalSnapshotRecord = {
  snapshotId: 'p1',
  title: 'Platform plank 12',
  body: 'Text',
  source: null,
  contentHash: proposalContentHash('Platform plank 12', 'Text'),
  capturedAt: now.toISOString(),
  capturedBy: 'ea',
};

const contests: ContestRecord[] = [
  {
    contestId: 'chair',
    order: 2,
    title: 'Chair',
    description: '',
    spec: { kind: 'irv', id: 'chair', candidates: ['b', 'a'] },
    proposalSnapshotId: null,
  },
  {
    contestId: 'plank12',
    order: 1,
    title: 'Plank 12',
    description: '',
    spec: {
      kind: 'proposal',
      id: 'plank12',
      passRule: { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' },
    },
    proposalSnapshotId: 'p1',
  },
];

const candidates: CandidateRecord[] = [
  { candidateId: 'a', contestId: 'chair', name: 'Alex', statement: null, accountId: null },
  { candidateId: 'b', contestId: 'chair', name: 'Blair', statement: null, accountId: null },
];

describe('election definition', () => {
  it('orders contests by position and candidates as the contest lists them', () => {
    const def = buildDefinition(election, contests, candidates, [proposal]);
    expect(def.contests.map((c) => c.contestId)).toEqual(['plank12', 'chair']);
    expect(def.contests[1]!.candidates.map((k) => k.name)).toEqual(['Blair', 'Alex']);
    expect(def.contests[0]!.proposal).toEqual({ snapshotId: 'p1', title: 'Platform plank 12', contentHash: proposal.contentHash });
    expect(validateDefinition(def, now)).toEqual([]);
  });

  it('hashes canonically: input order does not matter, content does', () => {
    const a = definitionHash(buildDefinition(election, contests, candidates, [proposal]));
    const b = definitionHash(buildDefinition(election, [...contests].reverse(), [...candidates].reverse(), [proposal]));
    expect(a).toBe(b);
    const edited = definitionHash(buildDefinition({ ...election, closesAt: '2026-11-09T00:00:00Z' }, contests, candidates, [proposal]));
    expect(edited).not.toBe(a);
  });

  it('reports what blocks scheduling', () => {
    const empty = buildDefinition({ ...election, opensAt: '2026-10-01T00:00:00Z', kAnonymity: 1 }, [], [], []);
    expect(validateDefinition(empty, now)).toEqual([
      'voting must open in the future',
      'secret ballots need an anonymity threshold of at least 2',
      'add at least one contest',
    ]);

    const noText = buildDefinition(election, [contests[1]!], [], []);
    expect(validateDefinition(noText, now)).toEqual(['“Plank 12”: attach the proposal text being voted on']);

    const noCandidates = buildDefinition(election, [{ ...contests[0]!, spec: { kind: 'irv', id: 'chair', candidates: [] } }], [], []);
    expect(validateDefinition(noCandidates, now)).toEqual(['“Chair”: add candidates']);

    const tooManySeats = buildDefinition(
      election,
      [{ ...contests[0]!, spec: { kind: 'choose_n', id: 'chair', candidates: ['b', 'a'], seats: 3, maxSelections: 2 } }],
      candidates,
      [],
    );
    expect(validateDefinition(tooManySeats, now)).toEqual(['“Chair”: seats must be an integer in 1..2']);
  });
});

describe('election request schemas', () => {
  it('fills defaults and rejects bad dates', () => {
    const ok = createElectionSchema.parse({
      title: ' Officers ',
      secrecy: 'secret',
      opensAt: '2026-11-01T00:00:00Z',
      closesAt: '2026-11-08T00:00:00-05:00',
    });
    expect(ok).toMatchObject({ title: 'Officers', description: '', kAnonymity: 10 });
    expect(createElectionSchema.safeParse({ ...ok, opensAt: 'next tuesday' }).success).toBe(false);
  });

  it('accepts each contest kind with its own rules only', () => {
    expect(contestInputSchema.safeParse({ kind: 'irv', title: 'Chair', maxRanks: 3 }).success).toBe(true);
    expect(contestInputSchema.safeParse({ kind: 'irv', title: 'Chair', seats: 2 }).success).toBe(false);
    const proposalOk = contestInputSchema.safeParse({
      kind: 'proposal',
      title: 'Plank',
      proposalSnapshotId: 'p1',
      passRule: { threshold: { ratio: { num: 2, den: 3 }, comparison: 'gte' }, base: 'yes_no' },
    });
    expect(proposalOk.success).toBe(true);
    const badRatio = contestInputSchema.safeParse({
      kind: 'proposal',
      title: 'Plank',
      proposalSnapshotId: 'p1',
      passRule: { threshold: { ratio: { num: 3, den: 2 }, comparison: 'gte' }, base: 'yes_no' },
    });
    expect(badRatio.success).toBe(false);
  });
});
