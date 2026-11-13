import type { TeamColor, TeamIcon } from '../teams/team.js';

/**
 * Referral links and the team leaderboard (design §5.18, the party's decisions of 2026-11-12). Each Active member has a
 * link of their own to the Register page; someone who opens it and later applies names, without knowing it, the member
 * whose link it was, and the member is credited once a Membership Admin approves the application. The member sees how
 * many joined by their link and how many applied and still wait; Active members see teams ranked by the people their
 * members brought in. Nobody else's own count is shown to anyone, nor who joined by whose link.
 */

/** The query parameter a referral link carries. */
export const REFERRAL_PARAM = 'ref';

/** 31 letters and digits that cannot be mistaken for one another (no 0, 1, i, l or o). */
export const REFERRAL_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const REFERRAL_CODE_LENGTH = 8;
const CODE = new RegExp(`^[${REFERRAL_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

export function isReferralCode(value: unknown): value is string {
  return typeof value === 'string' && CODE.test(value);
}

/** A code from random bytes (at least `REFERRAL_CODE_LENGTH` of them); a byte's bias over 31 letters does not matter here. */
export function referralCodeFrom(random: Uint8Array): string {
  if (random.length < REFERRAL_CODE_LENGTH) throw new RangeError('not enough random bytes');
  return Array.from(random.slice(0, REFERRAL_CODE_LENGTH), (b) => REFERRAL_ALPHABET[b % REFERRAL_ALPHABET.length]).join('');
}

/** How long the browser keeps the code of a link someone opened, waiting for them to apply. */
export const REFERRAL_KEPT_DAYS = 30;

/** Where a member's link leads: the Register page, with their code. */
export function referralLink(origin: string, code: string): string {
  return `${origin}/register?${REFERRAL_PARAM}=${encodeURIComponent(code)}`;
}

/** `referral_codes/{code}`: whose link a code is. Clients never read it. */
export interface ReferralCodeRecord {
  readonly code: string;
  readonly accountId: string;
  readonly createdAt: string;
}

/** `referral_links/{accountId}`: a member's code, made the first time they open their link. */
export interface ReferralLinkRecord {
  readonly accountId: string;
  readonly code: string;
  readonly createdAt: string;
}

/** What the membership context tells about an application that came by a member's link: no answer, no name. */
export interface ReferredApplication {
  /** The applicant. */
  readonly accountId: string;
  /** The member whose link it was. */
  readonly referredBy: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly submittedAt: string;
  readonly decidedAt: string | null;
}

/** One person brought in: credited to the member whose link they came by, when their application was approved. */
export interface ReferralCredit {
  readonly referrer: string;
  readonly applicant: string;
  readonly joinedAt: string;
}

/**
 * The credits in a set of referred applications: each applicant once, to the link of their first application approved,
 * never to themself.
 */
export function referralCredits(applications: readonly ReferredApplication[]): ReferralCredit[] {
  const first = new Map<string, ReferralCredit>();
  for (const a of applications) {
    if (a.status !== 'approved' || !a.decidedAt || a.referredBy === a.accountId) continue;
    const seen = first.get(a.accountId);
    if (!seen || a.decidedAt < seen.joinedAt) first.set(a.accountId, { referrer: a.referredBy, applicant: a.accountId, joinedAt: a.decidedAt });
  }
  return [...first.values()];
}

/** `GET /v1/me/referrals`: a member's own link and counts. */
export interface MyReferrals {
  /** Only Active members have a link; anyone else is told why not. */
  readonly eligible: boolean;
  readonly code: string | null;
  readonly link: string | null;
  /** People who joined by the link: their application was approved. */
  readonly joined: number;
  /** People who applied by the link and wait for a decision. */
  readonly waiting: number;
}

/**
 * Of the member's referred applications, how many joined and how many wait. Someone who applied again after a rejection
 * and waits is waiting; someone who joined once is counted once, as joined.
 */
export function myReferralCounts(referrer: string, applications: readonly ReferredApplication[]): Pick<MyReferrals, 'joined' | 'waiting'> {
  const mine = applications.filter((a) => a.referredBy === referrer && a.accountId !== referrer);
  const joined = new Set(referralCredits(mine).map((c) => c.applicant));
  const waiting = new Set(mine.filter((a) => a.status === 'pending' && !joined.has(a.accountId)).map((a) => a.accountId));
  return { joined: joined.size, waiting: waiting.size };
}

/** The leaderboard's periods, in days; 0 is all time. */
export const REFERRAL_PERIODS = [30, 90, 365, 0] as const;
export type ReferralPeriod = (typeof REFERRAL_PERIODS)[number];

export function isReferralPeriod(value: number): value is ReferralPeriod {
  return (REFERRAL_PERIODS as readonly number[]).includes(value);
}

/** A team on the leaderboard. */
export interface LeaderboardTeam {
  readonly teamId: string;
  readonly name: string;
  readonly color: TeamColor;
  readonly icon: TeamIcon;
  /** People who joined in the period by the link of someone now an Active member on the team. */
  readonly joined: number;
  /** 1 for the most; teams level share a rank. */
  readonly rank: number;
  /** The viewer is on it. */
  readonly mine: boolean;
}

/** `GET /v1/teams/leaderboard?days=`: for Active members, teams ranked by the people their members brought in. */
export interface ReferralLeaderboard {
  readonly days: ReferralPeriod;
  readonly teams: readonly LeaderboardTeam[];
  /** People who joined in the period by any member's link, on a team or not. */
  readonly joined: number;
}

/**
 * Teams ranked by the people who joined, in the period, by the links of their members who are Active now (leads
 * included). Someone on two teams counts for both. Archived teams are left out; a team with none is listed, last.
 */
export function referralLeaderboard(input: {
  readonly days: ReferralPeriod;
  /** Today's date as an ISO time; the period ends now. */
  readonly now: Date;
  readonly teams: readonly { readonly teamId: string; readonly name: string; readonly color: TeamColor; readonly icon: TeamIcon; readonly archived: boolean }[];
  readonly places: readonly { readonly teamId: string; readonly accountId: string }[];
  readonly active: ReadonlySet<string>;
  readonly credits: readonly ReferralCredit[];
  readonly viewer: string;
}): ReferralLeaderboard {
  const since = input.days ? new Date(input.now.getTime() - input.days * 86_400_000).toISOString() : '';
  const credits = input.credits.filter((c) => c.joinedAt >= since);
  const byReferrer = new Map<string, number>();
  for (const c of credits) byReferrer.set(c.referrer, (byReferrer.get(c.referrer) ?? 0) + 1);
  const rows = input.teams
    .filter((t) => !t.archived)
    .map((t) => {
      const on = input.places.filter((p) => p.teamId === t.teamId);
      return {
        teamId: t.teamId,
        name: t.name,
        color: t.color,
        icon: t.icon,
        joined: on.filter((p) => input.active.has(p.accountId)).reduce((n, p) => n + (byReferrer.get(p.accountId) ?? 0), 0),
        mine: on.some((p) => p.accountId === input.viewer),
      };
    })
    .sort((a, b) => b.joined - a.joined || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const teams = rows.map((row) => ({ ...row, rank: 1 + rows.filter((r) => r.joined > row.joined).length }));
  return { days: input.days, teams, joined: credits.length };
}
