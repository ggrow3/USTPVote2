import { seedCommitment } from 'ustp-audit';
import { tallyContest, TALLY_VERSION, type ContestSpec } from 'ustp-tally';
import { describe, expect, it } from 'vitest';
import { definitionHash, type ElectionDefinition } from './elections.js';
import type { ResultsRecord } from './results.js';
import { comparedPercents, percent, resultsSynopsis, synopsisTally } from './results-synopsis.js';

const SEED = '5eed'.repeat(16);
const AT = '2026-10-21T12:00:00.000Z';
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' as const }, base: 'yes_no' as const };
const TWO_THIRDS = { threshold: { ratio: { num: 2, den: 3 }, comparison: 'gte' as const }, base: 'yes_no' as const };
const ROLL = 80;

const times = <T>(n: number, value: T): T[] => Array.from({ length: n }, () => value);
const answers = (yes: number, no: number, abstain: number) => [...times(yes, 'yes'), ...times(no, 'no'), ...times(abstain, 'abstain')];
/** Approval ballots: ballot i approves option j when i < counts[j]; any ballot approving nothing is blank. */
const approvals = (ids: readonly string[], counts: readonly number[], ballots: number) =>
  Array.from({ length: ballots }, (_, i) => ids.filter((_, j) => i < counts[j]!));

type Contest = ElectionDefinition['contests'][number];
const contest = (contestId: string, title: string, spec: ContestSpec, names: readonly string[] = []): Contest => ({
  contestId,
  title,
  description: '',
  spec,
  proposal: spec.kind === 'proposal' ? { snapshotId: `s-${contestId}`, title, contentHash: 'ab'.repeat(32) } : null,
  candidates: 'candidates' in spec ? spec.candidates.map((candidateId, i) => ({ candidateId, name: names[i] ?? candidateId, statement: null })) : [],
  positionId: null,
});

/**
 * Figures shaped like a real platform vote's (68 ballots): a plank passed 47–14–7, a select-all question with a
 * majority floor, current section or amendment (blank abstains), and a ranked question won in the third round.
 */
const definition: ElectionDefinition = {
  v: 1,
  electionId: 'e1',
  title: 'Platform Vote',
  description: '',
  secrecy: 'secret',
  opensAt: '2026-10-01T14:00:00.000Z',
  closesAt: '2026-10-22T14:00:00.000Z',
  kAnonymity: 2,
  contests: [
    contest('plank', 'Question I', { kind: 'proposal', id: 'plank', passRule: MAJORITY }),
    contest(
      'provisions',
      'Question II',
      {
        kind: 'choose_n',
        id: 'provisions',
        candidates: ['i', 'ii', 'iii', 'iv'],
        seats: 4,
        maxSelections: 4,
        supportFloor: { ratio: { num: 1, den: 2 }, comparison: 'gt' },
      },
      ['Provision i', 'Provision ii', 'Provision iii', 'Provision iv'],
    ),
    contest('section', 'Question XI', { kind: 'choose_n', id: 'section', candidates: ['current', 'amend'], seats: 1, maxSelections: 1 }, [
      'Current section',
      'Amendment',
    ]),
    contest('ai', 'Question IV', { kind: 'irv', id: 'ai', candidates: ['b1', 'b2', 'b3', 'no'] }, ['B-1', 'B-2', 'B-3', 'B-NO']),
    contest('bylaw', 'Bylaw change', { kind: 'proposal', id: 'bylaw', passRule: TWO_THIRDS }),
    contest('quorate', 'Needs a quorum', { kind: 'proposal', id: 'quorate', passRule: MAJORITY, quorum: { rollRatio: { num: 1, den: 2 } } }),
    contest('whole-roll', 'Majority of the roll', {
      kind: 'proposal',
      id: 'whole-roll',
      passRule: { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'roll' },
    }),
    contest('nobody', 'Unranked', { kind: 'irv', id: 'nobody', candidates: ['x', 'y'] }),
  ],
};

/**
 * Round 1: B-1 24, B-2 14, B-3 18, B-NO 5 (61). B-NO out: two to B-1, one each to B-2 and B-3, one exhausted.
 * Round 2: 26, 15, 19 (60). B-2 out: twelve to B-1, two to B-3, one exhausted. Round 3: 38 to 21 (59). Seven blank.
 */
const RANKED = [
  ...times(24, ['b1']),
  ...times(11, ['b2', 'b1']),
  ...times(2, ['b2', 'b3']),
  ['b2'],
  ...times(18, ['b3']),
  ...times(2, ['no', 'b1']),
  ['no', 'b2', 'b1'],
  ['no', 'b3'],
  ['no'],
  ...times(7, []),
];

