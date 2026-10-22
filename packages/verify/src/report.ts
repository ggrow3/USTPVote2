/**
 * The verifier's report: sections of findings. A finding is a check that passed or failed, a step that cannot be
 * checked yet (`pending`: the next worker tick seals, blocks or anchors it, so it is never a failure), or context
 * (`info`). Any failure makes the CLI exit non-zero.
 */
export type Status = 'pass' | 'fail' | 'pending' | 'info';

export interface Finding {
  readonly status: Status;
  readonly label: string;
  readonly detail?: string;
}

export interface Section {
  readonly title: string;
  readonly findings: readonly Finding[];
}

const finding = (status: Status, label: string, detail?: string): Finding =>
  detail === undefined ? { status, label } : { status, label, detail };

export const pass = (label: string, detail?: string) => finding('pass', label, detail);
export const fail = (label: string, detail?: string) => finding('fail', label, detail);
export const pending = (label: string, detail?: string) => finding('pending', label, detail);
export const info = (label: string, detail?: string) => finding('info', label, detail);

/** Problems listed in a failure's detail before the rest are counted. */
const MAX_LISTED = 12;

/** A pass when there are no problems, else one failure listing them. */
export function problemsFinding(label: string, problems: readonly string[], passDetail?: string): Finding {
  if (problems.length === 0) return pass(label, passDetail);
  const listed = problems.slice(0, MAX_LISTED);
  if (problems.length > MAX_LISTED) listed.push(`... and ${problems.length - MAX_LISTED} more`);
  return fail(label, listed.join('\n'));
}

/** A step of one of ustp-domain's checks (`checkReceiptPart`, `checkResults`) as a finding: null means not yet. */
export function stepFinding(step: { readonly label: string; readonly ok: boolean | null; readonly detail?: string }): Finding {
  if (step.ok === true) return pass(step.label, step.detail);
  if (step.ok === false) return fail(step.label, step.detail);
  return pending(step.label, step.detail);
}

export function hasFailures(sections: readonly Section[]): boolean {
  return sections.some((s) => s.findings.some((f) => f.status === 'fail'));
}

const TAGS: Record<Status, string> = { pass: '[ ok ]', fail: '[FAIL]', pending: '[wait]', info: '[info]' };
const INDENT = ' '.repeat(TAGS.pass.length + 3);

/** Plain text (ASCII apart from what the data contains), so it reads the same in any terminal or log. */
export function formatReport(heading: string, sections: readonly Section[]): string {
  const lines = [heading];
  const counts: Record<Status, number> = { pass: 0, fail: 0, pending: 0, info: 0 };
  for (const section of sections) {
    lines.push('', section.title);
    for (const f of section.findings) {
      counts[f.status]++;
      lines.push(`  ${TAGS[f.status]} ${f.label}`);
      for (const line of f.detail?.split('\n') ?? []) lines.push(`${INDENT}${line}`);
    }
  }
  const tail = `${counts.pass} passed, ${counts.fail} failed, ${counts.pending} pending`;
  lines.push('', counts.fail ? `FAILED: ${tail}` : `VERIFIED: ${tail}`);
  return lines.join('\n');
}
