/**
 * The bylaws check (design §5.2): an advisory review of a bylaws draft by Claude, run by the worker, that flags lines
 * which may contradict the US Constitution, Transhumanist principles or the USTP Constitution. It never blocks
 * publishing.
 */

/** What a finding says the draft conflicts with. */
export const BYLAWS_CHECK_SOURCES = ['us-constitution', 'transhumanist-principles', 'ustp-constitution'] as const;
export type BylawsCheckSource = (typeof BYLAWS_CHECK_SOURCES)[number];

/**
 * `high`: the text plainly contradicts the provision. `medium`: it likely does, depending on how it is read or applied.
 * `low`: a tension worth a reviewer's look.
 */
export const BYLAWS_CHECK_SEVERITIES = ['high', 'medium', 'low'] as const;
export type BylawsCheckSeverity = (typeof BYLAWS_CHECK_SEVERITIES)[number];

/** `draft`: every line is reviewed. `changes`: only lines added or changed since the version the draft amends. */
export const BYLAWS_CHECK_SCOPES = ['draft', 'changes'] as const;
export type BylawsCheckScope = (typeof BYLAWS_CHECK_SCOPES)[number];

export type BylawsCheckStatus = 'queued' | 'running' | 'done' | 'failed';

/** Checks one Membership Admin may request in 24 hours (each costs real money; design §5.2). */
export const MAX_BYLAWS_CHECKS_PER_DAY = 20;
/** A check still running after this long is marked failed, so it can be requested again. */
export const BYLAWS_CHECK_TIMEOUT_MINUTES = 10;

export interface BylawsFinding {
  /** 1-based line numbers in the checked text, ascending, at least one. */
  readonly lines: readonly number[];
  readonly source: BylawsCheckSource;
  /** Where in the source, as it numbers itself: "Amendment I", "Article V, Section I", "Transhumanist Bill of Rights, Article III". */
  readonly provision: string;
  readonly severity: BylawsCheckSeverity;
  readonly explanation: string;
}

/** The documents a check compares against. "Transhumanist principles" are Article I of the USTP Constitution and the Transhumanist Bill of Rights. */
export const BYLAWS_CHECK_REFERENCE_IDS = ['us-constitution', 'ustp-constitution', 'transhumanist-bill-of-rights'] as const;
export type BylawsCheckReferenceId = (typeof BYLAWS_CHECK_REFERENCE_IDS)[number];

/** Which text of a reference a check used. */
export interface BylawsCheckReference {
  readonly id: BylawsCheckReferenceId;
  readonly title: string;
  readonly url: string;
  /** When the server read it (the snapshot date for the vendored US Constitution), or null if it was not read. */
  readonly retrievedAt: string | null;
  /** When the publisher last changed it, if it says. */
  readonly modifiedAt: string | null;
  /** SHA-256 of the text as sent, lowercase hex, or null if it was not read. */
  readonly sha256: string | null;
}

export interface BylawsCheckUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
}

/** `bylaws_checks/{checkId}`: requested by the api, run by the worker. Not ledgered: it decides nothing. */
export interface BylawsCheckRecord {
  readonly checkId: string;
  readonly status: BylawsCheckStatus;
  readonly scope: BylawsCheckScope;
  readonly title: string;
  /** The published version the draft amends, or null for a first version. */
  readonly amends: string | null;
  readonly text: string;
  /** SHA-256 of `text`, lowercase hex. */
  readonly textHash: string;
  readonly lineCount: number;
  /** Lines added or changed since `amends` (scope `changes`); findings must involve one of them. Null for the whole draft. */
  readonly focusLines: readonly number[] | null;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /** `claude`, or the emulator-only `stub`; set when the check runs. */
  readonly checker: 'claude' | 'stub' | null;
  /** The model that answered (a fallback model if the requested one declined). */
  readonly model: string | null;
  readonly references: readonly BylawsCheckReference[];
  readonly findings: readonly BylawsFinding[];
  readonly summary: string | null;
  readonly error: string | null;
  readonly usage: BylawsCheckUsage | null;
}

/** What the api returns: the record without the text the browser already has. */
export type BylawsCheckView = Omit<BylawsCheckRecord, 'text'>;

/** What one worker run (`POST /tasks/bylaws-checks`) did. */
export interface BylawsRunResult {
  /** Checks that finished with findings (possibly none). */
  readonly checked: number;
  /** Checks that failed, including any that timed out. */
  readonly failed: number;
}
