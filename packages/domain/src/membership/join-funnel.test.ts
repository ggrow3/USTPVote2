import { describe, expect, it } from 'vitest';
import { biggestDrop, joinFunnelReport, type JoinFunnelPerson } from './join-funnel.js';

const person = (over: Partial<JoinFunnelPerson> = {}): JoinFunnelPerson => ({
  createdAt: '2026-11-01T00:00:00.000Z',
  emailVerified: false,
  appliedAt: null,
  decision: null,
  decidedAt: null,
  did: [],
  ...over,
});
const report = (people: JoinFunnelPerson[]) =>
  joinFunnelReport({ days: 30, from: '2026-10-12', now: '2026-11-10T00:00:00.000Z', registerOpens: 40, registerOpensSignedIn: 9, people, truncated: false });

describe('joinFunnelReport', () => {
  it('counts each step among those who reached the one before', () => {
    const r = report([
      person(),
      person({ emailVerified: true }),
      person({ emailVerified: true, appliedAt: '2026-11-02T00:00:00.000Z', decision: 'pending' }),
      person({ emailVerified: true, appliedAt: '2026-11-02T00:00:00.000Z', decision: 'rejected', decidedAt: '2026-11-03T00:00:00.000Z' }),
      person({ emailVerified: true, appliedAt: '2026-11-02T00:00:00.000Z', decision: 'approved', decidedAt: '2026-11-05T00:00:00.000Z' }),
      // Applied, though the verified flag has not caught up: applying needs a verified address.
      person({ appliedAt: '2026-11-04T00:00:00.000Z', decision: 'approved', decidedAt: '2026-11-04T12:00:00.000Z', did: ['course', 'team'] }),
    ]);
    expect(r.steps.map((s) => [s.id, s.count, s.ofPrevious])).toEqual([
      ['account', 6, null],
      ['verified', 5, 83],
      ['applied', 4, 80],
      ['approved', 2, 50],
      ['active', 1, 50],
    ]);
    expect(r).toMatchObject({ registerOpens: 40, registerOpensSignedIn: 9, waiting: 1, rejected: 1, oldestWaitingDays: 8 });
    // Decisions took 1, 3 and 0.5 days.
    expect(r.medianDaysToDecision).toBe(1);
    expect(r.firstSteps).toEqual({ voted: 0, course: 1, team: 1, room: 0, posted: 0 });
    expect(biggestDrop(r)).toMatchObject({ step: { id: 'approved' }, lost: 2 });
  });

  it('is all zeros, with no percentages, when nobody made an account', () => {
    const r = report([]);
    expect(r.steps.every((s) => s.count === 0 && s.ofPrevious === null)).toBe(true);
    expect(r).toMatchObject({ waiting: 0, oldestWaitingDays: null, medianDaysToDecision: null });
    expect(biggestDrop(r)).toBeNull();
  });
});
