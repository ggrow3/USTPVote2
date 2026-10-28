import { hashCanonical } from 'ustp-audit';
import type { BylawsCheckSeverity, BylawsCheckUsage } from './bylaws-check.js';
import type { PositionRecord } from './positions.js';

/**
 * The election setup check (design §6.9): an advisory review by Claude of an election's rules against the current
 * bylaws, run by the worker, which notes where a contest's pass threshold, quorum, seats or the election's timing may
 * not be what the bylaws require. It never blocks scheduling, is not ledgered and is not part of the definition hash.
 */

/** What a note is about. */
export const ELECTION_CHECK_TOPICS = [
  'pass-threshold',
  'quorum',
  'seats',
  'term',
  'voting-window',
  'secrecy',
  'eligibility',
  'wording',
  'other',
] as const;
export type ElectionCheckTopic = (typeof ELECTION_CHECK_TOPICS)[number];

export type ElectionCheckStatus = 'queued' | 'running' | 'done' | 'failed';

/** Checks one person may ask for in 24 hours (each costs real money; design §6.9). */
export const MAX_ELECTION_CHECKS_PER_DAY = 20;
/** A check still running after this long is marked failed, so it can be asked for again. */
export const ELECTION_CHECK_TIMEOUT_MINUTES = 10;

/** States in which an election's setup can still be checked: until voting closes. */
export const ELECTION_CHECK_STATES = ['draft', 'scheduled', 'open'] as const;

export interface ElectionFinding {
  /** The contest it is about, or null for the election as a whole (its window, secrecy, eligibility). */
  readonly contestId: string | null;
  /** 1-based lines of the bylaws it rests on, ascending, at least one. */
  readonly bylawsLines: readonly number[];
  readonly topic: ElectionCheckTopic;
  /** The bylaws check's scale: `high` plainly contradicts, `medium` likely does, `low` worth a look. */
  readonly severity: BylawsCheckSeverity;
  readonly explanation: string;
}

/** What a check compared, recorded when it ran, so the page can say when the election, bylaws or offices changed since. */
export interface ElectionCheckBasis {
  /** Hash of the election definition as checked (as `GET /v1/admin/elections/{id}` reports it). */
  readonly definitionHash: string;
  readonly bylaws: { readonly version: string; readonly contentHash: string };
  /** {@link positionsHash} of the offices the election's contests fill. */
  readonly positionsHash: string;
}

/** `election_checks/{checkId}`: asked for through the api, run by the worker. Not ledgered: it decides nothing. */
export interface ElectionCheckRecord {
  readonly checkId: string;
  readonly electionId: string;
  readonly status: ElectionCheckStatus;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /** `claude`, or the emulator-only `stub`; set when the check runs. */
  readonly checker: 'claude' | 'stub' | null;
  /** The model that answered (a fallback model if the requested one declined). */
  readonly model: string | null;
  /** Set when the check runs. */
  readonly basis: ElectionCheckBasis | null;
  readonly findings: readonly ElectionFinding[];
  /** The bylaws lines the findings cite, as they read in the checked version. */
  readonly quotedLines: readonly { readonly line: number; readonly text: string }[];
  readonly summary: string | null;
  readonly error: string | null;
  readonly usage: BylawsCheckUsage | null;
}

/** What has changed since a finished check, so its notes may no longer apply. */
export const ELECTION_CHECK_CHANGES = ['election', 'bylaws', 'offices'] as const;
export type ElectionCheckChange = (typeof ELECTION_CHECK_CHANGES)[number];

/** What the admin routes return: the record, and what has changed since it ran. */
export interface ElectionCheckView extends ElectionCheckRecord {
  readonly changedSince: readonly ElectionCheckChange[];
}

/**
 * `GET /v1/admin/elections/{id}/bylaws-checks`: whether the check can be asked for here (switched on and, for Claude, a
 * key added), and the election's latest check, finished or not.
 */
export interface ElectionCheckState {
  readonly enabled: boolean;
  readonly check: ElectionCheckView | null;
}

/**
 * `GET /v1/public/elections/{id}/bylaws-check`: the check of the election as it was frozen at scheduling, as every user
 * sees it beside the contests (the ballot, the results page). Who asked for it, its cost and any error are left out.
 */
export type PublicElectionCheck = Pick<
  ElectionCheckRecord,
  'checkId' | 'electionId' | 'finishedAt' | 'checker' | 'model' | 'basis' | 'findings' | 'quotedLines' | 'summary'
>;

export function publicElectionCheck(record: ElectionCheckRecord): PublicElectionCheck {
  const { checkId, electionId, finishedAt, checker, model, basis, findings, quotedLines, summary } = record;
  return { checkId, electionId, finishedAt, checker, model, basis, findings, quotedLines, summary };
}

/** What one worker run (`POST /tasks/election-checks`) did. */
export interface ElectionRunResult {
  /** Checks that finished with notes (possibly none). */
  readonly checked: number;
  /** Checks that failed, including any that timed out. */
  readonly failed: number;
}

/** Hash of the offices a check compared, so a later change to one (seats, term) shows the check is out of date. */
export function positionsHash(positions: readonly PositionRecord[]): string {
  return hashCanonical(
    [...positions]
      .sort((a, b) => (a.positionId < b.positionId ? -1 : a.positionId > b.positionId ? 1 : 0))
      .map(({ positionId, title, description, seats, termMonths }) => ({ positionId, title, description, seats, termMonths })),
  );
}

/** Which parts of the basis differ from the election, bylaws and offices as they stand now. */
export function electionCheckChanges(basis: ElectionCheckBasis | null, now: ElectionCheckBasis): ElectionCheckChange[] {
  if (!basis) return [];
  const changes: ElectionCheckChange[] = [];
  if (basis.definitionHash !== now.definitionHash) changes.push('election');
  if (basis.bylaws.version !== now.bylaws.version || basis.bylaws.contentHash !== now.bylaws.contentHash) changes.push('bylaws');
  if (basis.positionsHash !== now.positionsHash) changes.push('offices');
  return changes;
}
