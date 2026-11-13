import { describe, expect, it } from 'vitest';
import {
  isReferralCode,
  myReferralCounts,
  REFERRAL_ALPHABET,
  REFERRAL_CODE_LENGTH,
  referralCodeFrom,
  referralCredits,
  referralLeaderboard,
  referralLink,
  type ReferredApplication,
} from './referrals.js';

const app = (accountId: string, referredBy: string, status: ReferredApplication['status'], decidedAt: string | null = null): ReferredApplication => ({
  accountId,
  referredBy,
  status,
  submittedAt: '2026-10-01T00:00:00.000Z',
  decidedAt,
});

describe('referral codes', () => {
  it('are eight letters and digits that cannot be confused', () => {
    const code = referralCodeFrom(new Uint8Array([0, 1, 2, 3, 30, 31, 62, 255]));
    expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
    expect(isReferralCode(code)).toBe(true);
    expect([...code].every((c) => REFERRAL_ALPHABET.includes(c))).toBe(true);
    for (const bad of ['abc', 'abcdefgh1', 'ABCDEFGH', 'abcdefg0', 'abcdefgl', 42, null]) expect(isReferralCode(bad)).toBe(false);
    expect(() => referralCodeFrom(new Uint8Array(3))).toThrow(RangeError);
  });

  it('lead to the Register page', () => {
    expect(referralLink('https://vote.example', 'abcdefgh')).toBe('https://vote.example/register?ref=abcdefgh');
  });
});

describe('referral credits', () => {
  it('count each applicant once, on approval, to the link of their first approval, never to themself', () => {
    const credits = referralCredits([
      app('p1', 'm1', 'approved', '2026-11-02T00:00:00.000Z'),
      app('p1', 'm2', 'approved', '2026-11-01T00:00:00.000Z'),
      app('p2', 'm1', 'pending'),
      app('p3', 'm1', 'rejected', '2026-11-03T00:00:00.000Z'),
      app('m4', 'm4', 'approved', '2026-11-03T00:00:00.000Z'),
    ]);
    expect(credits).toEqual([{ referrer: 'm2', applicant: 'p1', joinedAt: '2026-11-01T00:00:00.000Z' }]);
  });

  it('tell a member how many joined by their link and how many wait', () => {
    const apps = [
      app('p1', 'm1', 'approved', '2026-11-02T00:00:00.000Z'),
      app('p2', 'm1', 'pending'),
      app('p3', 'm1', 'rejected', '2026-11-01T00:00:00.000Z'),
      app('p3', 'm1', 'pending'),
      app('p4', 'm2', 'pending'),
    ];
    expect(myReferralCounts('m1', apps)).toEqual({ joined: 1, waiting: 2 });
    expect(myReferralCounts('m3', apps)).toEqual({ joined: 0, waiting: 0 });
  });
});

describe('the team leaderboard', () => {
  const now = new Date('2026-11-12T00:00:00.000Z');
  const teams = [
    { teamId: 'outreach', name: 'Outreach', color: 'blue' as const, icon: 'campaign' as const, archived: false },
    { teamId: 'media', name: 'Media', color: 'red' as const, icon: 'campaign' as const, archived: false },
    { teamId: 'policy', name: 'Policy', color: 'green' as const, icon: 'campaign' as const, archived: false },
    { teamId: 'old', name: 'Old', color: 'grey' as const, icon: 'campaign' as const, archived: true },
  ];
  const places = [
    { teamId: 'outreach', accountId: 'm1' },
    { teamId: 'outreach', accountId: 'm2' },
    { teamId: 'media', accountId: 'm2' },
    { teamId: 'media', accountId: 'gone' },
    { teamId: 'old', accountId: 'm1' },
  ];
  const credits = [
    { referrer: 'm1', applicant: 'p1', joinedAt: '2026-11-10T00:00:00.000Z' },
    { referrer: 'm1', applicant: 'p2', joinedAt: '2026-01-10T00:00:00.000Z' },
    { referrer: 'm2', applicant: 'p3', joinedAt: '2026-11-11T00:00:00.000Z' },
    { referrer: 'gone', applicant: 'p4', joinedAt: '2026-11-11T00:00:00.000Z' },
  ];
  const board = (days: 0 | 30) => referralLeaderboard({ days, now, teams, places, active: new Set(['m1', 'm2']), credits, viewer: 'm2' });

  it('ranks teams by what their Active members brought in, counting a member for each of their teams', () => {
    expect(board(0).teams.map((t) => [t.teamId, t.joined, t.rank, t.mine])).toEqual([
      ['outreach', 3, 1, true],
      ['media', 1, 2, true],
      ['policy', 0, 3, false],
    ]);
    expect(board(0).joined).toBe(4);
  });

  it('counts only the period, and ranks teams level together', () => {
    const recent = board(30);
    expect(recent.teams.map((t) => [t.teamId, t.joined, t.rank])).toEqual([
      ['outreach', 2, 1],
      ['media', 1, 2],
      ['policy', 0, 3],
    ]);
    expect(recent.joined).toBe(3);
    const level = referralLeaderboard({ days: 0, now, teams, places, active: new Set(), credits, viewer: 'x' });
    expect(level.teams.map((t) => t.rank)).toEqual([1, 1, 1]);
  });
});
