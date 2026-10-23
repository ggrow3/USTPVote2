import type { BylawsCheckReference, BylawsCheckSeverity, BylawsCheckSource, BylawsFinding } from 'ustp-domain';

/** Wording for the bylaws check (design §5.2): severities and sources are always shown as words, never colour alone. */

export const SOURCE_LABELS: Record<BylawsCheckSource, string> = {
  'us-constitution': 'US Constitution',
  'transhumanist-principles': 'Transhumanist principles',
  'ustp-constitution': 'USTP Constitution',
};

export const SEVERITY_LABELS: Record<BylawsCheckSeverity, string> = {
  high: 'Clear conflict',
  medium: 'Likely conflict',
  low: 'Possible tension',
};

export const SEVERITY_ICONS: Record<BylawsCheckSeverity, string> = { high: 'error', medium: 'warning', low: 'info' };

/** "line 4", "lines 4-6 and 9". */
export function linesLabel(lines: readonly number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j + 1 < lines.length && lines[j + 1] === lines[j]! + 1) j++;
    runs.push(i === j ? `${lines[i]}` : `${lines[i]}–${lines[j]}`);
    i = j + 1;
  }
  const list = runs.length > 1 ? `${runs.slice(0, -1).join(', ')} and ${runs.at(-1)}` : (runs[0] ?? '');
  return `${lines.length === 1 ? 'line' : 'lines'} ${list}`;
}

/**
 * For each line of the current draft that a finding names: the 1-based numbers of those findings. A line edited since
 * the check (its text differs from the checked text at that position) is not flagged, since the finding was about
 * what it said then.
 */
export function flaggedLines(findings: readonly BylawsFinding[], checkedLines: readonly string[], currentLines: readonly string[]): Map<number, number[]> {
  const flags = new Map<number, number[]>();
  findings.forEach((finding, i) => {
    for (const line of finding.lines) {
      if (!stillReads(line, checkedLines, currentLines)) continue;
      flags.set(line, [...(flags.get(line) ?? []), i + 1]);
    }
  });
  return flags;
}

/** Whether line `n` reads now as it did when checked. */
export function stillReads(n: number, checkedLines: readonly string[], currentLines: readonly string[]): boolean {
  return n >= 1 && n <= currentLines.length && checkedLines[n - 1] === currentLines[n - 1];
}

/** "Finding 2", "Findings 1 and 3". */
export function findingsLabel(numbers: readonly number[]): string {
  if (numbers.length === 1) return `Finding ${numbers[0]}`;
  return `Findings ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}

/** Which text of a reference was used: "read 22 Oct 2026, page updated 14 Sep 2026". */
export function referenceNote(ref: BylawsCheckReference, locale?: string): string {
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (!ref.retrievedAt) return 'not read by the stand-in';
  if (ref.id === 'us-constitution') return `National Archives transcription, snapshot of ${day(ref.retrievedAt)}`;
  return `read ${day(ref.retrievedAt)}${ref.modifiedAt ? `, page updated ${day(ref.modifiedAt)}` : ''}`;
}
