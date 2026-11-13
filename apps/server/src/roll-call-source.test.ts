import { describe, expect, it } from 'vitest';
import { BillSourceError, recordedVotesOf } from './bills/bill-source.js';
import { houseRollCall, legislatorIndex, PublicRollCallSource, senateRollCall, senateXmlUrl } from './bills/roll-call-source.js';

/** The design's sources, as they answered on 2026-11-12 (trimmed): congress-legislators, Congress.gov, the Senate. */
const LEGISLATORS = [
  { id: { bioguide: 'A000370' }, name: { first: 'Alma', last: 'Adams', official_full: 'Alma S. Adams' }, terms: [{ type: 'rep', state: 'NC', district: 12 }] },
  { id: { bioguide: 'Y000064' }, name: { first: 'Todd', last: 'Young' }, terms: [{ type: 'rep', state: 'IN', district: 9 }, { type: 'sen', state: 'IN' }] },
  { id: { bioguide: 'B001230', lis: 'S354' }, name: { first: 'Tammy', last: 'Baldwin', official_full: 'Tammy Baldwin' }, terms: [{ type: 'sen', state: 'WI' }] },
] as const;

const HOUSE_VOTE = {
  houseRollCallVote: { congress: 118, result: 'Passed', rollCallNumber: 723, sessionNumber: 1, voteQuestion: 'On Motion to Suspend the Rules and Agree to the Conference Report' },
};

const HOUSE_MEMBERS = {
  houseRollCallVoteMemberVotes: {
    results: [
      { bioguideID: 'A000055', firstName: 'Robert', lastName: 'Aderholt', voteCast: 'Yea', voteParty: 'R', voteState: 'AL' },
      { bioguideID: 'A000370', firstName: 'Alma', lastName: 'Adams', voteCast: 'Nay', voteParty: 'D', voteState: 'NC' },
      { bioguideID: 'A000371', firstName: 'Pete', lastName: 'Aguilar', voteCast: 'Not Voting', voteParty: 'D', voteState: 'CA' },
      { bioguideID: 'A000372', firstName: 'Rick', lastName: 'Allen', voteCast: 'Aye', voteParty: 'R', voteState: 'GA' },
      { bioguideID: 'bad', firstName: 'No', lastName: 'Body', voteCast: 'Yea', voteParty: 'R', voteState: 'GA' },
      { bioguideID: 'A000373', firstName: 'Some', lastName: 'One', voteCast: 'Abstained', voteParty: 'R', voteState: 'GA' },
    ],
  },
};

const SENATE_XML = `<?xml version="1.0" encoding="UTF-8"?><roll_call_vote>
  <congress>118</congress>
  <session>1</session>
  <vote_number>343</vote_number>
  <vote_question_text>On the Conference Report H.R. 2670</vote_question_text>
  <vote_result_text>Conference Report Agreed to (87-13)</vote_result_text>
  <question>On the Conference Report</question>
  <members>
    <member>
      <member_full>Baldwin (D-WI)</member_full>
      <last_name>Baldwin</last_name>
      <first_name>Tammy</first_name>
      <party>D</party>
      <state>WI</state>
      <vote_cast>Yea</vote_cast>
      <lis_member_id>S354</lis_member_id>
    </member>
    <member>
      <last_name>O&apos;Gone</last_name>
      <first_name>Former</first_name>
      <party>R</party>
      <state>WY</state>
      <vote_cast>Nay</vote_cast>
      <lis_member_id>S317</lis_member_id>
    </member>
    <member>
      <last_name>Absent</last_name>
      <first_name>Someone</first_name>
      <party>I</party>
      <state>VT</state>
      <vote_cast>Not Voting</vote_cast>
      <lis_member_id>S313</lis_member_id>
    </member>
  </members>
</roll_call_vote>`;

const HOUSE_REF = { chamber: 'house' as const, congress: 118, session: 1, roll: 723 };
const SENATE_REF = { chamber: 'senate' as const, congress: 118, session: 1, roll: 343 };
const AT = '2026-11-12T00:00:00.000Z';

