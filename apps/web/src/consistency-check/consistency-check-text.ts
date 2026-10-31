import type {
  BylawsCheckReference,
  ConsistencyCheckResult,
  ConsistencyCheckSource,
  ConsistencyCheckView,
  ConsistencyDocument,
  ConsistencyFinding,
} from 'ustp-domain';

/**
 * Wording for the platform consistency check (design §5.5). Severities use the bylaws check's words
 * (`SEVERITY_LABELS`); sources and outcomes are always words, never colour alone.
 */

export const SOURCE_LABELS: Record<ConsistencyCheckSource, string> = {
  platform: 'the Platform',
  constitution: 'the USTP Constitution',
  'bill-of-rights': 'the Transhumanist Bill of Rights',
  bylaws: 'the bylaws',
  'us-constitution': 'the Constitution of the United States',
  ballot: 'another question on this ballot',
};

/** Each document, as a sentence names it and as its checkbox is labelled. */
export const DOCUMENT_LABELS: Record<ConsistencyDocument, string> = {
  'ustp-constitution': 'the USTP Constitution (whose Article VI is the Platform)',
  'transhumanist-bill-of-rights': 'the Transhumanist Bill of Rights',
  bylaws: 'the bylaws in force',
  'us-constitution': 'the Constitution of the United States',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "a", "a and b", "a, b and c". */
function inWords(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** A checkbox's label: "The Transhumanist Bill of Rights". */
export function documentLabel(document: ConsistencyDocument): string {
  return cap(DOCUMENT_LABELS[document]);
}

/** What the checks compare with, for those who cannot change it: "Compares the questions with …, and with each other." */
export function documentsText(documents: readonly ConsistencyDocument[]): string {
  if (!documents.length) return 'Compares the questions with each other only: no documents are chosen.';
  return `Compares the questions with ${inWords(documents.map((d) => DOCUMENT_LABELS[d]))}, and with each other.`;
}

/** Said when an Election Admin's change is saved. */
export function documentsAnnouncement(documents: readonly ConsistencyDocument[]): string {
  return `Saved. ${documentsText(documents)}`;
}

/**
 * What a result was compared with, in a sentence: each document (a reference with where it was read from), the
 * bylaws version, and the other questions.
 */
export function comparedParts(
  check: Pick<ConsistencyCheckResult, 'documents' | 'references' | 'bylaws'>,
): { readonly text: string; readonly reference: BylawsCheckReference | null }[] {
  return check.documents.map((d) => {
    const reference = check.references.find((r) => r.id === d) ?? null;
    if (d === 'bylaws') {
      return { text: check.bylaws ? `the bylaws, version ${check.bylaws.version}` : 'the bylaws (none were published)', reference: null };
    }
    return { text: reference?.title ?? DOCUMENT_LABELS[d], reference };
  });
}

/** "With the Platform: Article VI, Section CIV", or "Between questions on this ballot". */
export function sourceText(finding: Pick<ConsistencyFinding, 'source' | 'provision'>): string {
  if (finding.source === 'ballot') return 'Between questions on this ballot';
  return `With ${SOURCE_LABELS[finding.source]}${finding.provision ? `: ${finding.provision}` : ''}`;
}

/** What the check does, before it is run: what it reads and compares, naming only the documents chosen. */
export function introText(view: ConsistencyCheckView, documents: readonly ConsistencyDocument[]): string {
  const what = view === 'admin' ? "this election's proposals, as they stand now," : "this ballot's proposals";
  const compare = documents.length
    ? `with ${inWords(documents.map((d) => DOCUMENT_LABELS[d]))}, and point out where they may disagree with those texts or with each other`
    : 'and point out where they may disagree with each other';
  return (
    `Claude, an AI model made by Anthropic, can read ${what} ${compare}. It is advisory: it can miss things or flag ` +
    'things that are not there, and it changes nothing on the ballot.'
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

/** The card's one line while it is folded: where the person's check stands, or that there is one they can run. */
export function summaryText(
  check: ConsistencyCheckResult | null,
  { available, requesting = false, error = false }: { available: boolean; requesting?: boolean; error?: boolean },
): string {
  if (error) return 'Something went wrong: open this to read what.';
  if (requesting || check?.status === 'queued' || check?.status === 'running') return 'Checking…';
  if (check) return statusText(check);
  return available ? 'An advisory check by Claude. Not run yet.' : 'Nothing to check: every contest elects someone.';
}

/** In the button's place once the person has had their check: it runs once, so here is the saved result. */
export function usedText(check: Pick<ConsistencyCheckResult, 'requestedAt'>, locale?: string): string {
  const day = new Date(check.requestedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return `You have used your one consistency check of this election (asked for on ${day}). Its result is kept here for you to read again.`;
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
