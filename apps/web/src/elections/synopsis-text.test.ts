import type { ChooseNSynopsis, IrvSynopsis, ProposalSynopsis, ResultsSynopsis } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import {
  ballotsText,
  chooseNText,
  floorText,
  irvText,
  outcomeLabel,
  quorumText,
  synopsisFacts,
  tallyText,
  yesShareText,
} from './synopsis-text.js';

const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' as const }, base: 'yes_no' as const };
const of = (part: number, whole: number) => ({ part, whole });

const proposal = (extra: Partial<ProposalSynopsis> = {}): ProposalSynopsis => ({
  kind: 'proposal',
  number: 1,
  contestId: 'q1',
  title: 'Question I',
  ballots: 68,
  invalid: 0,
  yes: of(47, 68),
  no: of(14, 68),
  abstain: of(7, 68),
  passRule: MAJORITY,
  yesShare: of(47, 61),
  quorum: null,
  outcome: 'passed',
  ...extra,
});

const chooseN = (extra: Partial<ChooseNSynopsis> = {}): ChooseNSynopsis => ({
  kind: 'choose_n',
  number: 2,
  contestId: 'q2',
  title: 'Question II',
  ballots: 68,
  invalid: 0,
  seats: 4,
  candidates: [],
  blank: of(23, 68),
  supportFloor: { ratio: { num: 1, den: 2 }, comparison: 'gt' },
  vacantSeats: 1,
  ...extra,
});

const irv = (extra: Partial<IrvSynopsis> = {}): IrvSynopsis => ({
  kind: 'irv',
  number: 4,
  contestId: 'q4',
  title: 'Question IV',
  ballots: 68,
  invalid: 0,
  blank: of(7, 68),
  rounds: 3,
  winner: { candidateId: 'b1', name: 'B-1', firstRound: of(24, 61), finalRound: of(38, 59) },
  ...extra,
});

describe('the facts at the top', () => {
  const when = (iso: string) => iso.slice(0, 10);
  const synopsis: ResultsSynopsis = {
    electionId: 'e1',
    title: 'Platform Vote',
    opensAt: '2026-10-01T14:00:00.000Z',
    closesAt: '2026-10-22T14:00:00.000Z',
    status: 'provisional',
    computedAt: '2026-10-22T14:01:00.000Z',
    certifiedAt: null,
    turnout: of(1234, 1500),
    contests: [],
    tally: { proposals: { total: 0, passed: 0, failed: 0, noQuorum: 0 }, candidateContests: { total: 0, seats: 0, elected: 0, vacantSeats: 0 } },
  };

  it('give the window, roll, ballots, turnout, count time and status', () => {
    expect(synopsisFacts(synopsis, when)).toEqual([
      { label: 'Voting', value: '2026-10-01 to 2026-10-22' },
      { label: 'On the roll', value: '1,500' },
      { label: 'Ballots cast', value: '1,234' },
      { label: 'Turnout', value: '82.3%' },
      { label: 'Counted', value: '2026-10-22' },
      { label: 'Status', value: 'Provisional: signed and in the audit ledger, not yet certified' },
    ]);
  });

  it('say who certified the results, and when', () => {
    const certified = synopsisFacts({ ...synopsis, status: 'certified', certifiedAt: '2026-10-23T09:00:00.000Z' }, when);
    expect(certified.at(-1)).toEqual({ label: 'Status', value: 'Certified 2026-10-23 by an Election Admin and an Auditor' });
  });

  it('show a dash for the turnout of an empty roll', () => {
    expect(synopsisFacts({ ...synopsis, turnout: of(0, 0) }, when)[3]).toEqual({ label: 'Turnout', value: '—' });
  });
});

describe('a proposal', () => {
  it('passes or fails in words, not colour alone', () => {
    expect(outcomeLabel(proposal())).toEqual({ text: 'Passed', tone: 'passed' });
    expect(outcomeLabel(proposal({ outcome: 'failed' }))).toEqual({ text: 'Failed', tone: 'failed' });
    expect(outcomeLabel(proposal({ outcome: 'no_quorum' }))).toEqual({ text: 'No quorum', tone: 'neutral' });
  });

  it('gives the yes share the rule judged, beside the threshold', () => {
    expect(yesShareText(proposal())).toBe('Yes: 77.0% of yes and no votes; needed more than half (50.0%).');
    const twoThirds = { threshold: { ratio: { num: 2, den: 3 }, comparison: 'gte' as const }, base: 'yes_no_abstain' as const };
    expect(yesShareText(proposal({ passRule: twoThirds, yesShare: of(47, 68), outcome: 'passed' }))).toBe(
      'Yes: 69.1% of all votes, abstentions included; needed at least two-thirds (66.7%).',
    );
    const roll = { ...MAJORITY, base: 'roll' as const };
    expect(yesShareText(proposal({ passRule: roll, yesShare: of(47, 120), outcome: 'failed' }))).toBe(
      'Yes: 39.2% of everyone on the voter roll; needed more than half (50.0%).',
    );
  });

  it('shows more decimals where one would hide the difference', () => {
    expect(yesShareText(proposal({ yesShare: of(1001, 2001) }))).toBe('Yes: 50.02% of yes and no votes; needed more than half (50.00%).');
  });

  it('does not repeat a threshold already given as a percentage', () => {
    const sixty = { threshold: { ratio: { num: 60, den: 100 }, comparison: 'gte' as const }, base: 'yes_no' as const };
    expect(yesShareText(proposal({ passRule: sixty }))).toBe('Yes: 77.0% of yes and no votes; needed at least 60%.');
  });

  it('says when there was nothing to judge', () => {
    expect(yesShareText(proposal({ yesShare: of(0, 0), outcome: 'failed' }))).toBe(
      'Yes: no votes to judge; needed more than half of yes and no votes.',
    );
  });

  it('gives the quorum only when there is one', () => {
    expect(quorumText(proposal())).toBeNull();
    expect(quorumText(proposal({ ballots: 38, quorum: { required: 40, met: false }, outcome: 'no_quorum' }))).toBe(
      'Quorum: 38 ballots of the 40 needed; not met.',
    );
    expect(quorumText(proposal({ quorum: { required: 1, met: true } }))).toBe('Quorum: 68 ballots of the 1 needed; met.');
  });

  it('counts its ballots', () => {
    expect(ballotsText(proposal())).toBe('68 ballots');
    expect(ballotsText(proposal({ ballots: 1, invalid: 2 }))).toBe('1 ballot, 2 invalid');
  });
});

