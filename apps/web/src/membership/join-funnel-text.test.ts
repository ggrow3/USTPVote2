import { describe, expect, it } from 'vitest';
import { biggestDrop, joinFunnelReport, type JoinFunnelPerson } from 'ustp-domain';
import { dropText, stepShare, waitingText } from './join-funnel-text.js';

const person = (over: Partial<JoinFunnelPerson> = {}): JoinFunnelPerson => ({
  createdAt: '2026-11-01T00:00:00.000Z',
  emailVerified: true,
  appliedAt: null,
  decision: null,
  decidedAt: null,
  did: [],
  ...over,
});
const report = (people: JoinFunnelPerson[]) =>
  joinFunnelReport({ days: 30, from: '2026-10-12', now: '2026-11-10T00:00:00.000Z', registerOpens: 0, registerOpensSignedIn: 0, people, truncated: false });

describe('the join funnel card', () => {
  it('says where most people stop, and how applications are going', () => {
    const r = report([
      person(),
      person(),
      person(),
      person({ appliedAt: '2026-11-07T00:00:00.000Z', decision: 'pending' }),
      person({ appliedAt: '2026-11-02T00:00:00.000Z', decision: 'approved', decidedAt: '2026-11-04T00:00:00.000Z', did: ['voted'] }),
    ]);
    expect(dropText(biggestDrop(r)!)).toBe('Most people stop after verifying their email, before applying: 3 people.');
    expect(waitingText(r)).toBe('1 application is waiting, the oldest for 3 days. A decision usually takes 2 days.');
    expect(stepShare(r, r.steps[2]!)).toBeCloseTo(0.4);
  });

  it('has words for an empty period', () => {
    const r = report([]);
    expect(waitingText(r)).toBe('No application from the period is waiting.');
    expect(stepShare(r, r.steps[0]!)).toBe(0);
  });
});
