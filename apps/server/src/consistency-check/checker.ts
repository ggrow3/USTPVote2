import type { BylawsCheckReference, BylawsCheckUsage, ConsistencyContest, ConsistencyFinding } from 'ustp-domain';

/** What a checker reviews: the ballot's questions as the person could read them, and the bylaws in force then. */
export interface ConsistencyCheckInput {
  readonly electionTitle: string;
  readonly electionDescription: string;
  readonly material: readonly ConsistencyContest[];
  /** Null when no bylaws version is published. */
  readonly bylaws: { readonly version: string; readonly title: string; readonly text: string } | null;
}

export interface ConsistencyCheckOutput {
  readonly findings: ConsistencyFinding[];
  readonly summary: string;
  readonly references: readonly BylawsCheckReference[];
  readonly model: string | null;
  readonly usage: BylawsCheckUsage | null;
}

/** Reviews a ballot's proposals against the party's adopted texts and each other (design §5.5). Advisory: it decides nothing. */
export interface ConsistencyChecker {
  readonly name: 'claude' | 'stub';
  check(input: ConsistencyCheckInput): Promise<ConsistencyCheckOutput>;
}

export const CONSISTENCY_CHECKER = Symbol('ConsistencyChecker');
