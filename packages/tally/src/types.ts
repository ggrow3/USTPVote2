/** A non-negative rational number as integers, compared exactly (never via floating point). */
export interface Ratio {
  readonly num: number;
  readonly den: number;
}

/** `gt`: strictly more than the ratio. `gte`: at least the ratio. */
export type Comparison = 'gt' | 'gte';

export interface Threshold {
  readonly ratio: Ratio;
  readonly comparison: Comparison;
}

export type ProposalChoice = 'yes' | 'no' | 'abstain';

export interface ProposalContest {
  readonly kind: 'proposal';
  readonly id: string;
  readonly passRule: {
    readonly threshold: Threshold;
    /**
     * Denominator for the yes share.
     * - `yes_no`: abstentions are ignored.
     * - `yes_no_abstain`: abstentions count against.
     * - `roll`: share of the entire frozen roll.
     */
    readonly base: 'yes_no' | 'yes_no_abstain' | 'roll';
  };
  /** Quorum participation is yes + no + abstain in this contest. Both limits apply when both are set. */
  readonly quorum?: {
    readonly minBallots?: number;
    readonly rollRatio?: Ratio;
  };
}

/** Plurality (seats 1, max 1), block (seats N, max N) or approval (max = all candidates). */
export interface ChooseNContest {
  readonly kind: 'choose_n';
  readonly id: string;
  readonly candidates: readonly string[];
  readonly seats: number;
  readonly maxSelections: number;
  /** Share of valid contest ballots (blanks included) a candidate needs to be eligible for a seat. */
  readonly supportFloor?: Threshold;
}

/** Single-seat instant-runoff. */
export interface IrvContest {
  readonly kind: 'irv';
  readonly id: string;
  readonly candidates: readonly string[];
  /** Defaults to the number of candidates. */
  readonly maxRanks?: number;
}

export type ContestSpec = ProposalContest | ChooseNContest | IrvContest;

export interface TallyContext {
  /** Number of entries on the frozen roll. */
  readonly rollSize: number;
  /**
   * Total order over the contest's candidates used to break ties; earlier is favoured.
   * Required for candidate contests, derived from the election's revealed seed.
   */
  readonly tieBreakOrder?: readonly string[];
}

export interface TieBreakRecord {
  readonly reason: 'seat_cutoff' | 'irv_elimination';
  /** Candidates that were tied, in tie-break order. */
  readonly tied: readonly string[];
  readonly resolvedBy: 'previous_rounds' | 'tie_break_order';
  /** Tied candidates the tie was resolved against (eliminated, or left without a seat). */
  readonly excluded: readonly string[];
  /** 1-based IRV round, when applicable. */
  readonly round?: number;
}

export interface ProposalResult {
  readonly kind: 'proposal';
  readonly contestId: string;
  readonly counts: { readonly yes: number; readonly no: number; readonly abstain: number };
  /** Valid ballots in this contest. */
  readonly ballots: number;
  readonly invalid: number;
  readonly quorum: { readonly required: number; readonly met: boolean };
  readonly outcome: 'passed' | 'failed' | 'no_quorum';
}

export interface CandidateCount {
  readonly candidateId: string;
  readonly votes: number;
  readonly meetsFloor: boolean;
}

export interface ChooseNResult {
  readonly kind: 'choose_n';
  readonly contestId: string;
  /** Valid ballots in this contest, blanks included. */
  readonly ballots: number;
  readonly blank: number;
  readonly invalid: number;
  /** All candidates, ranked by votes then tie-break order. */
  readonly ranking: readonly CandidateCount[];
  readonly winners: readonly string[];
  readonly vacantSeats: number;
  readonly tieBreaks: readonly TieBreakRecord[];
}

export interface IrvRound {
  readonly round: number;
  /** Votes for each continuing candidate. */
  readonly counts: Readonly<Record<string, number>>;
  readonly continuingBallots: number;
  readonly exhausted: number;
  readonly elected?: string;
  readonly eliminated?: string;
}

export interface IrvResult {
  readonly kind: 'irv';
  readonly contestId: string;
  /** Valid ballots in this contest, blanks included. */
  readonly ballots: number;
  readonly blank: number;
  readonly invalid: number;
  readonly rounds: readonly IrvRound[];
  readonly winner: string | null;
  readonly tieBreaks: readonly TieBreakRecord[];
}

export type ContestResult = ProposalResult | ChooseNResult | IrvResult;
