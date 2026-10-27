import { describe, expect, it } from 'vitest';
import { ballotProblems } from './ballots.js';
import { electionPackageSchema, packageRecords } from './election-package.js';
import { buildDefinition, type ElectionDefinition } from './elections.js';
import type { ResultsBundle } from './results.js';
import { expectedResultProblems, planTestBallots, randomBallot, seededRandom, testVotesSchema, type TestVotesInput } from './test-votes.js';

const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' } as const;
let n = 0;
const records = packageRecords(
  electionPackageSchema.parse({
    format: 'ustp.election',
    v: 1,
    title: 'Rehearsal',
    secrecy: 'open',
    window: { opensInSeconds: 60, votingSeconds: 300 },
    contests: [
      { id: 'plank', kind: 'proposal', title: 'Plank 12', passRule: MAJORITY, proposal: { body: 'Adopt it.' } },
      { id: 'board', kind: 'choose_n', title: 'Board', seats: 2, maxSelections: 2, candidates: [{ id: 'ada', name: 'Ada' }, 'Grace', 'Alan'] },
      { id: 'chair', kind: 'irv', title: 'Chair', candidates: ['Ada', 'Grace'] },
      { id: 'chair-2', kind: 'irv', title: 'Chair', candidates: ['Ada', 'Grace'] },
    ],
  }),
  { electionId: 'e1', createdBy: 'ea', now: new Date('2026-10-20T12:00:00Z'), newId: () => `k${++n}`, snapshotIds: ['p1', null, null, null] },
);
const definition: ElectionDefinition = buildDefinition(records.election, records.contests, records.candidates, []);
const votes = (file: Omit<TestVotesInput, 'format' | 'v'>) => testVotesSchema.parse({ format: 'ustp.test-votes', v: 1, ...file });
const plan = (file: Omit<TestVotesInput, 'format' | 'v'>) => planTestBallots(votes(file), definition);

describe('test votes', () => {
  it('resolve contests by ID or title and candidates by ID or name, in the order given', () => {
    expect(plan({ ballots: [{ voter: 2, choices: { 'Plank 12': 'yes', board: ['Grace', 'ada'], 'chair-2': [] } }] })).toEqual({
      ok: true,
      ballots: [
        {
          voter: 2,
          selections: [
            { contestId: 'plank', selection: 'yes' },
            { contestId: 'board', selection: ['k1', 'ada'] },
            { contestId: 'chair-2', selection: [] },
          ],
        },
      ],
    });
  });

  it('refuse what the api would refuse, and what they cannot resolve, voter by voter', () => {
    expect(
      plan({
        ballots: [
          { voter: 1, choices: { Chair: ['Ada'], Board: ['Ada', 'Grace', 'Alan'] } },
          { voter: 2, choices: { 'Plank 12': ['Ada'], board: 'yes', Treasurer: 'yes' } },
          { voter: 3, choices: { board: ['Ada', 'Ann'] } },
          { voter: 4, choices: {} },
        ],
      }),
    ).toEqual({
      ok: false,
      problems: [
        'test voter 1: 2 contests are titled "Chair"; use the contest ID',
        'test voter 1: “Board”: at most 2 selections allowed',
        'test voter 2: "Plank 12" is a proposal; answer yes, no or abstain',
        'test voter 2: "Board" takes a list of candidates, not yes',
        'test voter 2: there is no contest "Treasurer"',
        'test voter 3: "Board": there is no candidate "Ann"',
        'test voter 4: the ballot answers no contest',
      ],
    });
    expect(() => votes({ ballots: [{ voter: 1, choices: {} }, { voter: 1, choices: {} }] })).toThrow(/test voter 1 already has a ballot/);
    expect(() => votes({})).toThrow(/give ballots, random, or both/);
  });

  it('fill in random ballots that are valid, and the same every time with a seed', () => {
    const file = { ballots: [{ voter: 3, choices: { 'Plank 12': 'no' as const, board: 'random' as const } }], random: { voters: 5, seed: 'spring' } };
    const first = plan(file);
    expect(first.ok && first.ballots.map((b) => b.voter)).toEqual([1, 2, 3, 4, 5]);
    expect(plan(file)).toEqual(first);
    expect(plan({ ...file, random: { voters: 5, seed: 'autumn' } })).not.toEqual(first);
    expect(first.ok && first.ballots[2]!.selections[0]).toEqual({ contestId: 'plank', selection: 'no' });

    const random = seededRandom('many');
    for (let i = 0; i < 200; i++) {
      const ballot = randomBallot(definition, random, 0.9);
      expect(ballot.length).toBeGreaterThan(0);
      const parts = ballot.map((s) => ({ v: 1 as const, electionId: 'e1', ...s, salt: '0'.repeat(64) }));
      expect(ballotProblems(definition, parts)).toEqual([]);
    }
  });

  it('compare results with what the file expects, winners in any order', () => {
    const bundle: Pick<ResultsBundle, 'contests'> = {
      contests: [
        { contestId: 'plank', tieBreakOrder: null, result: { kind: 'proposal', outcome: 'failed' } },
        { contestId: 'board', tieBreakOrder: [], result: { kind: 'choose_n', winners: ['ada', 'k1'] } },
        { contestId: 'chair', tieBreakOrder: [], result: { kind: 'irv', winner: null } },
      ],
    } as never;
    expect(expectedResultProblems({ board: ['Grace', 'Ada'], chair: [] }, definition, bundle)).toEqual([]);
    expect(expectedResultProblems({ 'Plank 12': 'passed', Board: ['Ada', 'Alan'], chair: ['Ada'], 'chair-2': ['Ada'], Treasurer: 'passed' }, definition, bundle)).toEqual([
      '"Plank 12": expected "passed", the result is failed',
      '"Board": expected Ada, Alan to win, the winners are Ada, Grace',
      '"Chair": expected Ada to win, the winners are none',
      '"Chair" has no result',
      'there is no contest "Treasurer"',
    ]);
  });
});
