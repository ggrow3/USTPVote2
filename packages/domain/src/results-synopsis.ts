import type { ProposalContest, Ratio, Threshold } from 'ustp-tally';
import { definitionHash, type ElectionDefinition } from './elections.js';
import type { ResultsRecord } from './results.js';

/**
 * A synopsis of published results (design §9), laid out as the party's own results documents are: the voting window,
 * the roll, ballots cast and turnout; one entry per contest with its counts and shares and how it came out; then a
 * closing tally. Figures only, from the signed bundle and the frozen definition; the web app puts them into words on
 * the results page and in the Word file. Shares stay exact (`part` of `whole`) until `percent` rounds them for display.
 */

/** A count out of a whole, kept exact. */
export interface Share {
  readonly part: number;
  readonly whole: number;
}

interface ContestHead {
  /** 1-based, in definition (ballot) order. */
  readonly number: number;
  readonly contestId: string;
  readonly title: string;
  /** Valid ballots in this contest (blanks included for candidate contests). */
  readonly ballots: number;
  readonly invalid: number;
}

export interface ProposalSynopsis extends ContestHead {
  readonly kind: 'proposal';
  /** Each of the contest's ballots. */
  readonly yes: Share;
  readonly no: Share;
  readonly abstain: Share;
  readonly passRule: ProposalContest['passRule'];
  /** Yes over the pass rule's base (yes + no, every vote, or the whole roll): the share the threshold is judged on. */
  readonly yesShare: Share;
  /** Null when the contest sets no quorum. */
  readonly quorum: { readonly required: number; readonly met: boolean } | null;
  readonly outcome: 'passed' | 'failed' | 'no_quorum';
}

export interface CandidateLine {
  readonly candidateId: string;
  readonly name: string;
  /** Of the contest's ballots, blanks included (the base a support floor uses). */
  readonly votes: Share;
  readonly elected: boolean;
  readonly meetsFloor: boolean;
}

export interface ChooseNSynopsis extends ContestHead {
  readonly kind: 'choose_n';
  readonly seats: number;
  /** Every candidate, most votes first (ties in tie-break order), as the tally ranks them. */
  readonly candidates: readonly CandidateLine[];
  /** Ballots that chose nobody: an abstention. */
  readonly blank: Share;
  readonly supportFloor: Threshold | null;
  readonly vacantSeats: number;
}

export interface IrvSynopsis extends ContestHead {
  readonly kind: 'irv';
  readonly blank: Share;
  readonly rounds: number;
  /**
   * Null when nobody ranked anyone. Its share of the continuing ballots in the first round and in the round that
   * elected it; the rounds in between are left to the full results.
   */
  readonly winner: { readonly candidateId: string; readonly name: string; readonly firstRound: Share; readonly finalRound: Share } | null;
}

export type ContestSynopsis = ProposalSynopsis | ChooseNSynopsis | IrvSynopsis;

export interface SynopsisTally {
  readonly proposals: { readonly total: number; readonly passed: number; readonly failed: number; readonly noQuorum: number };
  /** Ranked-choice contests count as one seat each. */
  readonly candidateContests: { readonly total: number; readonly seats: number; readonly elected: number; readonly vacantSeats: number };
}

export interface ResultsSynopsis {
  readonly electionId: string;
  readonly title: string;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly status: ResultsRecord['status'];
  readonly computedAt: string;
  readonly certifiedAt: string | null;
  /** Ballots cast of the frozen roll. */
  readonly turnout: Share;
  readonly contests: readonly ContestSynopsis[];
  readonly tally: SynopsisTally;
}

const share = (part: number, whole: number): Share => ({ part, whole });

