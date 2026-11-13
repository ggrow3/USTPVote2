import { describe, expect, it } from 'vitest';
import type { BillAction, BillRecord } from './bills.js';
import {
  billRollCalls,
  checkPositions,
  memberPlace,
  memberScorecard,
  memberTag,
  parseRollCallId,
  partyTotals,
  publicBillCard,
  publicBillSchema,
  publicBillView,
  publicSnapshot,
  rollCallId,
  rollCallUrl,
  scoreLabel,
  scorecard,
  sessionYear,
  sortPublicBills,
  sponsorName,
  voteCastOf,
  voteOutcome,
  type MemberVote,
  type PublicBillRecord,
  type RollCallRecord,
} from './public-bills.js';

const house = (roll: number, date: string) => ({ chamber: 'house' as const, congress: 118, session: 1, roll, date });
const senate = (roll: number, date: string) => ({ chamber: 'senate' as const, congress: 118, session: 1, roll, date });

describe('roll calls', () => {
  it('have an ID that reads back', () => {
    const ref = { chamber: 'house' as const, congress: 119, session: 2, roll: 45 };
    expect(rollCallId(ref)).toBe('house-119-2-45');
    expect(parseRollCallId('house-119-2-45')).toEqual(ref);
    expect(parseRollCallId('senate-118-1-343')).toEqual({ chamber: 'senate', congress: 118, session: 1, roll: 343 });
    for (const bad of ['house-119-2-0', 'house-119-4-1', 'assembly-119-1-1', 'house-119-1-1/x', 'house-1-1-1', '']) expect(parseRollCallId(bad), bad).toBeNull();
  });

  it('link to the chamber’s own page, in the year its session sat', () => {
    expect(sessionYear(118, 1)).toBe(2023);
    expect(sessionYear(119, 2)).toBe(2026);
    expect(rollCallUrl({ chamber: 'house', congress: 118, session: 1, roll: 723 })).toBe('https://clerk.house.gov/Votes/2023723');
    expect(rollCallUrl({ chamber: 'senate', congress: 118, session: 1, roll: 343 })).toBe(
      'https://www.senate.gov/legislative/LIS/roll_call_votes/vote1181/vote_118_1_00343.htm',
    );
  });

  it('are found once each in a bill’s actions, oldest first, with the fuller words', () => {
    const actions: BillAction[] = [
      { date: '2023-12-14', text: 'On motion to suspend the rules and agree to the conference report Agreed to (Roll no. 723).', type: 'Floor', source: 'House floor actions', votes: [house(723, '2023-12-14T15:45:30Z')] },
      {
        date: '2023-12-14',
        text: 'Conference report agreed to in House: On motion to suspend the rules and agree to the conference report Agreed to (Roll no. 723).',
        type: 'Floor',
        source: 'Library of Congress',
        votes: [house(723, '2023-12-14T15:45:30Z')],
      },
      { date: '2023-12-13', text: 'Senate agreed to conference report by Yea-Nay Vote. 87 - 13. Record Vote Number: 343.', type: 'Floor', source: 'Senate', votes: [senate(343, '2023-12-14T00:38:48Z')] },
      { date: '2023-06-01', text: 'Introduced in House', type: 'IntroReferral', source: 'Library of Congress' },
    ];
    const found = billRollCalls(actions);
    expect(found.map((r) => r.voteId)).toEqual(['senate-118-1-343', 'house-118-1-723']);
    expect(found[1]!.action).toMatch(/^Conference report agreed to in House/);
  });

  it('read a member’s vote as the chambers write it', () => {
    expect(['Yea', 'Aye', 'yes'].map(voteCastOf)).toEqual(['yea', 'yea', 'yea']);
    expect(['Nay', 'No'].map(voteCastOf)).toEqual(['nay', 'nay']);
    expect(voteCastOf('Present')).toBe('present');
    expect(voteCastOf('Not Voting')).toBe('not_voting');
    expect(voteCastOf('Abstain')).toBeNull();
  });

  it('count each party, the largest first', () => {
    const votes: MemberVote[] = [
      { memberId: 'A000001', name: 'A', party: 'D', state: 'CA', district: 1, vote: 'yea' },
      { memberId: 'A000002', name: 'B', party: 'R', state: 'TX', district: 2, vote: 'nay' },
      { memberId: 'A000003', name: 'C', party: 'R', state: 'TX', district: 3, vote: 'not_voting' },
    ];
    expect(partyTotals(votes)).toEqual([
      { party: 'R', yea: 0, nay: 1, present: 0, notVoting: 1 },
      { party: 'D', yea: 1, nay: 0, present: 0, notVoting: 0 },
    ]);
  });
});

