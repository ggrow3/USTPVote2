import { ballotPartCommitment, newSalt, type BallotPart } from 'ustp-audit';
import { describe, expect, it } from 'vitest';
import { ballotProblems, castBallotSchema, commitmentsOf } from './ballots.js';
import type { ElectionDefinition } from './elections.js';

const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' as const }, base: 'yes_no' as const };

const definition: ElectionDefinition = {
  v: 1,
  electionId: 'e1',
  title: 'Officers',
  description: '',
  secrecy: 'secret',
  opensAt: '2026-11-01T00:00:00.000Z',
  closesAt: '2026-11-08T00:00:00.000Z',
  kAnonymity: 10,
  contests: [
    {
      contestId: 'plank',
      title: 'Plank 12',
      description: '',
      spec: { kind: 'proposal', id: 'plank', passRule: MAJORITY },
      proposal: { snapshotId: 'p1', title: 'Plank 12', contentHash: '0'.repeat(64) },
      candidates: [],
      positionId: null,
    },
    {
      contestId: 'board',
      title: 'Board',
      description: '',
      spec: { kind: 'choose_n', id: 'board', candidates: ['a', 'b', 'c'], seats: 2, maxSelections: 2 },
      proposal: null,
      candidates: [],
      positionId: null,
    },
    {
      contestId: 'chair',
      title: 'Chair',
      description: '',
      spec: { kind: 'irv', id: 'chair', candidates: ['x', 'y'] },
      proposal: null,
      candidates: [],
      positionId: null,
    },
  ],
};

const part = (contestId: string, selection: unknown, electionId = 'e1'): BallotPart => ({
  v: 1,
  electionId,
  contestId,
  selection,
  salt: newSalt(),
});

describe('ballot checks', () => {
  it('accept any subset of contests with valid selections, blanks included', () => {
    expect(ballotProblems(definition, [part('plank', 'abstain'), part('board', ['a', 'c']), part('chair', ['y', 'x'])])).toEqual([]);
    expect(ballotProblems(definition, [part('board', [])])).toEqual([]);
  });

  it('name each problem', () => {
    expect(
      ballotProblems(definition, [
        part('plank', 'maybe'),
        part('board', ['a', 'b', 'c']),
        part('chair', ['x', 'x']),
        part('nope', 'yes'),
        part('plank', 'yes', 'e2'),
      ]),
    ).toEqual([
      '“Plank 12”: selection must be "yes", "no" or "abstain"',
      '“Board”: at most 2 selections allowed',
      '“Chair”: duplicate candidate "x"',
      'unknown contest "nope"',
      'a ballot part belongs to another election',
    ]);
    expect(ballotProblems(definition, [part('plank', 'yes'), part('plank', 'no')])).toEqual(['“Plank 12” is answered twice']);
  });

  it('commit to each part separately', () => {
    const parts = [part('plank', 'yes'), part('chair', ['x'])];
    expect(commitmentsOf(parts)).toEqual([
      { contestId: 'plank', commitment: ballotPartCommitment(parts[0]!) },
      { contestId: 'chair', commitment: ballotPartCommitment(parts[1]!) },
    ]);
  });

  it('require salts and at least one part in the request', () => {
    const hash = 'a'.repeat(64);
    expect(castBallotSchema.safeParse({ definitionHash: hash, parts: [part('plank', 'yes')] }).success).toBe(true);
    expect(castBallotSchema.safeParse({ definitionHash: hash, parts: [] }).success).toBe(false);
    expect(castBallotSchema.safeParse({ definitionHash: hash, parts: [{ ...part('plank', 'yes'), salt: 'short' }] }).success).toBe(false);
    expect(castBallotSchema.safeParse({ definitionHash: hash, parts: [{ ...part('plank', 'yes'), voter: 'me' }] }).success).toBe(false);
  });
});