describe('roll calls on a bill’s actions (design §5.14)', () => {
  it('are read from Congress.gov’s recorded votes, the malformed left out', () => {
    expect(
      recordedVotesOf([
        { chamber: 'House', congress: 118, date: '2023-12-14T15:45:30Z', rollNumber: 723, sessionNumber: 1 },
        { chamber: 'Senate', congress: '118', date: '2023-12-14T00:38:48Z', rollNumber: '343', sessionNumber: '1' },
        { chamber: 'Assembly', congress: 118, date: '2023-12-14T00:38:48Z', rollNumber: 1, sessionNumber: 1 },
        { chamber: 'House', congress: 118, rollNumber: 2, sessionNumber: 1 },
      ]),
    ).toEqual([
      { chamber: 'house', congress: 118, session: 1, roll: 723, date: '2023-12-14T15:45:30Z' },
      { chamber: 'senate', congress: 118, session: 1, roll: 343, date: '2023-12-14T00:38:48Z' },
    ]);
    expect(recordedVotesOf(undefined)).toEqual([]);
  });
});

describe('a House roll call', () => {
  it('has each member’s vote, named and placed from congress-legislators', () => {
    const index = legislatorIndex(LEGISLATORS);
    const record = houseRollCall(HOUSE_REF, '2023-12-14T15:45:30Z', HOUSE_VOTE, HOUSE_MEMBERS.houseRollCallVoteMemberVotes.results, index, AT);
    expect(record).toMatchObject({ voteId: 'house-118-1-723', question: 'On Motion to Suspend the Rules and Agree to the Conference Report', result: 'Passed', date: '2023-12-14T15:45:30Z' });
    expect(record.votes).toEqual([
      { memberId: 'A000055', name: 'Robert Aderholt', party: 'R', state: 'AL', district: null, vote: 'yea' },
      { memberId: 'A000370', name: 'Alma S. Adams', party: 'D', state: 'NC', district: 12, vote: 'nay' },
      { memberId: 'A000371', name: 'Pete Aguilar', party: 'D', state: 'CA', district: null, vote: 'not_voting' },
      { memberId: 'A000372', name: 'Rick Allen', party: 'R', state: 'GA', district: null, vote: 'yea' },
    ]);
  });

  it('places a member now in the Senate by the vote’s state only', () => {
    const index = legislatorIndex(LEGISLATORS);
    const [young] = houseRollCall(HOUSE_REF, AT, HOUSE_VOTE, [{ bioguideID: 'Y000064', firstName: 'Todd', lastName: 'Young', voteCast: 'Yea', voteParty: 'R', voteState: 'IN' }], index, AT).votes;
    expect(young).toMatchObject({ name: 'Todd Young', district: null });
  });
});

describe('a Senate roll call', () => {
  it('has each senator’s vote by Bioguide ID, a former senator by the Senate’s ID', () => {
    const record = senateRollCall(SENATE_REF, '2023-12-14T00:38:48Z', SENATE_XML, legislatorIndex(LEGISLATORS), AT)!;
    expect(record).toMatchObject({ voteId: 'senate-118-1-343', question: 'On the Conference Report H.R. 2670', result: 'Conference Report Agreed to (87-13)' });
    expect(record.votes).toEqual([
      { memberId: 'B001230', name: 'Tammy Baldwin', party: 'D', state: 'WI', district: null, vote: 'yea' },
      { memberId: 'S317', name: "Former O'Gone", party: 'R', state: 'WY', district: null, vote: 'nay' },
      { memberId: 'S313', name: 'Someone Absent', party: 'I', state: 'VT', district: null, vote: 'not_voting' },
    ]);
    expect(record.sourceUrl).toBe(senateXmlUrl(SENATE_REF));
    expect(senateRollCall(SENATE_REF, AT, '<html>not found</html>', legislatorIndex([]), AT)).toBeNull();
  });
});

