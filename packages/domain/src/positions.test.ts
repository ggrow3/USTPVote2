import { describe, expect, it } from 'vitest';
import type { CandidateRecord, ElectionDefinition } from './elections.js';
import { addMonths, positionInputSchema, termsFromResults, winnersOf } from './positions.js';
import type { ResultsBundle } from './results.js';

const contest = (contestId: string, positionId: string | null, kind: 'irv' | 'choose_n' | 'proposal') => ({
  contestId,
  title: contestId,
  description: '',
  spec:
    kind === 'proposal'
      ? { kind, id: contestId, passRule: { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' as const }, base: 'yes_no' as const } }
      : kind === 'irv'
        ? { kind, id: contestId, candidates: ['a', 'b'] }
        : { kind, id: contestId, candidates: ['a', 'b', 'c'], seats: 2, maxSelections: 2 },
  proposal: null,
  candidates: [
    { candidateId: 'a', name: 'Ada', statement: null },
    { candidateId: 'b', name: 'Ben', statement: null },
    { candidateId: 'c', name: 'Cleo', statement: null },
  ],
  positionId,
});

const definition = {
  electionId: 'e1',
  contests: [contest('chair', 'chair', 'irv'), contest('board', 'board', 'choose_n'), contest('plank', null, 'proposal'), contest('poll', null, 'irv')],
} as unknown as ElectionDefinition;

const bundle = {
  contests: [
    { contestId: 'chair', result: { kind: 'irv', winner: 'b' } },
    { contestId: 'board', result: { kind: 'choose_n', winners: ['a', 'c'] } },
    { contestId: 'plank', result: { kind: 'proposal' } },
    { contestId: 'poll', result: { kind: 'irv', winner: 'a' } },
  ],
} as unknown as ResultsBundle;

const candidates: CandidateRecord[] = [{ candidateId: 'b', contestId: 'chair', name: 'Ben', statement: null, accountId: 'acct-ben' }];

describe('offices and terms', () => {
  it('end terms on the same day of the month, or the last day of a shorter month', () => {
    expect(addMonths('2026-10-22T05:00:00.000Z', 24)).toBe('2028-10-22T05:00:00.000Z');
    expect(addMonths('2026-01-31T12:00:00.000Z', 1)).toBe('2026-02-28T12:00:00.000Z');
    expect(addMonths('2027-11-30T00:00:00.000Z', 3)).toBe('2028-02-29T00:00:00.000Z');
  });

  it('take the winners from every kind of candidate result', () => {
    expect(winnersOf(bundle.contests[0]!.result)).toEqual(['b']);
    expect(winnersOf(bundle.contests[1]!.result)).toEqual(['a', 'c']);
    expect(winnersOf(bundle.contests[2]!.result)).toEqual([]);
    expect(winnersOf({ kind: 'irv', winner: null } as never)).toEqual([]);
  });

  it('give each winner of a contest tied to an office a term, and nobody else', () => {
    const positions = new Map([
      ['chair', { termMonths: 12 }],
      ['board', { termMonths: 24 }],
    ]);
    const terms = termsFromResults({ definition, bundle, resultsHash: 'h', candidates, positions, startsAt: '2026-10-22T00:00:00.000Z' });
    expect(terms.map((t) => [t.positionId, t.holderName, t.accountId, t.endsAt])).toEqual([
      ['chair', 'Ben', 'acct-ben', '2027-10-22T00:00:00.000Z'],
      ['board', 'Ada', null, '2028-10-22T00:00:00.000Z'],
      ['board', 'Cleo', null, '2028-10-22T00:00:00.000Z'],
    ]);
    expect(terms.every((t) => t.resultsHash === 'h' && t.electionId === 'e1')).toBe(true);
  });

  it('refuse a contest that names an office that does not exist', () => {
    expect(() =>
      termsFromResults({ definition, bundle, resultsHash: 'h', candidates, positions: new Map(), startsAt: '2026-10-22T00:00:00.000Z' }),
    ).toThrow(/does not exist/);
  });

  it('accept office definitions with a slug, sensible seats and terms, and a reason', () => {
    const office = { positionId: 'chair', title: 'Chair', seats: 1, termMonths: 24, reason: 'bylaws art. 4' };
    expect(positionInputSchema.safeParse(office).success).toBe(true);
    expect(positionInputSchema.safeParse({ ...office, positionId: 'Chair Person' }).success).toBe(false);
    expect(positionInputSchema.safeParse({ ...office, termMonths: 0 }).success).toBe(false);
    expect(positionInputSchema.safeParse({ ...office, reason: '' }).success).toBe(false);
  });
});
