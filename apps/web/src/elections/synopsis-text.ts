import {
  comparedPercents,
  percent,
  type ChooseNSynopsis,
  type ContestSynopsis,
  type IrvSynopsis,
  type ProposalSynopsis,
  type ResultsSynopsis,
  type Share,
  type SynopsisTally,
} from 'ustp-domain';
import { ratioText, thresholdText } from '../election-text.js';

/**
 * A results synopsis in words (design §9), shared by the results page and the Word file so both say the same thing:
 * the facts at the top, each contest's figures and outcome, and the closing tally.
 */

export const count = (n: number) => n.toLocaleString('en-US');
/** "69.1%", or a dash where nobody voted. */
export const share = (s: Share) => percent(s) ?? '—';
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

export interface Fact {
  readonly label: string;
  readonly value: string;
}

export function statusText(s: Pick<ResultsSynopsis, 'status' | 'certifiedAt'>, when: (iso: string) => string): string {
  return s.status === 'certified'
    ? `Certified${s.certifiedAt ? ` ${when(s.certifiedAt)}` : ''} by an Election Admin and an Auditor`
    : 'Provisional: signed and in the audit ledger, not yet certified';
}

/** The synopsis's opening lines: when voting ran, the roll, ballots cast, turnout, and whether the results are final. */
export function synopsisFacts(s: ResultsSynopsis, when: (iso: string) => string): Fact[] {
  return [
    { label: 'Voting', value: `${when(s.opensAt)} to ${when(s.closesAt)}` },
    { label: 'On the roll', value: count(s.turnout.whole) },
    { label: 'Ballots cast', value: count(s.turnout.part) },
    { label: 'Turnout', value: share(s.turnout) },
    { label: 'Counted', value: when(s.computedAt) },
    { label: 'Status', value: statusText(s, when) },
  ];
}

export type Tone = 'passed' | 'failed' | 'neutral';

const PROPOSAL_OUTCOME = {
  passed: { text: 'Passed', tone: 'passed' },
  failed: { text: 'Failed', tone: 'failed' },
  no_quorum: { text: 'No quorum', tone: 'neutral' },
} as const satisfies Record<ProposalSynopsis['outcome'], { text: string; tone: Tone }>;

/** How a contest came out, in a word or two: "Passed", "Failed", "No quorum", "3 elected, 1 vacant". */
export function outcomeLabel(c: ContestSynopsis): { readonly text: string; readonly tone: Tone } {
  if (c.kind === 'proposal') return PROPOSAL_OUTCOME[c.outcome];
  const seats = c.kind === 'irv' ? 1 : c.seats;
  const elected = c.kind === 'irv' ? (c.winner ? 1 : 0) : c.seats - c.vacantSeats;
  if (!elected) return { text: 'Nobody elected', tone: 'neutral' };
  return { text: elected < seats ? `${count(elected)} elected, ${count(seats - elected)} vacant` : `${count(elected)} elected`, tone: 'neutral' };
}

const BASE_WORDS: Record<ProposalSynopsis['passRule']['base'], string> = {
  yes_no: 'of yes and no votes',
  yes_no_abstain: 'of all votes, abstentions included',
  roll: 'of everyone on the voter roll',
};

/** "68 ballots", with invalid ones when there were any. */
export function ballotsText(c: Pick<ContestSynopsis, 'ballots' | 'invalid'> & { readonly blank?: Share }): string {
  const blank = c.blank?.part ? ` (${count(c.blank.part)} blank)` : '';
  return `${plural(c.ballots, 'ballot')}${blank}${c.invalid ? `, ${count(c.invalid)} invalid` : ''}`;
}

/**
 * The yes share the pass rule judged, beside its threshold: "Yes: 77.0% of yes and no votes; needed more than half
 * (50.0%)." Both get extra decimals when one would make them look equal (`comparedPercents`).
 */
export function yesShareText(p: ProposalSynopsis): string {
  const { threshold, base } = p.passRule;
  const needs = thresholdText(threshold);
  const shown = comparedPercents(p.yesShare, threshold.ratio);
  if (!shown) return `Yes: no votes to judge; needed ${needs} ${BASE_WORDS[base]}.`;
  const exact = ratioText(threshold.ratio).endsWith('%') ? '' : ` (${shown.threshold})`;
  return `Yes: ${shown.share} ${BASE_WORDS[base]}; needed ${needs}${exact}.`;
}

export function quorumText(p: ProposalSynopsis): string | null {
  if (!p.quorum) return null;
  return `Quorum: ${plural(p.ballots, 'ballot')} of the ${count(p.quorum.required)} needed; ${p.quorum.met ? 'met' : 'not met'}.`;
}

/** What a winner of a choose-N contest needed, if the contest sets a support floor. */
export function floorText(c: ChooseNSynopsis): string | null {
  if (!c.supportFloor) return null;
  const { ratio } = c.supportFloor;
  const exact = ratioText(ratio).endsWith('%') ? '' : ` (${share({ part: ratio.num, whole: ratio.den })})`;
  return `A winner needed ${thresholdText(c.supportFloor)}${exact} of the ballots.`;
}

/** "68 ballots (23 blank); 4 seats. A winner needed more than half (50.0%) of the ballots." */
export function chooseNText(c: ChooseNSynopsis): string {
  return [`${ballotsText(c)}; ${plural(c.seats, 'seat')}.`, floorText(c)].filter(Boolean).join(' ');
}

/** The winner of a ranked-choice contest, with its share in the round that elected it and in the first round. */
export function irvText(c: IrvSynopsis): string {
  if (!c.winner) return 'Nobody elected: no ballot ranked a candidate.';
  const { name, firstRound, finalRound } = c.winner;
  const of = (s: Share) => `${count(s.part)} of ${count(s.whole)}`;
  const final = `${of(finalRound)} continuing ballots (${share(finalRound)})`;
  return c.rounds === 1
    ? `Elected: ${name}, in the first round with ${final}.`
    : `Elected: ${name}, in round ${c.rounds} with ${final}. First round: ${of(firstRound)} (${share(firstRound)}).`;
}

/** The closing tally: "14 of 20 proposals passed; 6 failed." and the seats the candidate contests filled. */
export function tallyText(t: SynopsisTally): string[] {
  const lines: string[] = [];
  const p = t.proposals;
  if (p.total) {
    const rest = [
      p.failed ? `${count(p.failed)} failed` : '',
      p.noQuorum ? `${count(p.noQuorum)} fell short of ${p.noQuorum === 1 ? 'its' : 'their'} quorum` : '',
    ].filter(Boolean);
    lines.push(`${count(p.passed)} of ${plural(p.total, 'proposal')} passed${rest.length ? `; ${rest.join(' and ')}` : ''}.`);
  }
  const k = t.candidateContests;
  if (k.total) {
    const vacant = k.vacantSeats ? `; ${count(k.vacantSeats)} left vacant` : '';
    lines.push(`${plural(k.total, 'candidate contest')}: ${count(k.elected)} of ${plural(k.seats, 'seat')} filled${vacant}.`);
  }
  return lines.length ? lines : ['This election had no contests.'];
}
