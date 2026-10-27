import type { ConsistencyCheckResult, ConsistencyCheckSource, ConsistencyCheckView, ConsistencyFinding } from 'ustp-domain';

/**
 * Wording for the platform consistency check (design §5.5). Severities use the bylaws check's words
 * (`SEVERITY_LABELS`); sources and outcomes are always words, never colour alone.
 */

export const SOURCE_LABELS: Record<ConsistencyCheckSource, string> = {
  platform: 'the Platform',
  constitution: 'the USTP Constitution',
  'bill-of-rights': 'the Transhumanist Bill of Rights',
  bylaws: 'the bylaws',
  ballot: 'another question on this ballot',
};

/** "With the Platform: Article VI, Section CIV", or "Between questions on this ballot". */
export function sourceText(finding: Pick<ConsistencyFinding, 'source' | 'provision'>): string {
  if (finding.source === 'ballot') return 'Between questions on this ballot';
  return `With ${SOURCE_LABELS[finding.source]}${finding.provision ? `: ${finding.provision}` : ''}`;
}

/** What the check does, before it is run: who reads what, what leaves the system, and the once-only rule. */
export function introText(view: ConsistencyCheckView): string {
  const what = view === 'admin' ? "this election's proposals, as they stand now," : "this ballot's proposals";
  return (
    `Claude, an AI model made by Anthropic, can read ${what} with the party's adopted texts (the USTP Constitution, ` +
    'whose Article VI is the Platform, the Transhumanist Bill of Rights and the bylaws in force) and point out where ' +
    'they may disagree with those texts or with each other. It is advisory: it can miss things or flag things that ' +
    'are not there, and it changes nothing on the ballot.'
  );
}

/** The confirmation before the one run. */
export function confirmText(view: ConsistencyCheckView): string {
  return (
    `The ${view === 'admin' ? "election's" : "ballot's"} proposals are sent to Anthropic for this; nothing about you, or how or whether ` +
    'you voted, is. You can run the check once for this election, and read its result here afterwards. It usually takes a minute or two.'
  );
}

/** Where a check stands, in a sentence; empty before there is one. */
export function statusText(check: ConsistencyCheckResult | null, requesting = false): string {
  if (requesting) return 'Sending the proposals…';
  switch (check?.status) {
    case 'queued':
      return 'Waiting for the server to start the check…';
    case 'running':
      return 'Checking… this usually takes a minute or two.';
    case 'failed':
      return 'The check failed.';
    case 'done': {
      const n = check.findings.length;
      return n ? `${n} possible ${n === 1 ? 'inconsistency' : 'inconsistencies'} found.` : 'No inconsistencies found.';
    }
    default:
      return '';
  }
}

/** What screen readers hear when a check finishes (a failure is the card's alert banner, read as it appears). */
export function finishedAnnouncement(check: ConsistencyCheckResult): string {
  return `Consistency check finished: ${statusText(check)}`;
}

/** The questions a finding concerns, with their titles, in ballot order (positions it does not know are left out). */
export function findingContests(check: Pick<ConsistencyCheckResult, 'contests'>, finding: Pick<ConsistencyFinding, 'contests'>) {
  return finding.contests.flatMap((n) => check.contests.filter((c) => c.position === n));
}

/** Whether the election the editor shows is no longer the one checked (a draft edited since). */
export function changedSince(check: Pick<ConsistencyCheckResult, 'definitionHash'>, currentHash: string | null): boolean {
  return currentHash !== null && check.definitionHash !== currentHash;
}
