import { describe, expect, it } from 'vitest';
import { tallyContest } from './tally.js';
import type { ProposalContest, ProposalResult } from './types.js';

const majority: ProposalContest = {
  kind: 'proposal',
  id: 'p1',
  passRule: { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' },
};

function ballots(yes: number, no: number, abstain: number): string[] {
  return [...Array(yes).fill('yes'), ...Array(no).fill('no'), ...Array(abstain).fill('abstain')];
}

function run(spec: ProposalContest, selections: unknown[], rollSize = 100): ProposalResult {
  return tallyContest(spec, selections, { rollSize }) as ProposalResult;
}

describe('proposal', () => {
  it('passes a simple majority of yes + no, ignoring abstentions', () => {
    const r = run(majority, ballots(3, 2, 5));
    expect(r.counts).toEqual({ yes: 3, no: 2, abstain: 5 });
    expect(r.ballots).toBe(10);
    expect(r.outcome).toBe('passed');
  });

  it('fails on an exact tie under a "more than half" rule', () => {
    expect(run(majority, ballots(2, 2, 0)).outcome).toBe('failed');
  });

  it('distinguishes "at least" from "more than" two-thirds', () => {
    const atLeast: ProposalContest = {
      ...majority,
      passRule: { threshold: { ratio: { num: 2, den: 3 }, comparison: 'gte' }, base: 'yes_no' },
    };
    const moreThan: ProposalContest = {
      ...majority,
      passRule: { threshold: { ratio: { num: 2, den: 3 }, comparison: 'gt' }, base: 'yes_no' },
    };
    expect(run(atLeast, ballots(2, 1, 0)).outcome).toBe('passed');
    expect(run(moreThan, ballots(2, 1, 0)).outcome).toBe('failed');
  });

  it('counts abstentions against when the base includes them', () => {
    const spec: ProposalContest = { ...majority, passRule: { ...majority.passRule, base: 'yes_no_abstain' } };
    expect(run(spec, ballots(3, 2, 2)).outcome).toBe('failed');
  });

  it('measures against the whole roll when the base is the roll', () => {
    const gt: ProposalContest = { ...majority, passRule: { ...majority.passRule, base: 'roll' } };
    const gte: ProposalContest = {
      ...majority,
      passRule: { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gte' }, base: 'roll' },
    };
    expect(run(gt, ballots(5, 0, 0), 10).outcome).toBe('failed');
    expect(run(gte, ballots(5, 0, 0), 10).outcome).toBe('passed');
  });

  it('applies a roll-ratio quorum rounded up, with abstentions counting toward it', () => {
    const spec: ProposalContest = { ...majority, quorum: { rollRatio: { num: 1, den: 3 } } };
    const short = run(spec, ballots(3, 0, 0), 10);
    expect(short.quorum).toEqual({ required: 4, met: false });
    expect(short.outcome).toBe('no_quorum');
    expect(run(spec, ballots(3, 0, 1), 10).outcome).toBe('passed');
  });

  it('applies the stricter of minBallots and rollRatio', () => {
    const spec: ProposalContest = { ...majority, quorum: { minBallots: 6, rollRatio: { num: 1, den: 3 } } };
    expect(run(spec, ballots(5, 0, 0), 10).quorum).toEqual({ required: 6, met: false });
  });

  it('counts malformed selections as invalid and excludes them', () => {
    const r = run(majority, ['yes', 'maybe', null, ['yes'], 'no', 'YES']);
    expect(r.invalid).toBe(4);
    expect(r.ballots).toBe(2);
    expect(r.outcome).toBe('failed');
  });

  it('fails when there are no yes/no votes at all', () => {
    expect(run(majority, ballots(0, 0, 3)).outcome).toBe('failed');
  });
});