const SELECTIONS: Record<string, unknown[]> = {
  plank: answers(47, 14, 7),
  provisions: approvals(['i', 'ii', 'iii', 'iv'], [43, 33, 36, 45], 68),
  section: [...times(7, ['current']), ...times(48, ['amend']), ...times(13, [])],
  ai: RANKED,
  bylaw: answers(40, 21, 7), // 40 / 61 is 65.6%: short of two-thirds
  quorate: answers(30, 5, 3), // 38 ballots, 40 needed
  'whole-roll': answers(41, 20, 7), // 41 of the 80 on the roll
  nobody: times(68, []),
};

function results(extra: Partial<ResultsRecord> = {}, def: ElectionDefinition = definition): ResultsRecord {
  return {
    electionId: 'e1',
    status: 'provisional',
    bundle: {
      v: 1,
      electionId: 'e1',
      definitionHash: definitionHash(def),
      roll: { snapshotId: 'r1', merkleRoot: 'cd'.repeat(32), count: ROLL },
      participationCount: 68,
      sealedBlocks: [],
      tally: { library: 'ustp-tally', version: TALLY_VERSION },
      tieBreakSeed: SEED,
      tieBreakSeedCommitment: seedCommitment(SEED),
      contests: def.contests.map(({ contestId, spec }) => ({
        contestId,
        tieBreakOrder: 'candidates' in spec ? spec.candidates : null,
        result: tallyContest(spec, SELECTIONS[contestId]!, { rollSize: ROLL, ...('candidates' in spec && { tieBreakOrder: spec.candidates }) }),
      })),
    },
    resultsHash: 'ef'.repeat(32),
    signature: { keyVersion: 'emulator/audit-signing/1', signature: 'c2ln' },
    computedAt: AT,
    ledgerSeq: 9,
    ...extra,
  };
}

describe('percent', () => {
  it('rounds half up to one decimal, exactly', () => {
    expect(percent({ part: 47, whole: 68 })).toBe('69.1%');
    expect(percent({ part: 14, whole: 68 })).toBe('20.6%');
    expect(percent({ part: 7, whole: 68 })).toBe('10.3%');
    expect(percent({ part: 1, whole: 8 })).toBe('12.5%');
    expect(percent({ part: 1, whole: 16 })).toBe('6.3%'); // 6.25 rounds up
    expect(percent({ part: 1, whole: 3 })).toBe('33.3%');
    expect(percent({ part: 2, whole: 3 })).toBe('66.7%');
    expect(percent({ part: 0, whole: 5 })).toBe('0.0%');
    expect(percent({ part: 5, whole: 5 })).toBe('100.0%');
    expect(percent({ part: 1, whole: 2001 })).toBe('0.0%');
  });

  it('takes other precisions, and has no percentage of nothing', () => {
    expect(percent({ part: 24, whole: 61 }, 2)).toBe('39.34%');
    expect(percent({ part: 2, whole: 3 }, 0)).toBe('67%');
    expect(percent({ part: 1, whole: 200 }, 0)).toBe('1%');
    expect(percent({ part: 0, whole: 0 })).toBeNull();
  });
});

describe('comparedPercents', () => {
  const half = { num: 1, den: 2 };
  const twoThirds = { num: 2, den: 3 };

  it('uses one decimal when that tells the share and threshold apart', () => {
    expect(comparedPercents({ part: 47, whole: 61 }, half)).toEqual({ share: '77.0%', threshold: '50.0%' });
    expect(comparedPercents({ part: 40, whole: 61 }, twoThirds)).toEqual({ share: '65.6%', threshold: '66.7%' });
  });

  it('adds decimals until rounding no longer makes them look equal', () => {
    expect(comparedPercents({ part: 1001, whole: 2001 }, half)).toEqual({ share: '50.02%', threshold: '50.00%' });
    // 66.65% would round to the threshold's 66.7% at one decimal, and is short of it.
    expect(comparedPercents({ part: 1333, whole: 2000 }, twoThirds)).toEqual({ share: '66.65%', threshold: '66.67%' });
    expect(comparedPercents({ part: 500001, whole: 1000000 }, half)).toEqual({ share: '50.0001%', threshold: '50.0000%' });
  });

  it('keeps one decimal for a share exactly at the threshold, and has none of nothing', () => {
    expect(comparedPercents({ part: 30, whole: 60 }, half)).toEqual({ share: '50.0%', threshold: '50.0%' });
    expect(comparedPercents({ part: 40, whole: 60 }, twoThirds)).toEqual({ share: '66.7%', threshold: '66.7%' });
    expect(comparedPercents({ part: 0, whole: 0 }, half)).toBeNull();
  });
});

