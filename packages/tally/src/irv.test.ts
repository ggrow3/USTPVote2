/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TALLY_VERSION } from './index.js';
import { tallyContest } from './tally.js';
import type { IrvContest, IrvResult } from './types.js';

function contest(candidates: string[]): IrvContest {
  return { kind: 'irv', id: 'chair', candidates };
}

function repeat(ranking: string[], times: number): string[][] {
  return Array.from({ length: times }, () => [...ranking]);
}

function run(spec: IrvContest, selections: unknown[], tieBreakOrder = spec.candidates): IrvResult {
  return tallyContest(spec, selections, { rollSize: 100, tieBreakOrder }) as IrvResult;
}

describe('instant-runoff', () => {
  it('elects a first-round majority winner', () => {
    const r = run(contest(['a', 'b']), [...repeat(['a'], 3), ...repeat(['b'], 2)]);
    expect(r.winner).toBe('a');
    expect(r.rounds).toHaveLength(1);
    expect(r.rounds[0]).toMatchObject({ counts: { a: 3, b: 2 }, elected: 'a' });
  });

  it('transfers votes from eliminated candidates', () => {
    const r = run(contest(['a', 'b', 'c']), [...repeat(['a'], 4), ...repeat(['b'], 3), ...repeat(['c', 'b'], 2)]);
    expect(r.rounds).toEqual([
      { round: 1, counts: { a: 4, b: 3, c: 2 }, continuingBallots: 9, exhausted: 0, eliminated: 'c' },
      { round: 2, counts: { a: 4, b: 5 }, continuingBallots: 9, exhausted: 0, elected: 'b' },
    ]);
    expect(r.winner).toBe('b');
  });

  it('measures the majority against continuing ballots once others exhaust', () => {
    const r = run(contest(['a', 'b', 'c']), [...repeat(['a'], 4), ...repeat(['b'], 3), ...repeat(['c'], 2)]);
    expect(r.rounds[1]).toEqual({
      round: 2,
      counts: { a: 4, b: 3 },
      continuingBallots: 7,
      exhausted: 2,
      elected: 'a',
    });
  });

  it('breaks a last-place tie by earlier rounds before tie-break order', () => {
    const spec = contest(['a', 'b', 'c', 'd']);
    const selections = [...repeat(['a'], 5), ...repeat(['b'], 3), ...repeat(['c', 'a'], 2), ['d', 'c', 'b']];
    // Tie-break order favours c over b, but c had fewer votes in round 1, so c goes.
    const r = run(spec, selections, ['c', 'b', 'a', 'd']);
    expect(r.rounds.map((x) => x.eliminated ?? x.elected)).toEqual(['d', 'c', 'a']);
    expect(r.rounds[1]?.counts).toEqual({ a: 5, b: 3, c: 3 });
    expect(r.tieBreaks).toEqual([
      { reason: 'irv_elimination', tied: ['c', 'b'], resolvedBy: 'previous_rounds', excluded: ['c'], round: 2 },
    ]);
    expect(r.winner).toBe('a');
  });

  it('falls back to tie-break order, eliminating the least favoured', () => {
    const r = run(contest(['a', 'b']), [['a'], ['b']], ['b', 'a']);
    expect(r.tieBreaks).toEqual([
      { reason: 'irv_elimination', tied: ['b', 'a'], resolvedBy: 'tie_break_order', excluded: ['a'], round: 1 },
    ]);
    expect(r.winner).toBe('b');
  });

  it('separates blank and invalid ballots and elects nobody without rankings', () => {
    const r = run(contest(['a', 'b']), [[], [], ['a', 'a'], ['z'], 'a']);
    expect(r).toMatchObject({ ballots: 2, blank: 2, invalid: 3, rounds: [], winner: null });
  });

  it('enforces maxRanks', () => {
    const r = run({ ...contest(['a', 'b', 'c']), maxRanks: 2 }, [['a', 'b', 'c'], ['b']]);
    expect(r.invalid).toBe(1);
    expect(r.winner).toBe('b');
  });

  it('is independent of ballot order', () => {
    const spec = contest(['a', 'b', 'c', 'd']);
    const selections = [...repeat(['a'], 5), ...repeat(['b'], 3), ...repeat(['c', 'a'], 2), ['d', 'c', 'b']];
    const reversed = [...selections].reverse();
    expect(JSON.stringify(run(spec, reversed))).toBe(JSON.stringify(run(spec, selections)));
  });
});

describe('package', () => {
  it('records the same version as package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(TALLY_VERSION).toBe(pkg.version);
  });
});
