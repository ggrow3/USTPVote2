import type { BylawsCheckReference, BylawsCheckUsage, BylawsFinding } from 'ustp-domain';

/** What a checker reviews: the draft, and for scope `changes` the lines to review and the lines removed. */
export interface BylawsCheckInput {
  readonly title: string;
  readonly text: string;
  /** 1-based lines added or changed since `amends`; findings must involve one. Null: review every line. */
  readonly focusLines: readonly number[] | null;
  /** The version the draft amends, and its lines the draft no longer has (context for scope `changes`). */
  readonly amends: string | null;
  readonly removed: readonly { readonly line: number; readonly text: string }[];
}

export interface BylawsCheckOutput {
  readonly findings: BylawsFinding[];
  readonly summary: string;
  readonly references: readonly BylawsCheckReference[];
  readonly model: string | null;
  readonly usage: BylawsCheckUsage | null;
}

/** Reviews a bylaws draft against the references (design §5.2). Advisory: its findings decide nothing. */
export interface BylawsChecker {
  readonly name: 'claude' | 'stub';
  check(input: BylawsCheckInput): Promise<BylawsCheckOutput>;
}

export const BYLAWS_CHECKER = Symbol('BylawsChecker');

/**
 * Keeps findings that name real lines (deduplicated, ascending) and, when only some lines were reviewed, involve one
 * of them; the most severe first, in line order.
 */
export function tidyFindings(findings: readonly BylawsFinding[], lineCount: number, focusLines: readonly number[] | null): BylawsFinding[] {
  const focus = focusLines ? new Set(focusLines) : null;
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return findings
    .map((f) => ({
      ...f,
      provision: f.provision.trim(),
      explanation: f.explanation.trim(),
      lines: [...new Set(f.lines.filter((n) => Number.isInteger(n) && n >= 1 && n <= lineCount))].sort((a, b) => a - b),
    }))
    .filter((f) => f.lines.length > 0 && f.explanation && (!focus || f.lines.some((n) => focus.has(n))))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.lines[0]! - b.lines[0]!);
}