describe('a public bill', () => {
  const record: BillRecord = {
    congress: 119,
    type: 'hr',
    number: 10538,
    title: 'Ban Artificial Superintelligence Act of 2026',
    chamber: 'House',
    introducedDate: '2026-09-24',
    updatedAt: '2026-10-14T18:28:57Z',
    policyArea: 'Government Operations and Politics',
    sponsors: [{ bioguideId: 'C001131', fullName: 'Rep. Casar, Greg [D-TX-35]', party: 'D', state: 'TX', district: 35 }],
    cosponsors: 12,
    latestAction: { date: '2026-10-01', text: 'Passed House' },
    laws: [],
    actions: [
      { date: '2026-10-01', text: 'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 300 - 100 (Roll no. 9).', type: 'Floor', source: 'Library of Congress', votes: [{ chamber: 'house', congress: 119, session: 2, roll: 9, date: '2026-10-01T16:00:00Z' }] },
      { date: '2026-09-24', text: 'Introduced in House', type: 'IntroReferral', source: 'Library of Congress' },
    ],
    summaries: [{ versionLabel: 'Introduced in House', date: '2026-09-24', paragraphs: ['A summary.'] }],
    textVersions: [],
  };

  it('names its sponsor as people do', () => {
    expect(sponsorName('Rep. Casar, Greg [D-TX-35]')).toBe('Rep. Greg Casar');
    expect(sponsorName('Sen. Sanders, Bernard [I-VT]')).toBe('Sen. Bernard Sanders');
    expect(sponsorName('Someone')).toBe('Someone');
  });

  it('keeps what Congress.gov says of it, with its status and roll calls', () => {
    const snap = publicSnapshot(record, '2026-11-12T00:00:00.000Z');
    expect(snap.status).toBe('passed_house');
    expect(snap.sponsor).toEqual({ name: 'Rep. Greg Casar', party: 'D', state: 'TX', district: 35 });
    expect(snap.rollCalls.map((r) => r.voteId)).toEqual(['house-119-2-9']);
    expect(snap.actions[0]).toEqual({ date: '2026-10-01', text: record.actions[0]!.text });
    expect(snap.crsSummary?.paragraphs).toEqual(['A summary.']);
  });

  it('takes a topic, a summary and positions on its own roll calls only', () => {
    expect(publicBillSchema.safeParse({ topic: 'ai', summary: '  Why it matters ', positions: { 'house-119-2-9': 'nay' }, basedOn: null }).data?.summary).toBe('Why it matters');
    expect(publicBillSchema.safeParse({ topic: 'politics', summary: '', positions: {}, basedOn: null }).success).toBe(false);
    expect(publicBillSchema.safeParse({ topic: 'ai', summary: 'x'.repeat(1501), positions: {}, basedOn: null }).success).toBe(false);
    expect(publicBillSchema.safeParse({ topic: 'ai', summary: '', positions: { x: 'maybe' }, basedOn: null }).success).toBe(false);
    const rollCalls = publicSnapshot(record, '2026-11-12T00:00:00.000Z').rollCalls;
    expect(checkPositions({ 'house-119-2-9': 'yea' }, rollCalls).ok).toBe(true);
    expect(checkPositions({ 'house-119-2-10': 'yea' }, rollCalls)).toMatchObject({ ok: false, refusal: 'conflict' });
  });
});

