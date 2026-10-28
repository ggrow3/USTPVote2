import type {
  BylawsCheckSeverity,
  ElectionCheckChange,
  ElectionCheckTopic,
  ElectionCheckView,
  ElectionFinding,
  PublicElectionCheck,
} from 'ustp-domain';

/**
 * Wording for the election setup check (design §6.9), whose notes every user sees beside the contests. Severity is
 * always shown in words, never colour alone, and every note says it comes from an automated check that can be wrong.
 */

export const NOTE_SEVERITY_LABELS: Record<BylawsCheckSeverity, string> = {
  high: 'Clear mismatch with the bylaws',
  medium: 'Likely mismatch with the bylaws',
  low: 'Worth a look',
};

export const TOPIC_LABELS: Record<ElectionCheckTopic, string> = {
  'pass-threshold': 'pass threshold',
  quorum: 'quorum',
  seats: 'seats',
  term: 'term of office',
  'voting-window': 'voting window',
  secrecy: 'secret or roll-call ballot',
  eligibility: 'who may vote',
  wording: 'how the question is put',
  other: 'other',
};

export const CHANGE_LABELS: Record<ElectionCheckChange, string> = {
  election: 'the election',
  bylaws: 'the bylaws',
  offices: 'an office it fills',
};

/** What the editor's card says before anything else. */
export const INTRO =
  "Claude, an AI model made by Anthropic, compares this election's rules (pass thresholds, quorums, seats and terms, " +
  "the voting window and the kind of ballot) and its proposal texts with the current bylaws, and notes where they may " +
  "not match. The election's setup and the bylaws are sent to Anthropic for this; candidates' names and statements are " +
  'not. It runs once for each version of the election. Once the election is scheduled, every member sees its notes ' +
  'beside the contests. It is advisory: it can miss things or note ones that are not there, and it never stops scheduling.';

/** The notes about one contest, or with `null` the notes about the election as a whole. */
export function notesFor(check: Pick<PublicElectionCheck, 'findings'> | null | undefined, contestId: string | null): ElectionFinding[] {
  return check ? check.findings.filter((f) => f.contestId === contestId) : [];
}

/** A bylaws line as it read when checked, or null if the check did not keep it. */
export function quotedLine(check: Pick<PublicElectionCheck, 'quotedLines'>, line: number): string | null {
  return check.quotedLines.find((q) => q.line === line)?.text ?? null;
}

/** "the election and the bylaws". */
export function changesLabel(changes: readonly ElectionCheckChange[]): string {
  const words = changes.map((c) => CHANGE_LABELS[c]);
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : (words[0] ?? '');
}

/** Who made the notes, as each set of them says. */
export function noteSource(check: Pick<PublicElectionCheck, 'checker'>): string {
  return check.checker === 'stub'
    ? 'Local stand-in for testing, not an AI review.'
    : 'Automated check against the bylaws by Claude, an AI model. It can be wrong; the Election Admins decide.';
}

/** "2 notes", "1 note", "Nothing found to note". */
export function notesCount(n: number): string {
  return n ? `${n} ${n === 1 ? 'note' : 'notes'}` : 'Nothing found to note';
}

/** Where a check stands, in a sentence; empty when there is nothing to say. */
export function statusText(check: Pick<ElectionCheckView, 'status' | 'findings'> | null, requesting = false): string {
  if (requesting) return 'Asking for a check…';
  switch (check?.status) {
    case 'queued':
      return 'Waiting for the server to start the check…';
    case 'running':
      return 'Checking… this usually takes a minute or two.';
    case 'done':
      return `${notesCount(check.findings.length)}.`;
    default:
      return '';
  }
}

/** What screen readers hear when a check finishes (a failure is the card's alert banner, read as it appears). */
export function finishedAnnouncement(check: Pick<ElectionCheckView, 'findings'>): string {
  return `Check against the bylaws finished: ${notesCount(check.findings.length).toLowerCase()}.`;
}

/**
 * The line at the top of the editor, so whoever decides on scheduling sees the check: how many notes and whether they
 * are out of date, or that it has not been run. Empty while it is loading, running or cannot be run.
 */
export function pointerText(check: Pick<ElectionCheckView, 'status' | 'findings' | 'changedSince'> | null, canRun: boolean): string {
  if (!check) return canRun ? 'Not checked against the bylaws yet.' : '';
  if (check.status !== 'done') return '';
  const n = check.findings.length;
  return `Bylaws check: ${n ? notesCount(n) : 'nothing to note'} (advisory)${check.changedSince.length ? ', out of date' : ''}.`;
}
