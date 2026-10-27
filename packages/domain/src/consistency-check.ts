/**
 * The platform consistency check (design §5.5): an advisory review by Claude of whether an election's proposals agree
 * with the party's adopted texts and with each other, which a voter on the roll or an Election Admin or Auditor may ask
 * for once per election. It works from the texts the person can already read and changes no ballot, vote or result.
 */
import { amendmentText, type BylawsAmendment } from './amendments.js';
import type { BylawsCheckReference, BylawsCheckSeverity, BylawsCheckUsage } from './bylaws-check.js';
import { refuse, OK, type Check } from './check.js';
import type { ElectionDefinition } from './elections.js';

/**
 * What a finding says a question may be inconsistent with: the Platform (Article VI of the USTP Constitution), the rest
 * of the USTP Constitution, the Transhumanist Bill of Rights, the bylaws in force, or another question on the ballot.
 */
export const CONSISTENCY_CHECK_SOURCES = ['platform', 'constitution', 'bill-of-rights', 'bylaws', 'ballot'] as const;
export type ConsistencyCheckSource = (typeof CONSISTENCY_CHECK_SOURCES)[number];

/** Which texts the check was built from: the ballot a voter on the roll reads, or the election editor's. */
export const CONSISTENCY_CHECK_VIEWS = ['ballot', 'admin'] as const;
export type ConsistencyCheckView = (typeof CONSISTENCY_CHECK_VIEWS)[number];

export type ConsistencyCheckStatus = 'queued' | 'running' | 'done' | 'failed';

/** Checks the whole server takes on in 24 hours, whoever asks (each costs real money; design §15). */
export const MAX_CONSISTENCY_CHECKS_PER_DAY = 100;
/** A check still running after this long is marked failed, so it can be asked for again. */
export const CONSISTENCY_CHECK_TIMEOUT_MINUTES = 10;
/** The most text one check sends about the ballot: the bylaws check's limit on a draft. */
export const MAX_CONSISTENCY_MATERIAL_CHARACTERS = 500_000;
/** A quoted passage is cut to this length. */
export const MAX_PASSAGE_CHARACTERS = 400;

/**
 * One question on the ballot as the check reads it. Its `position` is its place on the ballot, counted over every
 * contest, so "Question 4" is the fourth contest the voter sees.
 */
export interface ConsistencyContest {
  readonly position: number;
  readonly contestId: string;
  readonly title: string;
  readonly description: string;
  readonly kind: 'proposal' | 'choose_n' | 'irv';
  /** For `choose_n`: how many options are adopted or elected, and how many a voter may choose. */
  readonly seats: number | null;
  readonly maxSelections: number | null;
  /** The proposal's text, with the bylaws lines it changes in words (`amendmentText`); null without a proposal. */
  readonly proposal: { readonly title: string; readonly body: string; readonly amendment: string | null } | null;
  readonly options: readonly { readonly name: string; readonly statement: string | null }[];
}

/** The proposal texts of a ballot (a voter's `BallotView.proposals`, or the admin's snapshots). */
export interface ProposalText {
  readonly snapshotId: string;
  readonly title: string;
  readonly body: string;
  readonly amendment?: BylawsAmendment | null;
}

/**
 * The questions a consistency check reviews, in ballot order: every proposal, and every candidate contest that fills
 * no office (the options of "current section or amendment" and ranked platform questions). Contests that fill an
 * office elect people, whom the check does not assess.
 */
export function consistencyMaterial(definition: Pick<ElectionDefinition, 'contests'>, proposals: readonly ProposalText[]): ConsistencyContest[] {
  return definition.contests.flatMap((c, i): ConsistencyContest[] => {
    if (c.positionId) return [];
    const text = c.proposal ? proposals.find((p) => p.snapshotId === c.proposal!.snapshotId) : undefined;
    return [
      {
        position: i + 1,
        contestId: c.contestId,
        title: c.title,
        description: c.description,
        kind: c.spec.kind,
        seats: c.spec.kind === 'choose_n' ? c.spec.seats : null,
        maxSelections: c.spec.kind === 'choose_n' ? c.spec.maxSelections : null,
        proposal: c.proposal
          ? {
              title: text?.title ?? c.proposal.title,
              body: text?.body ?? '',
              amendment: text?.amendment ? amendmentText(text.amendment) : null,
            }
          : null,
        options: c.candidates.map(({ name, statement }) => ({ name, statement })),
      },
    ];
  });
}

/** Every word of a question that a finding may quote. */
export function contestText(contest: ConsistencyContest): string {
  return [
    contest.title,
    contest.description,
    contest.proposal?.title,
    contest.proposal?.body,
    contest.proposal?.amendment,
    ...contest.options.flatMap((o) => [o.name, o.statement]),
  ]
    .filter((s): s is string => !!s)
    .join('\n');
}

/** How much text the material sends. */
export function materialCharacters(material: readonly ConsistencyContest[]): number {
  return material.reduce((n, c) => n + contestText(c).length, 0);
}