describe('a candidate contest', () => {
  it('says how many were elected and how many seats are vacant', () => {
    expect(outcomeLabel(chooseN())).toEqual({ text: '3 elected, 1 vacant', tone: 'neutral' });
    expect(outcomeLabel(chooseN({ vacantSeats: 0 }))).toEqual({ text: '4 elected', tone: 'neutral' });
    expect(outcomeLabel(chooseN({ vacantSeats: 4 }))).toEqual({ text: 'Nobody elected', tone: 'neutral' });
    expect(outcomeLabel(irv())).toEqual({ text: '1 elected', tone: 'neutral' });
    expect(outcomeLabel(irv({ winner: null, rounds: 0 }))).toEqual({ text: 'Nobody elected', tone: 'neutral' });
  });

  it('gives the support floor in words and as a percentage', () => {
    expect(floorText(chooseN())).toBe('A winner needed more than half (50.0%) of the ballots.');
    expect(floorText(chooseN({ supportFloor: { ratio: { num: 1, den: 4 }, comparison: 'gte' } }))).toBe(
      'A winner needed at least 1/4 (25.0%) of the ballots.',
    );
    expect(floorText(chooseN({ supportFloor: null }))).toBeNull();
    expect(chooseNText(chooseN())).toBe('68 ballots (23 blank); 4 seats. A winner needed more than half (50.0%) of the ballots.');
    expect(chooseNText(chooseN({ seats: 1, supportFloor: null, blank: { part: 0, whole: 68 } }))).toBe('68 ballots; 1 seat.');
  });

  it('gives a ranked-choice winner its final and first-round shares, leaving the rounds to the full results', () => {
    expect(irvText(irv())).toBe('Elected: B-1, in round 3 with 38 of 59 continuing ballots (64.4%). First round: 24 of 61 (39.3%).');
    expect(irvText(irv({ rounds: 1, winner: { candidateId: 'b1', name: 'B-1', firstRound: of(40, 61), finalRound: of(40, 61) } }))).toBe(
      'Elected: B-1, in the first round with 40 of 61 continuing ballots (65.6%).',
    );
    expect(irvText(irv({ winner: null, rounds: 0 }))).toBe('Nobody elected: no ballot ranked a candidate.');
  });
});

describe('the closing tally', () => {
  const none = { total: 0, passed: 0, failed: 0, noQuorum: 0 };
  const noSeats = { total: 0, seats: 0, elected: 0, vacantSeats: 0 };

  it('counts the proposals that passed, failed and fell short of quorum', () => {
    expect(tallyText({ proposals: { total: 20, passed: 14, failed: 6, noQuorum: 0 }, candidateContests: noSeats })).toEqual([
      '14 of 20 proposals passed; 6 failed.',
    ]);
    expect(tallyText({ proposals: { total: 4, passed: 2, failed: 1, noQuorum: 1 }, candidateContests: noSeats })).toEqual([
      '2 of 4 proposals passed; 1 failed and 1 fell short of its quorum.',
    ]);
    expect(tallyText({ proposals: { total: 3, passed: 0, failed: 0, noQuorum: 3 }, candidateContests: noSeats })).toEqual([
      '0 of 3 proposals passed; 3 fell short of their quorum.',
    ]);
    expect(tallyText({ proposals: { total: 1, passed: 1, failed: 0, noQuorum: 0 }, candidateContests: noSeats })).toEqual([
      '1 of 1 proposal passed.',
    ]);
  });

  it('counts the seats the candidate contests filled', () => {
    expect(tallyText({ proposals: none, candidateContests: { total: 13, seats: 19, elected: 17, vacantSeats: 2 } })).toEqual([
      '13 candidate contests: 17 of 19 seats filled; 2 left vacant.',
    ]);
    expect(tallyText({ proposals: none, candidateContests: { total: 1, seats: 1, elected: 1, vacantSeats: 0 } })).toEqual([
      '1 candidate contest: 1 of 1 seat filled.',
    ]);
    expect(tallyText({ proposals: none, candidateContests: noSeats })).toEqual(['This election had no contests.']);
  });
});