/** Two bills, one roll call each (a House vote marked Nay, a Senate vote marked Yea), and one House vote unmarked. */
function fixture() {
  const at = '2026-11-12T00:00:00.000Z';
  const member = (memberId: string, name: string, party: string, state: string, district: number | null, vote: MemberVote['vote']): MemberVote => ({ memberId, name, party, state, district, vote });
  const rollCalls = new Map<string, RollCallRecord>([
    [
      'house-119-2-9',
      {
        chamber: 'house',
        congress: 119,
        session: 2,
        roll: 9,
        voteId: 'house-119-2-9',
        date: '2026-10-01T16:00:00Z',
        question: 'On Passage',
        result: 'Passed',
        votes: [member('C001131', 'Greg Casar', 'D', 'TX', 35, 'nay'), member('A000055', 'Robert Aderholt', 'R', 'AL', 4, 'yea'), member('K000389', 'Ro Khanna', 'D', 'CA', 17, 'not_voting')],
        sourceUrl: 'https://api.congress.gov/v3/house-vote/119/2/9',
        fetchedAt: at,
      },
    ],
    [
      'house-119-2-10',
      {
        chamber: 'house',
        congress: 119,
        session: 2,
        roll: 10,
        voteId: 'house-119-2-10',
        date: '2026-10-02T16:00:00Z',
        question: 'On Motion to Recommit',
        result: 'Failed',
        votes: [member('C001131', 'Greg Casar', 'D', 'TX', 35, 'yea')],
        sourceUrl: 'https://api.congress.gov/v3/house-vote/119/2/10',
        fetchedAt: at,
      },
    ],
    [
      'senate-119-2-5',
      {
        chamber: 'senate',
        congress: 119,
        session: 2,
        roll: 5,
        voteId: 'senate-119-2-5',
        date: '2026-10-05T16:00:00Z',
        question: 'On Passage of the Bill',
        result: 'Bill Passed (60-40)',
        votes: [member('S000033', 'Bernard Sanders', 'I', 'VT', null, 'yea'), member('G000574', 'Ruben Gallego', 'D', 'AZ', null, 'present')],
        sourceUrl: 'https://www.senate.gov/x.xml',
        fetchedAt: at,
      },
    ],
  ]);
  const bill = (number: number, latest: string, votes: { voteId: string; date: string }[], positions: PublicBillRecord['positions']): PublicBillRecord => ({
    congress: 119,
    type: 'hr',
    number,
    billId: `119-hr-${number}`,
    topic: 'ai',
    summary: 'Why it matters.',
    positions,
    title: `Bill ${number}`,
    sponsor: null,
    cosponsors: 0,
    introducedDate: '2026-01-01',
    policyArea: null,
    status: 'passed_house',
    laws: [],
    latestAction: { date: latest, text: 'Moved' },
    actions: [],
    crsSummary: null,
    rollCalls: votes.map(({ voteId, date }) => ({ ...parseRollCallId(voteId)!, voteId, date, action: 'Passed' })),
    checkedAt: at,
    nextCheckAt: at,
    refreshFailedAt: null,
    publishedAt: at,
    publishedBy: 'acct',
    updatedAt: at,
    updatedBy: 'acct',
    version: 1,
  });
  const bills = [
    bill(1, '2026-10-02', [
      { voteId: 'house-119-2-9', date: '2026-10-01T16:00:00Z' },
      { voteId: 'house-119-2-10', date: '2026-10-02T16:00:00Z' },
    ], { 'house-119-2-9': 'nay' }),
    bill(2, '2026-10-05', [{ voteId: 'senate-119-2-5', date: '2026-10-05T16:00:00Z' }], { 'senate-119-2-5': 'yea' }),
  ];
  return { bills, rollCalls };
}

