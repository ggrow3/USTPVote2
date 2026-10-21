import { describe, expect, it } from 'vitest';
import { tallyContest } from './tally.js';
import type { ChooseNContest, ChooseNResult } from './types.js';

function contest(overrides: Partial<ChooseNContest> = {}): ChooseNContest {
  return { kind: 'choose_n', id: 'c1', candidates: ['a', 'b', 'c'], seats: 1, maxSelections: 1, ...overrides };
}

function repeat(selection: string[], times: number): string[][] {
  return Array.from({ length: times }, () => [...selection]);
}

function run(spec: ChooseNContest, selections: unknown[], tieBreakOrder = spec.candidates): ChooseNResult {
  return tallyContest(spec, selections, { rollSize: 100, tieBreakOrder }) as ChooseNResult;
}

describe('choose up to N', () => {
  it('elects the plurality winner', () => {
    const r = run(contest(), [...repeat(['a'], 3), ...repeat(['b'], 2)]);
    expect(r.winners).toEqual(['a']);
    expect(r.ranking.map((x) => [x.candidateId, x.votes])).toEqual([
      ['a', 3],
      ['b', 2],
      ['c', 0],
    ]);
    expect(r.tieBreaks).toEqual([]);
  });

  it('breaks a tie at the last seat by tie-break order and reports it', () => {
    const spec = contest({ seats: 2, maxSelections: 2 });
    const r = run(spec, [...repeat(['a', 'b'], 2), ...repeat(['a', 'c'], 2), ['a']], ['c', 'b', 'a']);
    expect(r.winners).toEqual(['a', 'c']);
    expect(r.tieBreaks).toEqual([
      { reason: 'seat_cutoff', tied: ['c', 'b'], resolvedBy: 'tie_break_order', excluded: ['b'] },
    ]);
  });

  it('leaves seats vacant for candidates below the support floor', () => {
    const spec = contest({
      seats: 3,
      maxSelections: 3,
      supportFloor: { ratio: { num: 1, den: 2 }, comparison: 'gte' },
    });
    const r = run(spec, [['a', 'b'], ['a', 'b'], ['a', 'c'], []]);
    expect(r.ballots).toBe(4);
    expect(r.blank).toBe(1);
    expect(r.winners).toEqual(['a', 'b']);
    expect(r.vacantSeats).toBe(1);
    expect(r.ranking.find((x) => x.candidateId === 'c')?.meetsFloor).toBe(false);
  });

  it('never elects a candidate with zero votes', () => {
    const r = run(contest({ seats: 2, maxSelections: 2 }), repeat(['a'], 3));
    expect(r.winners).toEqual(['a']);
    expect(r.vacantSeats).toBe(1);
  });

  it('counts duplicate, unknown, oversized and non-array selections as invalid', () => {
    const r = run(contest({ maxSelections: 2 }), [['a', 'a'], ['z'], ['a', 'b', 'c'], 'a', [1], ['b']]);
    expect(r.invalid).toBe(5);
    expect(r.ballots).toBe(1);
    expect(r.winners).toEqual(['b']);
  });

  it('requires a tie-break order that is a permutation of the candidates', () => {
    expect(() => tallyContest(contest(), [], { rollSize: 1 })).toThrow(/tieBreakOrder is required/);
    expect(() => run(contest(), [], ['a', 'b'])).toThrow(/permutation/);
    expect(() => run(contest(), [], ['a', 'b', 'b'])).toThrow(/permutation/);
  });

  it('rejects invalid contest definitions', () => {
    expect(() => run(contest({ seats: 4 }), [])).toThrow(/seats must be/);
    expect(() => run(contest({ candidates: ['a', 'a'] }), [], ['a', 'a'])).toThrow(/unique/);
  });
});