export interface ConsistencyFinding {
  /** Ballot positions of the questions that take part, ascending, at least one (two or more for `ballot`). */
  readonly contests: readonly number[];
  readonly source: ConsistencyCheckSource;
  /** Where in the source, as it numbers itself ("Article VI, Section XXVII"), or the other question ("Question 4"). */
  readonly provision: string;
  /** The words of the ballot the finding concerns, exactly as one of its questions has them; null if none were quoted exactly. */
  readonly passage: string | null;
  readonly severity: BylawsCheckSeverity;
  readonly explanation: string;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const unquote = (s: string) => squash(s).replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').replace(/^…|…$/g, '').trim();

/**
 * Keeps findings that name questions the check reviewed (deduplicated, ascending), two or more for a conflict within
 * the ballot, and with an explanation; a passage is kept only if one of those questions has exactly those words
 * (spacing aside). The most severe first, in ballot order.
 */
export function tidyConsistencyFindings(findings: readonly ConsistencyFinding[], material: readonly ConsistencyContest[]): ConsistencyFinding[] {
  const byPosition = new Map(material.map((c) => [c.position, c]));
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return findings
    .map((f) => {
      const contests = [...new Set(f.contests.filter((n) => byPosition.has(n)))].sort((a, b) => a - b);
      const quoted = f.passage ? unquote(f.passage).slice(0, MAX_PASSAGE_CHARACTERS) : '';
      const found = quoted.length > 0 && contests.some((n) => squash(contestText(byPosition.get(n)!)).includes(quoted));
      return { ...f, contests, provision: f.provision.trim(), explanation: f.explanation.trim(), passage: found ? quoted : null };
    })
    .filter((f) => f.contests.length >= (f.source === 'ballot' ? 2 : 1) && f.explanation)
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.contests[0]! - b.contests[0]!);
}

/** `consistency_checks/{electionId}_{accountId}`: one per person per election, which is what makes the rule hold. */
export function consistencyCheckId(electionId: string, accountId: string): string {
  return `${electionId}_${accountId}`;
}

/** Not ledgered: it decides nothing. */
export interface ConsistencyCheckRecord {
  readonly checkId: string;
  readonly electionId: string;
  readonly electionTitle: string;
  readonly electionDescription: string;
  readonly view: ConsistencyCheckView;
  /** The definition the questions were read from: the frozen one on a ballot, a draft's as it stood when asked. */
  readonly definitionHash: string;
  readonly material: readonly ConsistencyContest[];
  /** SHA-256 of the material as JSON, lowercase hex. */
  readonly materialHash: string;
  /** The bylaws version in force when asked (its text goes to Claude too), or null if none is published. */
  readonly bylaws: { readonly version: string; readonly contentHash: string } | null;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly status: ConsistencyCheckStatus;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly checker: 'claude' | 'stub' | null;
  readonly model: string | null;
  readonly references: readonly BylawsCheckReference[];
  readonly findings: readonly ConsistencyFinding[];
  readonly summary: string | null;
  readonly error: string | null;
  readonly usage: BylawsCheckUsage | null;
}

/** A question the check reviewed, for links from its findings. */
export type ConsistencyContestRef = Pick<ConsistencyContest, 'position' | 'contestId' | 'title'>;

/** What the api returns: the record with the questions named rather than repeated. */
export type ConsistencyCheckResult = Omit<ConsistencyCheckRecord, 'material'> & { readonly contests: readonly ConsistencyContestRef[] };

/** `GET …/consistency-check`: whether the server can run the check, and the caller's own check of the election, if any. */
export interface ConsistencyCheckState {
  readonly enabled: boolean;
  readonly check: ConsistencyCheckResult | null;
}

/** What one worker run (`POST /tasks/consistency-checks`) did. */
export interface ConsistencyRunResult {
  readonly checked: number;
  readonly failed: number;
}

/**
 * Whether a person may ask for a check of this election now (design §5.5): once each, so not again after a check
 * finished or while one is under way; a check that failed, or has run longer than it may, does not count. The server
 * as a whole takes {@link MAX_CONSISTENCY_CHECKS_PER_DAY} a day.
 */
export function checkConsistencyRequest(
  existing: Pick<ConsistencyCheckRecord, 'status' | 'requestedAt' | 'startedAt'> | null,
  checksToday: number,
  now: Date,
): Check {
  if (existing?.status === 'done') {
    return refuse('conflict', 'you have already run the consistency check for this election; each person may run it once per election');
  }
  if (existing && (existing.status === 'queued' || existing.status === 'running')) {
    const since = Date.parse(existing.startedAt ?? existing.requestedAt);
    if (now.getTime() - since < CONSISTENCY_CHECK_TIMEOUT_MINUTES * 60_000) {
      return refuse('conflict', 'your consistency check of this election is still running; wait for it to finish');
    }
  }
  if (checksToday >= MAX_CONSISTENCY_CHECKS_PER_DAY) {
    return refuse('rate_limited', `the server has run its ${MAX_CONSISTENCY_CHECKS_PER_DAY} consistency checks for today; try again tomorrow`);
  }
  return OK;
}