/** Throws if the definition is not the one the results were counted from, as the CSV and Word exports do. */
export function resultsSynopsis(input: { readonly results: ResultsRecord; readonly definition: ElectionDefinition }): ResultsSynopsis {
  const { results, definition } = input;
  const { bundle } = results;
  if (definition.electionId !== results.electionId || definitionHash(definition) !== bundle.definitionHash) {
    throw new Error('the definition is not the one these results were counted from');
  }
  const rollSize = bundle.roll.count;
  const contests = bundle.contests.map((outcome): ContestSynopsis => {
    const i = definition.contests.findIndex((c) => c.contestId === outcome.contestId);
    const contest = definition.contests[i];
    if (!contest) throw new Error(`the definition has no contest ${outcome.contestId}`);
    const name = (id: string) => contest.candidates.find((k) => k.candidateId === id)?.name ?? id;
    const r = outcome.result;
    const head = { number: i + 1, contestId: contest.contestId, title: contest.title, ballots: r.ballots, invalid: r.invalid };
    switch (r.kind) {
      case 'proposal': {
        const { spec } = contest;
        if (spec.kind !== 'proposal') throw new Error(`contest ${contest.contestId} was counted as a proposal`);
        const { yes, no, abstain } = r.counts;
        const base = spec.passRule.base === 'yes_no' ? yes + no : spec.passRule.base === 'yes_no_abstain' ? r.ballots : rollSize;
        return {
          kind: 'proposal',
          ...head,
          yes: share(yes, r.ballots),
          no: share(no, r.ballots),
          abstain: share(abstain, r.ballots),
          passRule: spec.passRule,
          yesShare: share(yes, base),
          quorum: r.quorum.required > 0 ? r.quorum : null,
          outcome: r.outcome,
        };
      }
      case 'choose_n': {
        const { spec } = contest;
        return {
          kind: 'choose_n',
          ...head,
          seats: r.winners.length + r.vacantSeats,
          candidates: r.ranking.map((k) => ({
            candidateId: k.candidateId,
            name: name(k.candidateId),
            votes: share(k.votes, r.ballots),
            elected: r.winners.includes(k.candidateId),
            meetsFloor: k.meetsFloor,
          })),
          blank: share(r.blank, r.ballots),
          supportFloor: (spec.kind === 'choose_n' && spec.supportFloor) || null,
          vacantSeats: r.vacantSeats,
        };
      }
      case 'irv': {
        const first = r.rounds[0];
        const last = r.rounds.at(-1);
        const of = (round: typeof first, id: string) => share(round?.counts[id] ?? 0, round?.continuingBallots ?? 0);
        return {
          kind: 'irv',
          ...head,
          blank: share(r.blank, r.ballots),
          rounds: r.rounds.length,
          winner: r.winner ? { candidateId: r.winner, name: name(r.winner), firstRound: of(first, r.winner), finalRound: of(last, r.winner) } : null,
        };
      }
    }
  });
  return {
    electionId: definition.electionId,
    title: definition.title,
    opensAt: definition.opensAt,
    closesAt: definition.closesAt,
    status: results.status,
    computedAt: results.computedAt,
    certifiedAt: results.certifiedAt ?? null,
    turnout: share(bundle.participationCount, rollSize),
    contests,
    tally: synopsisTally(contests),
  };
}

export function synopsisTally(contests: readonly ContestSynopsis[]): SynopsisTally {
  const proposals = contests.filter((c) => c.kind === 'proposal');
  const candidates = contests.filter((c) => c.kind !== 'proposal');
  const seats = (c: ChooseNSynopsis | IrvSynopsis) => (c.kind === 'irv' ? 1 : c.seats);
  const elected = (c: ChooseNSynopsis | IrvSynopsis) => (c.kind === 'irv' ? (c.winner ? 1 : 0) : c.seats - c.vacantSeats);
  const sum = (f: (c: ChooseNSynopsis | IrvSynopsis) => number) => candidates.reduce((n, c) => n + f(c), 0);
  return {
    proposals: {
      total: proposals.length,
      passed: proposals.filter((p) => p.outcome === 'passed').length,
      failed: proposals.filter((p) => p.outcome === 'failed').length,
      noQuorum: proposals.filter((p) => p.outcome === 'no_quorum').length,
    },
    candidateContests: { total: candidates.length, seats: sum(seats), elected: sum(elected), vacantSeats: sum((c) => seats(c) - elected(c)) },
  };
}

/** Half-up rounding of `part / whole × 100` to `digits` decimals, in exact integer arithmetic, as an integer of 10^-digits. */
function scaledPercent(part: bigint, whole: bigint, digits: number): bigint {
  const scaled = part * 100n * 10n ** BigInt(digits);
  return (2n * scaled + whole) / (2n * whole);
}

function formatScaled(value: bigint, digits: number): string {
  if (!digits) return `${value}%`;
  const text = value.toString().padStart(digits + 1, '0');
  return `${text.slice(0, -digits)}.${text.slice(-digits)}%`;
}

/**
 * A share as a percentage rounded half up to `digits` decimals (one by default, as the party's results give them):
 * 47 of 68 is "69.1%". Exact, so 1 of 8 is "12.5%" rather than whatever floating point makes of it. Null when the
 * whole is zero (nobody voted), which has no percentage.
 */
export function percent(s: Share, digits = 1): string | null {
  if (s.whole <= 0) return null;
  return formatScaled(scaledPercent(BigInt(s.part), BigInt(s.whole), digits), digits);
}

/** The most decimals `comparedPercents` uses; a share this close to the threshold is shown to ten decimals. */
const MAX_DIGITS = 10;

/**
 * A share beside the threshold it is judged against, both as percentages with the same number of decimals: one, or as
 * many more as it takes for rounding not to make them look equal when they are not. Otherwise 1,001 yes of 2,001
 * would read "50.0%" beside "more than half" and passed; it reads "50.02%" against "50.00%". Null for a zero whole.
 */
export function comparedPercents(s: Share, ratio: Ratio): { readonly share: string; readonly threshold: string } | null {
  if (s.whole <= 0) return null;
  const part = BigInt(s.part);
  const whole = BigInt(s.whole);
  const exact = part * BigInt(ratio.den) === BigInt(ratio.num) * whole;
  let digits = 1;
  for (; digits < MAX_DIGITS && !exact; digits++) {
    if (scaledPercent(part, whole, digits) !== scaledPercent(BigInt(ratio.num), BigInt(ratio.den), digits)) break;
  }
  return {
    share: formatScaled(scaledPercent(part, whole, digits), digits),
    threshold: formatScaled(scaledPercent(BigInt(ratio.num), BigInt(ratio.den), digits), digits),
  };
}
