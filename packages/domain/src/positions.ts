import type { ContestResult } from 'ustp-tally';
import { z } from 'zod';
import type { CandidateRecord, ElectionDefinition } from './elections.js';
import type { ResultsBundle } from './results.js';

/**
 * Offices and who holds them (design §6.4). A Membership or Election Admin defines or changes an office directly. A
 * term is created by certifying an election whose candidate contests are tied to the office, or by an appointment two
 * people approve (`position.appoint`, appointments.ts), and ended early only through the two-person `position.modify`.
 */

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/, 'use 2–48 lowercase letters, digits and dashes');
const reason = z.string().trim().min(1, 'a written reason is required').max(2000);

/** `POST /v1/admin/positions`: define a new office or change one; it takes effect at once. */
export const positionInputSchema = z.strictObject({
  positionId: slug,
  title: z.string().trim().min(1, 'enter a title').max(200),
  description: z.string().trim().max(2000).default(''),
  seats: z.number().int().min(1).max(100),
  termMonths: z.number().int().min(1).max(120),
  reason,
});
export type PositionInput = z.infer<typeof positionInputSchema>;

/** `positions/{positionId}` */
export interface PositionRecord {
  readonly positionId: string;
  readonly title: string;
  readonly description: string;
  /** How many people hold the office at once. */
  readonly seats: number;
  /** Term length from certification. */
  readonly termMonths: number;
  readonly definedAt: string;
  /** The `position.modify` request that last defined it, if one did; null when an admin defined it directly. */
  readonly approvalId: string | null;
}

/** What every term of office has, however it came about. */
interface TermFields {
  readonly termId: string;
  readonly positionId: string;
  readonly holderName: string;
  /** The holder's account: always for an appointment, for an elected term when the candidate was entered with one. */
  readonly accountId: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: 'active' | 'ended';
  readonly endedAt: string | null;
  readonly endReason: string | null;
}

/** `position_terms/{termId}`: one person in one office, from one certified result. */
export interface ElectedTermRecord extends TermFields {
  /** Absent on terms certified before appointments existed (design §6.4). */
  readonly basis?: 'election';
  readonly electionId: string;
  readonly contestId: string;
  readonly candidateId: string;
  /** The certified results the term comes from. */
  readonly resultsHash: string;
}

/** `position_terms/{termId}`: one member in one office, from one approved appointment (design §6.4). */
export interface AppointedTermRecord extends TermFields {
  readonly basis: 'appointment';
  readonly accountId: string;
  /** The `position.appoint` request an Auditor approved. */
  readonly approvalId: string;
  /** Why the member was appointed, as requested; public, like the term. */
  readonly reason: string;
}

export type PositionTermRecord = ElectedTermRecord | AppointedTermRecord;

export const isAppointed = (term: PositionTermRecord): term is AppointedTermRecord => term.basis === 'appointment';

/**
 * Two-person payloads (design §10.2). Nothing requests `define` any more (offices are defined directly); requests made
 * before can still be decided.
 */
export type PositionModifyPayload =
  | {
      readonly change: 'define';
      readonly position: Pick<PositionRecord, 'positionId' | 'title' | 'description' | 'seats' | 'termMonths'>;
    }
  | { readonly change: 'end_term'; readonly termId: string; readonly positionId: string };

export interface CertifyPayload {
  readonly electionId: string;
  /** The provisional results an Auditor certifies; certification fails if they are no longer these. */
  readonly resultsHash: string;
}

/** `GET /v1/admin/positions` (every term) and `GET /v1/public/positions` (active terms only). */
export interface PositionsView {
  readonly positions: readonly PositionRecord[];
  readonly terms: readonly PositionTermRecord[];
}

/** `months` calendar months after `iso`, kept on the same day of the month or the month's last day (UTC). */
export function addMonths(iso: string, months: number): string {
  const start = new Date(iso);
  const day = start.getUTCDate();
  const end = new Date(start);
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end.toISOString();
}

/** Winners of a candidate contest, in the order the tally reports them; none for proposals. */
export function winnersOf(result: ContestResult): string[] {
  switch (result.kind) {
    case 'choose_n':
      return [...result.winners];
    case 'irv':
      return result.winner ? [result.winner] : [];
    case 'proposal':
      return [];
  }
}

/**
 * The terms certifying these results creates: one per winner of every candidate contest tied to an office, starting at
 * certification and lasting the office's term. Throws if a contest names an office that does not exist.
 */
export function termsFromResults(input: {
  readonly definition: ElectionDefinition;
  readonly bundle: ResultsBundle;
  readonly resultsHash: string;
  readonly candidates: readonly CandidateRecord[];
  readonly positions: ReadonlyMap<string, Pick<PositionRecord, 'termMonths'>>;
  readonly startsAt: string;
}): Omit<ElectedTermRecord, 'termId' | 'status' | 'endedAt' | 'endReason'>[] {
  const { definition, bundle, resultsHash, candidates, positions, startsAt } = input;
  const terms: Omit<ElectedTermRecord, 'termId' | 'status' | 'endedAt' | 'endReason'>[] = [];
  for (const contest of definition.contests) {
    if (!contest.positionId) continue;
    const position = positions.get(contest.positionId);
    if (!position) throw new Error(`contest “${contest.title}” fills office ${contest.positionId}, which does not exist`);
    const outcome = bundle.contests.find((c) => c.contestId === contest.contestId);
    if (!outcome) throw new Error(`the results have no outcome for contest “${contest.title}”`);
    for (const candidateId of winnersOf(outcome.result)) {
      const candidate = candidates.find((k) => k.candidateId === candidateId && k.contestId === contest.contestId);
      terms.push({
        basis: 'election',
        positionId: contest.positionId,
        electionId: definition.electionId,
        contestId: contest.contestId,
        candidateId,
        holderName: candidate?.name ?? contest.candidates.find((k) => k.candidateId === candidateId)?.name ?? candidateId,
        accountId: candidate?.accountId ?? null,
        startsAt,
        endsAt: addMonths(startsAt, position.termMonths),
        resultsHash,
      });
    }
  }
  return terms;
}