describe('the public roll call source', () => {
  /** A fetch that answers from a table of addresses, recording what it was asked. */
  function fakeFetch(routes: Record<string, () => Response>) {
    const asked: { url: string; headers: Record<string, string> }[] = [];
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      asked.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      const route = Object.keys(routes).find((r) => url.startsWith(r));
      return route ? routes[route]!() : new Response('missing', { status: 404 });
    }) as typeof fetch;
    return { fetchFn, asked };
  }
  const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('reads a House vote and its members from Congress.gov with the key in a header', async () => {
    const { fetchFn, asked } = fakeFetch({
      'https://unitedstates.github.io/': json(LEGISLATORS),
      'https://api.congress.gov/v3/house-vote/118/1/723/members': json(HOUSE_MEMBERS),
      'https://api.congress.gov/v3/house-vote/118/1/723?': json(HOUSE_VOTE),
    });
    const record = await new PublicRollCallSource(async () => 'K'.repeat(40), fetchFn).rollCall(HOUSE_REF, '2023-12-14T15:45:30Z');
    expect(record?.votes).toHaveLength(4);
    const congress = asked.filter((a) => a.url.startsWith('https://api.congress.gov/'));
    expect(congress.every((a) => a.headers['X-Api-Key'] === 'K'.repeat(40) && !a.url.includes('KKKK'))).toBe(true);
  });

  it('reads a Senate vote from the Senate’s XML, with no key', async () => {
    const { fetchFn, asked } = fakeFetch({
      'https://unitedstates.github.io/': json(LEGISLATORS),
      'https://www.senate.gov/legislative/LIS/roll_call_votes/vote1181/vote_118_1_00343.xml': () => new Response(SENATE_XML, { status: 200 }),
    });
    const record = await new PublicRollCallSource(async () => 'K'.repeat(40), fetchFn).rollCall(SENATE_REF, '2023-12-14T00:38:48Z');
    expect(record?.votes[0]?.memberId).toBe('B001230');
    expect(asked.find((a) => a.url.includes('senate.gov'))?.headers['X-Api-Key']).toBeUndefined();
  });

  it('answers null for a roll call the chamber does not have, and keeps the chamber’s names without congress-legislators', async () => {
    const { fetchFn } = fakeFetch({ 'https://www.senate.gov/legislative/LIS/roll_call_votes/vote1181/vote_118_1_00343.xml': () => new Response(SENATE_XML) });
    const source = new PublicRollCallSource(async () => 'K'.repeat(40), fetchFn);
    expect(await source.rollCall(HOUSE_REF, AT)).toBeNull();
    expect((await source.rollCall(SENATE_REF, AT))?.votes[0]).toMatchObject({ memberId: 'S354', name: 'Tammy Baldwin' });
  });

  it('says when Congress.gov is at its limit or refuses the key', async () => {
    const limited = new PublicRollCallSource(async () => 'K'.repeat(40), fakeFetch({ 'https://api.congress.gov/': json({}, 429) }).fetchFn);
    await expect(limited.rollCall(HOUSE_REF, AT)).rejects.toMatchObject({ kind: 'rate_limited', service: 'Congress.gov' });
    const refused = new PublicRollCallSource(async () => 'K'.repeat(40), fakeFetch({ 'https://api.congress.gov/': json({}, 403) }).fetchFn);
    await expect(refused.rollCall(HOUSE_REF, AT)).rejects.toBeInstanceOf(BillSourceError);
    await expect(refused.rollCall(HOUSE_REF, AT)).rejects.toMatchObject({ kind: 'key_refused' });
    const down = new PublicRollCallSource(async () => 'K'.repeat(40), fakeFetch({ 'https://www.senate.gov/': () => new Response('busy', { status: 503 }) }).fetchFn);
    await expect(down.rollCall(SENATE_REF, AT)).rejects.toMatchObject({ kind: 'unreachable', service: 'Senate.gov' });
  });
});
