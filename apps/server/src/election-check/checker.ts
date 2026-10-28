import type {
  BylawsCheckUsage,
  BylawsRecord,
  ElectionDefinition,
  ElectionFinding,
  PositionRecord,
  ProposalSnapshotRecord,
} from 'ustp-domain';

/** What a checker compares: the election as it stands, the texts of its proposals, the offices it fills, the bylaws. */
export interface ElectionCheckInput {
  readonly definition: ElectionDefinition;
  readonly proposals: readonly ProposalSnapshotRecord[];
  readonly positions: readonly PositionRecord[];
  readonly bylaws: BylawsRecord;
}

export interface ElectionCheckOutput {
  readonly findings: ElectionFinding[];
  readonly summary: string;
  readonly model: string | null;
  readonly usage: BylawsCheckUsage | null;
}

/** Compares an election's rules with the bylaws (design §6.9). Advisory: its notes decide nothing. */
export interface ElectionChecker {
  readonly name: 'claude' | 'stub';
  check(input: ElectionCheckInput): Promise<ElectionCheckOutput>;
}

export const ELECTION_CHECKER = Symbol('ElectionChecker');

const RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * Keeps findings that cite real bylaws lines (deduplicated, ascending) and name a contest of this election or none; the
 * most severe first, then in ballot order, the election as a whole before its contests.
 */
export function tidyElectionFindings(
  findings: readonly ElectionFinding[],
  lineCount: number,
  definition: Pick<ElectionDefinition, 'contests'>,
): ElectionFinding[] {
  const order = new Map(definition.contests.map((c, i) => [c.contestId, i]));
  const position = (f: ElectionFinding) => (f.contestId === null ? -1 : order.get(f.contestId)!);
  return findings
    .map((f) => ({
      ...f,
      explanation: f.explanation.trim(),
      bylawsLines: [...new Set(f.bylawsLines.filter((n) => Number.isInteger(n) && n >= 1 && n <= lineCount))].sort((a, b) => a - b),
    }))
    .filter((f) => f.bylawsLines.length > 0 && f.explanation && (f.contestId === null || order.has(f.contestId)))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || position(a) - position(b));
}
