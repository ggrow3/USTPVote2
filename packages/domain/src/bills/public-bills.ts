import { z } from 'zod';
import { OK, refuse, type Check } from '../check.js';
import {
  billId,
  billLabel,
  billStatus,
  congressGovUrl,
  type BillAction,
  type BillLatestAction,
  type BillLaw,
  type BillRecord,
  type BillRef,
  type BillStatus,
  type BillSummary,
} from './bills.js';

/**
 * The public Legislation page and scorecard (design §5.14, "Legislation and the scorecard"): the science, AI and longevity bills the legislative team
 * picks from its watchlist, each with a summary the team writes for the public, and how each member of Congress voted
 * on them, scored against the position the team marks for the party on each roll call. The team's tags and notes, and
 * who on the team did what, stay private.
 */

/** What a public bill is about, as the team files it. */
export const BILL_TOPICS = ['science', 'ai', 'longevity'] as const;
export type BillTopic = (typeof BILL_TOPICS)[number];

export const BILL_TOPIC_LABELS: Readonly<Record<BillTopic, string>> = {
  science: 'Science',
  ai: 'Artificial intelligence',
  longevity: 'Longevity',
};

/** The topic's name on a chip or a card. */
export const BILL_TOPIC_SHORT: Readonly<Record<BillTopic, string>> = { science: 'Science', ai: 'AI', longevity: 'Longevity' };

export const isBillTopic = (value: unknown): value is BillTopic => typeof value === 'string' && (BILL_TOPICS as readonly string[]).includes(value);

export const CHAMBERS = ['house', 'senate'] as const;
export type Chamber = (typeof CHAMBERS)[number];

export const CHAMBER_LABELS: Readonly<Record<Chamber, string>> = { house: 'House', senate: 'Senate' };

/** A recorded (roll call) vote: its chamber, Congress, session and number. */
export interface RollCallRef {
  readonly chamber: Chamber;
  readonly congress: number;
  readonly session: number;
  readonly roll: number;
}

/** A roll call as a bill's action lists it, with when it was held. */
export interface RecordedVote extends RollCallRef {
  /** When it was held, as Congress.gov gives it (`2023-12-14T15:45:30Z`). */
  readonly date: string;
}

/** `house-119-1-723`, `senate-119-1-343`: the roll call's ID here and in `bill_roll_calls`. */
export const rollCallId = (r: RollCallRef) => `${r.chamber}-${r.congress}-${r.session}-${r.roll}`;

const ROLL_CALL_ID = /^(house|senate)-(\d{2,3})-([1-3])-(\d{1,5})$/;

export function parseRollCallId(id: string): RollCallRef | null {
  const m = ROLL_CALL_ID.exec(id);
  if (!m) return null;
  const roll = Number(m[4]);
  return roll > 0 ? { chamber: m[1] as Chamber, congress: Number(m[2]), session: Number(m[3]), roll } : null;
}

/** The year a session of a Congress sat in: the 119th's first session was 2025. */
export const sessionYear = (congress: number, session: number) => 1789 + 2 * (congress - 1) + (session - 1);

/** The roll call's own page: the Clerk of the House's, or the Senate's. */
export function rollCallUrl(r: RollCallRef): string {
  return r.chamber === 'house'
    ? `https://clerk.house.gov/Votes/${sessionYear(r.congress, r.session)}${r.roll}`
    : `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${r.congress}${r.session}/vote_${r.congress}_${r.session}_${String(r.roll).padStart(5, '0')}.htm`;
}

/** "House roll call 723, 2023". */
export const rollCallLabel = (r: RollCallRef) => `${CHAMBER_LABELS[r.chamber]} roll call ${r.roll}, ${sessionYear(r.congress, r.session)}`;

/** A roll call on a public bill: where it is, when, and the action that recorded it. */
export interface PublicRollCall extends RollCallRef {
  readonly voteId: string;
  readonly date: string;
  /** The action's words ("Passed/agreed to in House: On motion to suspend the rules and pass the bill…"). */
  readonly action: string;
}

/**
 * The roll calls on a bill, from its actions: each once, oldest first. Congress.gov lists a vote under the chamber's
 * action and again under the Library of Congress's, which says what it decided ("Passed/agreed to in House: …"), so
 * the longer words are kept.
 */