describe('resultsSynopsis', () => {
  const synopsis = resultsSynopsis({ results: results(), definition });
  const byId = (id: string) => synopsis.contests.find((c) => c.contestId === id)!;

  it('gives the window, status, roll and turnout', () => {
    expect(synopsis).toMatchObject({
      electionId: 'e1',
      title: 'Platform Vote',
      opensAt: '2026-10-01T14:00:00.000Z',
      closesAt: '2026-10-22T14:00:00.000Z',
      status: 'provisional',
      computedAt: AT,
      certifiedAt: null,
      turnout: { part: 68, whole: ROLL },
    });
    const certified = resultsSynopsis({ results: results({ status: 'certified', certifiedAt: '2026-10-23T09:00:00.000Z' }), definition });
    expect(certified).toMatchObject({ status: 'certified', certifiedAt: '2026-10-23T09:00:00.000Z' });
  });

  it('numbers the contests in ballot order', () => {
    expect(synopsis.contests.map((c) => [c.number, c.title])).toEqual(definition.contests.map((c, i) => [i + 1, c.title]));
  });

  it('gives a proposal its counts of the ballots and its yes share against the pass rule', () => {
    expect(byId('plank')).toEqual({
      kind: 'proposal',
      number: 1,
      contestId: 'plank',
      title: 'Question I',
      ballots: 68,
      invalid: 0,
      yes: { part: 47, whole: 68 },
      no: { part: 14, whole: 68 },
      abstain: { part: 7, whole: 68 },
      passRule: MAJORITY,
      yesShare: { part: 47, whole: 61 },
      quorum: null,
      outcome: 'passed',
    });
    expect(byId('bylaw')).toMatchObject({ yesShare: { part: 40, whole: 61 }, outcome: 'failed' });
  });

  it('judges a roll-based rule against the whole roll, and reports a missed quorum', () => {
    expect(byId('whole-roll')).toMatchObject({ yesShare: { part: 41, whole: ROLL }, outcome: 'passed' });
    expect(byId('quorate')).toMatchObject({ ballots: 38, quorum: { required: 40, met: false }, outcome: 'no_quorum' });
  });

  it('lists every candidate of a choose-N contest, most votes first, with shares of the ballots', () => {
    expect(byId('provisions')).toMatchObject({
      kind: 'choose_n',
      ballots: 68,
      seats: 4,
      vacantSeats: 1,
      blank: { part: 23, whole: 68 },
      supportFloor: { ratio: { num: 1, den: 2 }, comparison: 'gt' },
      candidates: [
        { name: 'Provision iv', votes: { part: 45, whole: 68 }, elected: true, meetsFloor: true },
        { name: 'Provision i', votes: { part: 43, whole: 68 }, elected: true, meetsFloor: true },
        { name: 'Provision iii', votes: { part: 36, whole: 68 }, elected: true, meetsFloor: true },
        { name: 'Provision ii', votes: { part: 33, whole: 68 }, elected: false, meetsFloor: false },
      ],
    });
    expect(byId('section')).toMatchObject({
      seats: 1,
      vacantSeats: 0,
      supportFloor: null,
      blank: { part: 13, whole: 68 },
      candidates: [
        { name: 'Amendment', votes: { part: 48, whole: 68 }, elected: true },
        { name: 'Current section', votes: { part: 7, whole: 68 }, elected: false },
      ],
    });
  });

  it('gives a ranked-choice winner its first-round and final-round shares', () => {
    expect(byId('ai')).toEqual({
      kind: 'irv',
      number: 4,
      contestId: 'ai',
      title: 'Question IV',
      ballots: 68,
      invalid: 0,
      blank: { part: 7, whole: 68 },
      rounds: 3,
      winner: { candidateId: 'b1', name: 'B-1', firstRound: { part: 24, whole: 61 }, finalRound: { part: 38, whole: 59 } },
    });
    expect(byId('nobody')).toMatchObject({ rounds: 0, winner: null, blank: { part: 68, whole: 68 } });
  });

  it('closes with the tally: proposals passed, failed and short of quorum; seats filled and left vacant', () => {
    expect(synopsis.tally).toEqual({
      proposals: { total: 4, passed: 2, failed: 1, noQuorum: 1 },
      candidateContests: { total: 4, seats: 7, elected: 5, vacantSeats: 2 },
    });
    expect(synopsisTally([])).toEqual({
      proposals: { total: 0, passed: 0, failed: 0, noQuorum: 0 },
      candidateContests: { total: 0, seats: 0, elected: 0, vacantSeats: 0 },
    });
  });

  it('refuses results counted from another definition', () => {
    expect(() => resultsSynopsis({ results: results(), definition: { ...definition, title: 'Another vote' } })).toThrow(
      /not the one these results were counted from/,
    );
    expect(() => resultsSynopsis({ results: { ...results(), electionId: 'e2' }, definition })).toThrow(/not the one/);
  });
});