describe('the scorecard', () => {
  it('scores a yea or nay against the position, and anything else as missed', () => {
    expect(voteOutcome('yea', 'yea')).toBe('with');
    expect(voteOutcome('nay', 'yea')).toBe('against');
    expect(voteOutcome('present', 'yea')).toBe('missed');
    expect(voteOutcome('not_voting', 'nay')).toBe('missed');
    expect(voteOutcome('yea', null)).toBe('unscored');
  });

  it('counts each member on the roll calls the party took a position on, by state, senators first', () => {
    const { bills, rollCalls } = fixture();
    const view = scorecard(bills, rollCalls);
    expect(view).toMatchObject({ bills: 2, votes: 2 });
    expect(view.rows.map((r) => [r.memberId, r.with, r.against, r.missed, r.score])).toEqual([
      ['A000055', 0, 1, 0, 0],
      ['G000574', 0, 0, 1, null],
      ['K000389', 0, 0, 1, null],
      ['C001131', 1, 0, 0, 1],
      ['S000033', 1, 0, 0, 1],
    ]);
  });

  it('shows one member every vote of theirs on a public bill, newest first, the unscored ones too', () => {
    const { bills, rollCalls } = fixture();
    const view = memberScorecard('C001131', bills, rollCalls)!;
    expect(view.member).toMatchObject({ name: 'Greg Casar', chamber: 'house', state: 'TX', district: 35, with: 1, against: 0, missed: 0, score: 1 });
    expect(view.votes.map((v) => [v.voteId, v.vote, v.position, v.outcome])).toEqual([
      ['house-119-2-10', 'yea', null, 'unscored'],
      ['house-119-2-9', 'nay', 'nay', 'with'],
    ]);
    expect(view.votes[1]!.sourceUrl).toBe('https://clerk.house.gov/Votes/20269');
    expect(memberScorecard('Z999999', bills, rollCalls)).toBeNull();
  });

  it('names a member’s place and score', () => {
    expect(memberPlace({ chamber: 'house', state: 'TX', district: 35 })).toBe('TX-35');
    expect(memberPlace({ chamber: 'house', state: 'AK', district: 0 })).toBe('AK at large');
    expect(memberPlace({ chamber: 'senate', state: 'VT', district: null })).toBe('VT');
    expect(memberTag({ chamber: 'house', state: 'TX', district: 35, party: 'D' })).toBe('D-TX-35');
    expect(memberTag({ chamber: 'senate', state: 'VT', district: null, party: 'I' })).toBe('I-VT');
    expect(scoreLabel({ with: 4, against: 1, score: 0.8 })).toBe('80% (4 of 5)');
    expect(scoreLabel({ with: 0, against: 0, score: null })).toBe('No scored yea or nay');
  });

  it('lists public bills by their latest action, with their roll calls and positions', () => {
    const { bills, rollCalls } = fixture();
    expect(sortPublicBills(bills.map(publicBillCard)).map((b) => b.id)).toEqual(['119-hr-2', '119-hr-1']);
    expect(publicBillCard(bills[0]!)).toMatchObject({ label: 'H.R. 1', rollCalls: 2, scored: 1 });
    const view = publicBillView(bills[0]!, rollCalls);
    expect(view.url).toBe('https://www.congress.gov/bill/119th-congress/house-bill/1');
    expect(view.votes.map((v) => [v.voteId, v.position, v.totals])).toEqual([
      ['house-119-2-10', null, { yea: 1, nay: 0, present: 0, notVoting: 0 }],
      ['house-119-2-9', 'nay', { yea: 1, nay: 1, present: 0, notVoting: 1 }],
    ]);
    // A roll call whose record has not been read yet is listed without its counts.
    expect(publicBillView(bills[0]!, new Map()).votes[0]).toMatchObject({ question: null, totals: null, parties: [] });
  });
});