export function billRollCalls(actions: readonly BillAction[]): PublicRollCall[] {
  const found = new Map<string, PublicRollCall>();
  for (const action of actions) {
    for (const vote of action.votes ?? []) {
      const voteId = rollCallId(vote);
      const seen = found.get(voteId);
      if (!seen || action.text.length > seen.action.length) {
        found.set(voteId, { chamber: vote.chamber, congress: vote.congress, session: vote.session, roll: vote.roll, voteId, date: vote.date, action: action.text });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.date.localeCompare(b.date) || a.roll - b.roll);
}

/** How one member voted. */
export const VOTE_CASTS = ['yea', 'nay', 'present', 'not_voting'] as const;
export type VoteCast = (typeof VOTE_CASTS)[number];

export const VOTE_CAST_LABELS: Readonly<Record<VoteCast, string>> = { yea: 'Yea', nay: 'Nay', present: 'Present', not_voting: 'Did not vote' };

/**
 * A vote as the House or Senate writes it: Yea or Aye for, Nay or No against, Present, Not Voting. (The House says Aye
 * and No on a recorded vote and Yea and Nay on the yeas and nays; they count alike.) Null for anything else.
 */
export function voteCastOf(text: string): VoteCast | null {
  const t = text.trim().toLowerCase();
  if (t === 'yea' || t === 'aye' || t === 'yes' || t === 'guilty') return 'yea';
  if (t === 'nay' || t === 'no' || t === 'not guilty') return 'nay';
  if (t === 'present') return 'present';
  if (t === 'not voting') return 'not_voting';
  return null;
}

/**
 * A member of Congress, by their Bioguide ID (`A000370`); a senator no longer in office whose Bioguide ID the Senate's
 * record does not give keeps the Senate's own ID (`S354`).
 */
export const MEMBER_ID = /^(?:[A-Z]\d{6}|S\d{3,4})$/;
export const isMemberId = (value: unknown): value is string => typeof value === 'string' && MEMBER_ID.test(value);

/** One member's vote on a roll call, with who they were then. */
export interface MemberVote {
  readonly memberId: string;
  /** "Alma Adams". */
  readonly name: string;
  /** D, R, I, ID… as the chamber records it. */
  readonly party: string | null;
  readonly state: string;
  /** A representative's district (0 at large); null for a senator, or when it is not known. */
  readonly district: number | null;
  readonly vote: VoteCast;
}

export interface RollCallTotals {
  readonly yea: number;
  readonly nay: number;
  readonly present: number;
  readonly notVoting: number;
}

export interface PartyTotals extends RollCallTotals {
  readonly party: string;
}

/** `bill_roll_calls/{voteId}`: one roll call and every member's vote on it, as the chamber recorded it. Kept as read. */
export interface RollCallRecord extends RollCallRef {
  readonly voteId: string;
  readonly date: string;
  /** "On Motion to Suspend the Rules and Pass, as Amended". */
  readonly question: string;
  /** "Passed", "Bill Passed (87-13)". */
  readonly result: string;
  readonly votes: readonly MemberVote[];
  /** Where it was read: Congress.gov's House vote or the Senate's XML. */
  readonly sourceUrl: string;
  readonly fetchedAt: string;
}

export function countVotes(votes: readonly Pick<MemberVote, 'vote'>[]): RollCallTotals {
  const totals = { yea: 0, nay: 0, present: 0, notVoting: 0 };
  for (const v of votes) {
    if (v.vote === 'not_voting') totals.notVoting++;
    else totals[v.vote]++;
  }
  return totals;
}

/** Each party's votes, the largest party first. */
export function partyTotals(votes: readonly MemberVote[]): PartyTotals[] {
  const parties = new Map<string, MemberVote[]>();
  for (const v of votes) {
    const party = v.party ?? '?';
    parties.set(party, [...(parties.get(party) ?? []), v]);
  }
  return [...parties.entries()]
    .map(([party, vs]) => ({ party, ...countVotes(vs) }))
    .sort((a, b) => total(b) - total(a) || a.party.localeCompare(b.party));
}

const total = (t: RollCallTotals) => t.yea + t.nay + t.present + t.notVoting;

/** The party's position on a roll call, as the team marks it: how a Transhumanist would vote. Unmarked is not scored. */
export const PARTY_POSITIONS = ['yea', 'nay'] as const;
export type PartyPosition = (typeof PARTY_POSITIONS)[number];

export const PUBLIC_BILL_LIMITS = {
  summary: 1500,
  /** Public bills at once. */
  bills: 100,
  /** The newest actions the public page shows. */
  actions: 25,
  /** How old a public bill's copy may get before the worker reads it again (design §5.14). */
  refreshAfterMs: 6 * 60 * 60 * 1000,
  /** After a failed read, when to try again. */
  retryAfterMs: 30 * 60 * 1000,
  /** Public bills the worker reads per minute's tick, at most. */
  refreshPerTick: 10,
} as const;

/** What the public record keeps of a bill as Congress.gov describes it, read again every six hours. */
export interface PublicBillSnapshot {
  readonly title: string;
  readonly sponsor: PublicSponsor | null;
  readonly cosponsors: number;
  readonly introducedDate: string | null;
  readonly policyArea: string | null;
  readonly status: BillStatus;
  readonly laws: readonly BillLaw[];
  readonly latestAction: BillLatestAction | null;
  /** The newest actions, newest first, without their votes (which `rollCalls` has). */
  readonly actions: readonly Pick<BillAction, 'date' | 'text'>[];
  /** The newest CRS summary. */
  readonly crsSummary: BillSummary | null;
  readonly rollCalls: readonly PublicRollCall[];
  /** When Congress.gov was last read for it. */
  readonly checkedAt: string;
}

/** A bill's sponsor, as the public pages name them. */
export interface PublicSponsor {
  /** "Rep. Greg Casar". */
  readonly name: string;
  readonly party: string | null;
  readonly state: string | null;
  readonly district: number | null;
}

/** `bill_public/{billId}`: a bill the team shows the public, with what it wrote and marked, and Congress.gov's copy. */
export interface PublicBillRecord extends BillRef, PublicBillSnapshot {
  readonly billId: string;
  readonly topic: BillTopic;
  /** The team's summary for the public, plain text; may be empty. */
  readonly summary: string;
  /** The party's position on each roll call the team marked, by roll call ID; others are not scored. */
  readonly positions: Readonly<Record<string, PartyPosition>>;
  /** When the worker reads it again: six hours after a read, half an hour after a failed one. */
  readonly nextCheckAt: string;
  /** When the last read failed; null once one succeeds. */
  readonly refreshFailedAt: string | null;
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  /** Counts saves, so a change made from an older copy is refused instead of undoing someone else's. */
  readonly version: number;
}

/** "Rep. Casar, Greg [D-TX-35]" as "Rep. Greg Casar"; anything else as written. */
export function sponsorName(fullName: string): string {
  const m = /^(Rep\.|Sen\.|Del\.|Resident Commissioner)\s+([^,]+),\s*([^[]+?)\s*\[[^\]]*\]\s*$/.exec(fullName.trim());
  return m ? `${m[1]} ${m[3]} ${m[2]}` : fullName.trim();
}

/** What the public record keeps of a bill now, from Congress.gov's answer. */
export function publicSnapshot(record: BillRecord, at: string): PublicBillSnapshot {
  const sponsor = record.sponsors[0];
  return {
    title: record.title,
    sponsor: sponsor ? { name: sponsorName(sponsor.fullName), party: sponsor.party, state: sponsor.state, district: sponsor.district } : null,
    cosponsors: record.cosponsors,
    introducedDate: record.introducedDate,
    policyArea: record.policyArea,
    status: billStatus(record.actions, record.laws),
    laws: record.laws,
    latestAction: record.latestAction,
    actions: record.actions.slice(0, PUBLIC_BILL_LIMITS.actions).map((a) => ({ date: a.date, text: a.text })),
    crsSummary: record.summaries[0] ?? null,
    rollCalls: billRollCalls(record.actions),
    checkedAt: at,
  };
}

/** `PUT /v1/bills/public/{billId}`: show a watched bill publicly, or change what the public sees of it. */
export const publicBillSchema = z.strictObject({
  topic: z.enum(BILL_TOPICS),
  summary: z.string().trim().max(PUBLIC_BILL_LIMITS.summary),
  positions: z.record(z.string().max(40), z.enum(PARTY_POSITIONS)).refine((p) => Object.keys(p).length <= 500, 'at most 500 positions'),
  /** The version edited; null to show a bill that is not public yet. */
  basedOn: z.number().int().min(1).nullable(),
});
export type PublicBillInput = z.infer<typeof publicBillSchema>;

/** Whether every position is on one of the bill's roll calls. */
export function checkPositions(positions: Readonly<Record<string, PartyPosition>>, rollCalls: readonly Pick<PublicRollCall, 'voteId'>[]): Check {
  const known = new Set(rollCalls.map((r) => r.voteId));
  const stray = Object.keys(positions).find((id) => !known.has(id));
  return stray ? refuse('conflict', `${stray} is not a roll call on this bill: look again, since its actions may have changed`) : OK;
}

/** `bills.public_changed`: a bill shown publicly, changed, or taken off, with what the public sees after. */
export interface BillPublicChangedPayload {
  readonly billId: string;
  readonly change: 'published' | 'changed' | 'withdrawn';
  readonly topic: BillTopic | null;
  readonly summary: string | null;
  readonly positions: Readonly<Record<string, PartyPosition>> | null;
}

/** The team's view of a bill's public page, on the bill's page in the Bills tool. */
export interface PublicBillTeamView {
  readonly topic: BillTopic;
  readonly summary: string;
  readonly positions: Readonly<Record<string, PartyPosition>>;
  readonly rollCalls: readonly PublicRollCall[];
  /** Roll calls whose members' votes have not been read yet (the worker tries again). */
  readonly unread: readonly string[];
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly checkedAt: string;
  readonly refreshFailedAt: string | null;
  readonly version: number;
}

// --- What the public reads ---------------------------------------------------------------------------------------

/** A public bill in the list (`GET /v1/public/bills`). */
export interface PublicBillCard extends BillRef {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly topic: BillTopic;
  readonly status: BillStatus;
  readonly latestAction: BillLatestAction | null;
  readonly sponsor: PublicSponsor | null;
  readonly summary: string;
  readonly rollCalls: number;
  /** Roll calls the party took a position on. */
  readonly scored: number;
  readonly checkedAt: string;
}

/** A roll call on a public bill's page. */
export interface PublicRollCallView extends PublicRollCall {
  /** Null until the chamber's record of it has been read. */
  readonly question: string | null;
  readonly result: string | null;
  readonly totals: RollCallTotals | null;
  readonly parties: readonly PartyTotals[];
  readonly position: PartyPosition | null;
  readonly sourceUrl: string;
}

/** `GET /v1/public/bills/{billId}`. */
export interface PublicBillView extends PublicBillCard {
  readonly url: string;
  readonly introducedDate: string | null;
  readonly policyArea: string | null;
  readonly cosponsors: number;
  readonly laws: readonly BillLaw[];
  readonly actions: readonly Pick<BillAction, 'date' | 'text'>[];
  readonly crsSummary: BillSummary | null;
  readonly votes: readonly PublicRollCallView[];
}

export function publicBillCard(b: PublicBillRecord): PublicBillCard {
  const ref: BillRef = { congress: b.congress, type: b.type, number: b.number };
  return {
    ...ref,
    id: billId(ref),
    label: billLabel(ref),
    title: b.title,
    topic: b.topic,
    status: b.status,
    latestAction: b.latestAction,
    sponsor: b.sponsor,
    summary: b.summary,
    rollCalls: b.rollCalls.length,
    scored: b.rollCalls.filter((r) => b.positions[r.voteId]).length,
    checkedAt: b.checkedAt,
  };
}

export function publicBillView(b: PublicBillRecord, rollCalls: ReadonlyMap<string, RollCallRecord>): PublicBillView {
  return {
    ...publicBillCard(b),
    url: congressGovUrl(b),
    introducedDate: b.introducedDate,
    policyArea: b.policyArea,
    cosponsors: b.cosponsors,
    laws: b.laws,
    actions: b.actions,
    crsSummary: b.crsSummary,
    votes: [...b.rollCalls].reverse().map((r) => {
      const record = rollCalls.get(r.voteId);
      return {
        ...r,
        question: record?.question ?? null,
        result: record?.result ?? null,
        totals: record ? countVotes(record.votes) : null,
        parties: record ? partyTotals(record.votes) : [],
        position: b.positions[r.voteId] ?? null,
        sourceUrl: rollCallUrl(r),
      };
    }),
  };
}

/** The public list's order: the latest action newest first, then the newest bill. */
export function sortPublicBills<T extends BillRef & { readonly latestAction: BillLatestAction | null }>(bills: readonly T[]): T[] {
  return [...bills].sort((a, b) => (b.latestAction?.date ?? '').localeCompare(a.latestAction?.date ?? '') || b.congress - a.congress || b.number - a.number);
}

// --- The scorecard -------------------------------------------------------------------------------------------------

/** How a vote compares with the party's position: with it, against it, not cast (absent or present), or not scored. */
export type VoteOutcome = 'with' | 'against' | 'missed' | 'unscored';

export function voteOutcome(vote: VoteCast, position: PartyPosition | null): VoteOutcome {
  if (!position) return 'unscored';
  if (vote === 'yea' || vote === 'nay') return vote === position ? 'with' : 'against';
  return 'missed';
}

/** A member of Congress as the scorecard names them: as of their latest vote counted. */
export interface ScorecardMember {
  readonly memberId: string;
  readonly name: string;
  readonly chamber: Chamber;
  readonly party: string | null;
  readonly state: string;
  readonly district: number | null;
}

/** One member's line on the scorecard. */
export interface ScorecardRow extends ScorecardMember {
  readonly with: number;
  readonly against: number;
  /** Scored roll calls they were in but cast no yea or nay (absent, or present). */
  readonly missed: number;
  /** With the party's position as a share of the yeas and nays they cast on scored roll calls; null when none. */
  readonly score: number | null;
}

/** `GET /v1/public/scorecard`. */
export interface ScorecardView {
  readonly rows: readonly ScorecardRow[];
  /** Public bills with a scored roll call, and the scored roll calls. */
  readonly bills: number;
  readonly votes: number;
}

/** One vote on a member's scorecard page. */
export interface ScorecardVote {
  readonly billId: string;
  readonly label: string;
  readonly title: string;
  readonly topic: BillTopic;
  readonly voteId: string;
  readonly chamber: Chamber;
  readonly date: string;
  readonly question: string;
  readonly result: string;
  readonly vote: VoteCast;
  readonly position: PartyPosition | null;
  readonly outcome: VoteOutcome;
  readonly sourceUrl: string;
}

/** `GET /v1/public/scorecard/{memberId}`. */
export interface ScorecardMemberView {
  readonly member: ScorecardRow;
  /** Every vote they cast on a public bill, newest first; the unscored ones too. */
  readonly votes: readonly ScorecardVote[];
}

interface Tally {
  member: ScorecardMember;
  date: string;
  with: number;
  against: number;
  missed: number;
}

/** Each roll call on a public bill that the chamber's record has been read for, with the bill and the party's position. */
function* castVotes(bills: readonly PublicBillRecord[], rollCalls: ReadonlyMap<string, RollCallRecord>) {
  for (const bill of bills) {
    for (const ref of bill.rollCalls) {
      const record = rollCalls.get(ref.voteId);
      if (record) yield { bill, ref, record, position: bill.positions[ref.voteId] ?? null };
    }
  }
}

const memberOf = (v: MemberVote, chamber: Chamber): ScorecardMember => ({
  memberId: v.memberId,
  name: v.name,
  chamber,
  party: v.party,
  state: v.state,
  district: chamber === 'house' ? v.district : null,
});

const scoreOf = (t: Pick<Tally, 'with' | 'against'>) => (t.with + t.against > 0 ? t.with / (t.with + t.against) : null);

/**
 * The scorecard: every member who was in a roll call the party took a position on, how often they voted with it, and
 * how many of those they missed. Sorted by state, senators first, then district and name.
 */
export function scorecard(bills: readonly PublicBillRecord[], rollCalls: ReadonlyMap<string, RollCallRecord>): ScorecardView {
  const tallies = new Map<string, Tally>();
  const scoredBills = new Set<string>();
  let votes = 0;
  for (const { bill, record, position } of castVotes(bills, rollCalls)) {
    if (!position) continue;
    scoredBills.add(bill.billId);
    votes++;
    for (const v of record.votes) {
      const t = tallies.get(v.memberId) ?? { member: memberOf(v, record.chamber), date: record.date, with: 0, against: 0, missed: 0 };
      if (record.date >= t.date) {
        t.member = memberOf(v, record.chamber);
        t.date = record.date;
      }
      const outcome = voteOutcome(v.vote, position);
      if (outcome === 'with') t.with++;
      else if (outcome === 'against') t.against++;
      else t.missed++;
      tallies.set(v.memberId, t);
    }
  }
  const rows = [...tallies.values()].map((t) => ({ ...t.member, with: t.with, against: t.against, missed: t.missed, score: scoreOf(t) })).sort(byPlace);
  return { rows, bills: scoredBills.size, votes };
}

/** One member's scorecard: their line and every vote they cast on a public bill. Null for someone in no roll call here. */
export function memberScorecard(memberId: string, bills: readonly PublicBillRecord[], rollCalls: ReadonlyMap<string, RollCallRecord>): ScorecardMemberView | null {
  const votes: ScorecardVote[] = [];
  let latest: { member: ScorecardMember; date: string } | null = null;
  const tally = { with: 0, against: 0, missed: 0 };
  for (const { bill, ref, record, position } of castVotes(bills, rollCalls)) {
    const v = record.votes.find((m) => m.memberId === memberId);
    if (!v) continue;
    if (!latest || record.date >= latest.date) latest = { member: memberOf(v, record.chamber), date: record.date };
    const outcome = voteOutcome(v.vote, position);
    if (outcome !== 'unscored') tally[outcome]++;
    votes.push({
      billId: bill.billId,
      label: billLabel(bill),
      title: bill.title,
      topic: bill.topic,
      voteId: ref.voteId,
      chamber: record.chamber,
      date: record.date,
      question: record.question,
      result: record.result,
      vote: v.vote,
      position,
      outcome,
      sourceUrl: rollCallUrl(ref),
    });
  }
  if (!latest) return null;
  return {
    member: { ...latest.member, ...tally, score: scoreOf(tally) },
    votes: votes.sort((a, b) => b.date.localeCompare(a.date) || a.voteId.localeCompare(b.voteId)),
  };
}

function byPlace(a: ScorecardMember, b: ScorecardMember): number {
  return (
    a.state.localeCompare(b.state) ||
    (a.chamber === b.chamber ? 0 : a.chamber === 'senate' ? -1 : 1) ||
    (a.district ?? 0) - (b.district ?? 0) ||
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  );
}

/** "Rep. Alma Adams", "Sen. Tammy Baldwin". */
export const memberLabel = (m: Pick<ScorecardMember, 'chamber' | 'name'>) => `${m.chamber === 'house' ? 'Rep.' : 'Sen.'} ${m.name}`;

/** "NC-12", "AK at large", or the state for a senator. */
export function memberPlace(m: Pick<ScorecardMember, 'chamber' | 'state' | 'district'>): string {
  if (m.chamber === 'senate' || m.district === null) return m.state;
  return m.district === 0 ? `${m.state} at large` : `${m.state}-${m.district}`;
}

/** "D-NC-12", "R-WY". */
export function memberTag(m: Pick<ScorecardMember, 'chamber' | 'state' | 'district' | 'party'>): string {
  const place = m.chamber === 'senate' || m.district === null ? m.state : m.district === 0 ? `${m.state}-AL` : `${m.state}-${m.district}`;
  return m.party ? `${m.party}-${place}` : place;
}

/** "80% (4 of 5)", or that no yea or nay of theirs was scored. */
export function scoreLabel(row: Pick<ScorecardRow, 'with' | 'against' | 'score'>): string {
  if (row.score === null) return 'No scored yea or nay';
  return `${Math.round(row.score * 100)}% (${row.with} of ${row.with + row.against})`;
}
