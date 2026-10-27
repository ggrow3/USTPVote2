import type { BylawsCheckReference, BylawsCheckUsage, ConsistencyContest, ConsistencyDocument, ConsistencyFinding } from 'ustp-domain';

/**
 * What a checker reviews: the ballot's questions as the person could read them, the documents the election compares
 * them with, and the bylaws in force then.
 */
export interface ConsistencyCheckInput {
  readonly electionTitle: string;
  readonly electionDescription: string;
  readonly material: readonly ConsistencyContest[];
  readonly documents: readonly ConsistencyDocument[];
  /** Null when no bylaws version is published, or the bylaws are not compared. */
  readonly bylaws: { readonly version: string; readonly title: string; readonly text: string } | null;
}

export interface ConsistencyCheckOutput {
  readonly findings: ConsistencyFinding[];
  readonly summary: string;
  readonly references: readonly BylawsCheckReference[];
  readonly model: string | null;
  readonly usage: BylawsCheckUsage | null;
}

/** Reviews a ballot's proposals against the chosen documents and each other (design §5.5). Advisory: it decides nothing. */
export interface ConsistencyChecker {
  readonly name: 'claude' | 'stub';
  check(input: ConsistencyCheckInput): Promise<ConsistencyCheckOutput>;
}

export const CONSISTENCY_CHECKER = Symbol('ConsistencyChecker');
