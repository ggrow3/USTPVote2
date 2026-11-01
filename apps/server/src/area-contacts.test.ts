import type { AreaContact, District } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { civicDistrict, houseDistrictNumber, LocalContactSource, PublicContactSource } from './candidacies/contact-source.js';
import { officialId, plainText, WikipediaProfileSource } from './candidacies/profile-source.js';

const CA49: District = { kind: 'congressional', geoid: '0649', state: 'CA', name: 'Congressional District 49', point: { lat: 33.1, lng: -117.2 }, vintage: null };
const SD38: District = { kind: 'state_upper', geoid: '06038', state: 'CA', name: 'State Senate District 38', point: { lat: 33, lng: -117.1 }, vintage: null };
const AD76: District = { kind: 'state_lower', geoid: '06076', state: 'CA', name: 'Assembly District 76', point: { lat: 33, lng: -117.1 }, vintage: null };
const COUNTY: District = { kind: 'county', geoid: '06073', state: 'CA', name: 'San Diego County', point: { lat: 33, lng: -116.7 }, vintage: null };
const CITY: District = { kind: 'place', geoid: '0666000', state: 'CA', name: 'San Diego city', point: { lat: 32.8, lng: -117.1 }, vintage: null };
const HOLDERS = { zip: null, holders: true } as const;

type Seen = { url: string; headers: Record<string, string> };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A race on California's list, published `when`. */
const caRace = (raceTitle: string, candidates: [name: string, party: string, incumbent?: boolean][], when = 'October 31, 2026, 1:12 p.m.') => ({
  raceTitle,
  Reporting: '0% (0 of 699) precincts reporting',
  ReportingTime: when,
  candidates: candidates.map(([Name, Party, incumbent = false]) => ({ Name, Party, Votes: '0', Percent: '0.0', incumbent })),
});

/**
 * The FEC, congress-legislators, Open States and California's list as they answer for San Diego; `down` lists hosts
 * that fail. California's list has `sos` by race, any other race answering 500 (not on the ballot); without `sos` it
 * still has the 2024 election.
 */
function fakeRecords(seen: Seen[], down: string[] = [], sos?: Record<string, unknown>): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const host = new URL(url).host;
    if (down.includes(host)) return json({ error: 'down' }, 503);
    if (host === 'api.sos.ca.gov') {
      const race = new URL(url).pathname.replace('/returns/', '');
      if (!sos) return json(caRace('Governor - Statewide Results', [['Old Name', 'Dem']], 'November 5, 2024, 8:00 p.m.'));
      return race in sos ? json(sos[race]) : new Response('', { status: 500 });
    }
    if (host === 'api.open.fec.gov') {
      const q = new URL(url).searchParams;
      if (q.get('office') === 'H') {
        return json({
          results: [
            { candidate_id: 'H8CA49058', name: 'LEVIN, MIKE', party_full: 'DEMOCRATIC PARTY', incumbent_challenge: 'I' },
            { candidate_id: 'H6CA49169', name: 'KURDIAN, ARMEN', party_full: 'REPUBLICAN PARTY', incumbent_challenge: 'C' },
          ],
        });
      }
      return json({ results: q.get('office') === 'S' ? [] : [{ candidate_id: 'P00000001', name: 'DOE, JANE', party_full: null }] });
    }
    if (host === 'unitedstates.github.io') {
      const term = (type: string, district: number | undefined, extra = {}) => [{ type, state: 'CA', district, party: 'Democrat', ...extra }];
      return json([
        { id: { bioguide: 'L000593' }, name: { first: 'Mike', last: 'Levin', official_full: 'Mike Levin' }, terms: term('rep', 49, { url: 'https://levin.house.gov' }) },
        { id: { bioguide: 'X000001' }, name: { first: 'Other', last: 'Rep' }, terms: term('rep', 50) },
        { id: { bioguide: 'P000145' }, name: { first: 'Alex', last: 'Padilla' }, terms: term('sen', undefined, { contact_form: 'https://www.padilla.senate.gov/contact/' }) },
        { id: { bioguide: 'T000001' }, name: { first: 'Tex', last: 'Senator' }, terms: [{ type: 'sen', state: 'TX', party: 'Republican' }] },
      ]);
    }
    if (host === 'v3.openstates.org') {
      const person = (id: string, name: string, org: string, title: string, classification = 'state', image?: string) => ({
        id,
        image,
        name,
        party: 'Democratic',
        email: `${id}@legislature.example`,
        openstates_url: `https://openstates.org/person/${id}/`,
        jurisdiction: { classification },
        current_role: { title, org_classification: org },
        links: [{ url: 'http://insecure.example' }],
      });
      return json({
        results: [
          person('s38', 'Catherine Blakespear', 'upper', 'Senator', 'state', 'https://senate.example/blakespear.jpg'),
          person('a76', 'Darshana Patel', 'lower', 'Assemblymember', 'state', 'http://assembly.example/patel.jpg'),
          person('us', 'Mike Levin', 'lower', 'Representative', 'country'),
        ],
      });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof globalThis.fetch;
}

describe('the public records for a member’s area', () => {
  it('lists the FEC’s candidates, the members of Congress and, with a key, the state legislators', async () => {
    const seen: Seen[] = [];
    const source = new PublicContactSource({ fec: 'fec-key', openStates: 'os-key', civic: null }, fakeRecords(seen));
    const { contacts, feeds } = await source.forArea('CA', [CA49, SD38, AD76], 2026, HOLDERS);
    expect(feeds).toEqual({ fec: 'ok', congress: 'ok', openstates: 'ok', civic: 'off', sos: 'off' });
    expect(contacts.map((c) => `${c.source} ${c.role} ${c.office}@${c.district.geoid} ${c.name}`)).toEqual([
      'fec candidate us_house@0649 Mike Levin',
      'fec candidate us_house@0649 Armen Kurdian',
      'congress holder us_senate@06 Alex Padilla',
      'congress holder us_house@0649 Mike Levin',
      'openstates holder state_upper@06038 Catherine Blakespear',
      'openstates holder state_lower@06076 Darshana Patel',
    ]);
    expect(contacts[0]).toMatchObject({ party: 'Democratic Party', incumbent: true, election: '2026', sourceUrl: 'https://www.fec.gov/data/candidate/H8CA49058/' });
    expect(contacts[2]).toMatchObject({ officeTitle: 'U.S. Senator', contactUrl: 'https://www.padilla.senate.gov/contact/', email: null });
    expect(contacts[3]).toMatchObject({ officeTitle: 'U.S. Representative', website: 'https://levin.house.gov', contactUrl: null });
    expect(contacts[4]).toMatchObject({
      officeTitle: 'State Senator',
      email: 's38@legislature.example',
      website: null,
      photo: { url: 'https://senate.example/blakespear.jpg', credit: 'Official portrait, from Open States', creditUrl: 'https://openstates.org/person/s38/' },
    });
    // Only https photos are passed on.
    expect(contacts[5]).toMatchObject({ officeTitle: 'Assemblymember', photo: null });
    // No presidential race in 2026; the House race by its two-digit district; Open States by the district's point, key in a header.
    const fec = seen.filter((r) => r.url.startsWith('https://api.open.fec.gov')).map((r) => new URL(r.url).searchParams);
    expect(fec.map((q) => q.get('office'))).toEqual(['S', 'H']);
    expect(fec[1]!.get('district')).toBe('49');
    expect([fec[1]!.get('api_key'), fec[1]!.get('election_year'), fec[1]!.get('has_raised_funds')]).toEqual(['fec-key', '2026', 'true']);
    const os = seen.filter((r) => r.url.startsWith('https://v3.openstates.org'));
    expect(os).toHaveLength(2);
    expect(os[0]!.url).toContain('lat=33&lng=-117.1');
    expect(os[0]!.url).not.toContain('os-key');
    expect(os[0]!.headers['X-API-KEY']).toBe('os-key');
    // Kept a day: asking again sends nothing.
    const asked = seen.length;
    await source.forArea('CA', [CA49, SD38, AD76], 2026, HOLDERS);
    expect(seen).toHaveLength(asked);
  });

  it('asks for President in a presidential year, and leaves state legislators out without a key', async () => {
    const seen: Seen[] = [];
    const { contacts, feeds } = await new PublicContactSource({ fec: 'DEMO_KEY', openStates: null, civic: null }, fakeRecords(seen)).forArea('CA', [SD38], 2028, HOLDERS);
    expect(feeds.openstates).toBe('off');
    expect(contacts.filter((c) => c.office === 'us_president').map((c) => [c.name, c.district.geoid, c.party])).toEqual([['Jane Doe', 'US', null]]);
    expect(seen.some((r) => r.url.includes('openstates'))).toBe(false);
  });

  it('says which record did not answer, and keeps the others', async () => {
    const { contacts, feeds } = await new PublicContactSource({ fec: 'k', openStates: 'k', civic: null }, fakeRecords([], ['api.open.fec.gov'])).forArea('CA', [CA49], 2026, HOLDERS);
    expect(feeds).toEqual({ fec: 'unavailable', congress: 'ok', openstates: 'ok', civic: 'off', sos: 'off' });
    expect(contacts.map((c) => c.source)).toEqual(['congress', 'congress']);
  });

  it('numbers House districts as Congress does', () => {
    expect(houseDistrictNumber('0649')).toBe(49);
    expect(houseDistrictNumber('0200')).toBe(0);
    expect(houseDistrictNumber('1198')).toBe(0);
  });

  it('the local stand-in: senators, a House race and legislators with email addresses', async () => {
    const { contacts } = await new LocalContactSource().forArea('CA', [CA49, SD38], 2026, HOLDERS);
    expect(contacts.map((c) => `${c.role} ${c.office} ${c.name}`)).toEqual([
      'holder us_senate Sam Senator',
      'holder us_senate Sky Senator',
      'candidate us_senate Sid Hopeful',
      'holder us_house Hal House',
      'candidate us_house Hal House',
      'candidate us_house Cass Challenger',
      'holder state_upper Uma Upper',
      'candidate statewide Gil Governor',
      'candidate statewide Rita Rival',
    ]);
  });
});

/** The Civic Information API's answer for ZIP code 92130, the way it shapes contests. */
const VOTER_INFO = {
  election: { id: '9100', name: 'General Election', electionDay: '2026-11-03' },
  contests: [
    {
      type: 'General',
      office: 'U.S. Representative',
      level: ['country'],
      roles: ['legislatorLowerBody'],
      district: { name: "California's 49th congressional district", scope: 'congressional', id: 'ocd-division/country:us/state:ca/cd:49' },
      candidates: [
        { name: 'Mike Levin', party: 'Democratic Party', candidateUrl: 'https://mikelevin.example', email: 'team@mikelevin.example', photoUrl: 'https://mikelevin.example/me.jpg' },
        { name: 'Armen A. Kurdian', party: 'Republican Party', candidateUrl: 'http://kurdian.example' },
      ],
    },
    {
      office: 'Governor',
      level: ['administrativeArea1'],
      roles: ['headOfGovernment'],
      district: { name: 'California', scope: 'statewide', id: 'ocd-division/country:us/state:ca' },
      candidates: [{ name: 'Gail Governor', party: 'Democratic Party' }],
    },
    {
      office: 'State Senator',
      level: ['administrativeArea1'],
      district: { name: 'State Senate District 38', scope: 'stateUpper', id: 'ocd-division/country:us/state:ca/sldu:38' },
      candidates: [{ name: 'Catherine Blakespear', party: 'Democratic Party', email: 'not an address' }],
    },
    {
      office: 'Board of Supervisors',
      level: ['administrativeArea2'],
      district: { name: 'Supervisorial District 3', scope: 'countyCouncil', id: 'ocd-division/country:us/state:ca/county:san_diego/council_district:3' },
      candidates: [{ name: 'Terra Lawson-Remer', party: 'Nonpartisan' }],
    },
    {
      office: 'Governing Board Member',
      district: { name: 'San Dieguito Union High School District, Trustee Area 5', scope: 'schoolBoard' },
      candidates: [{ name: 'Sam Schools' }, { name: ' ' }],
    },
    { type: 'Referendum', referendumTitle: 'Proposition 1', district: { scope: 'statewide' } },
  ],
};

/** Google as it answers voterinfo: each call takes the next of `answers` (status, body, cache header); the rest as `fakeRecords`. */
function fakeCivic(seen: Seen[], answers: { status?: number; body?: unknown; cache?: string }[]): typeof globalThis.fetch {
  const others = fakeRecords([]);
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    if (new URL(url).host !== 'www.googleapis.com') return others(input, init);
    const a = answers.shift() ?? {};
    return new Response(JSON.stringify(a.body ?? VOTER_INFO), {
      status: a.status ?? 200,
      headers: { 'content-type': 'application/json', ...(a.cache ? { 'cache-control': a.cache } : {}) },
    });
  }) as typeof globalThis.fetch;
}

const line = (c: AreaContact) => `${c.source} ${c.office}@${c.district.geoid} ${c.officeTitle}: ${c.name}`;
const civicCalls = (seen: Seen[]) => seen.filter((r) => r.url.startsWith('https://www.googleapis.com'));

describe('the ballot, from the Civic Information API', () => {
  it('places each contest in the area’s Census district, merges Congress with the FEC, and lists the rest apart', async () => {
    const seen: Seen[] = [];
    const source = new PublicContactSource({ fec: 'k', openStates: null, civic: 'civic-key' }, fakeCivic(seen, [{ cache: 'public, max-age=600' }]));
    const { contacts, ballot, feeds } = await source.forArea('CA', [CA49, SD38, COUNTY, CITY], 2026, { zip: '92130', holders: false });
    expect(feeds).toEqual({ fec: 'ok', congress: 'off', openstates: 'off', civic: 'ok', sos: 'off' });
    expect(contacts.map(line)).toEqual([
      'fec us_house@0649 U.S. Representative: Mike Levin',
      'fec us_house@0649 U.S. Representative: Armen Kurdian',
      'civic statewide@06 Governor: Gail Governor',
      'civic state_upper@06038 State Senator: Catherine Blakespear',
      'civic county@06073 Board of Supervisors, Supervisorial District 3: Terra Lawson-Remer',
    ]);
    // Levin keeps the FEC's record and gains the ballot's website, email and photo; an http:// site is dropped.
    expect(contacts[0]).toMatchObject({
      sourceUrl: 'https://www.fec.gov/data/candidate/H8CA49058/',
      website: 'https://mikelevin.example',
      email: 'team@mikelevin.example',
      election: '2026-11-03',
      photo: { url: 'https://mikelevin.example/me.jpg', creditUrl: null },
    });
    expect(contacts[1]).toMatchObject({ website: null, photo: null });
    expect(contacts[3]).toMatchObject({ email: null, election: '2026-11-03', contactId: 'civic:9100:state_upper:06038:state-senator:catherine-blakespear' });
    expect(ballot).toEqual([
      {
        office: 'Governing Board Member',
        district: 'San Dieguito Union High School District, Trustee Area 5',
        election: '2026-11-03',
        candidates: [{ name: 'Sam Schools', party: null, website: null, email: null, photo: null }],
      },
    ]);
    // By the ZIP code alone, with the key in a header; kept as long as Google says.
    expect(civicCalls(seen)).toHaveLength(1);
    expect(new URL(civicCalls(seen)[0]!.url).searchParams.get('address')).toBe('92130');
    expect(civicCalls(seen)[0]!.url).not.toContain('civic-key');
    expect(civicCalls(seen)[0]!.headers['x-goog-api-key']).toBe('civic-key');
    await source.forArea('CA', [CA49], 2026, { zip: '92130', holders: false });
    expect(civicCalls(seen)).toHaveLength(1);
  });

  it('is no ballot where Google has no election, missing when it refuses the key, and off without a key or ZIP code', async () => {
    const seen: Seen[] = [];
    const none = { status: 400, body: { error: { code: 400, message: 'Election unknown' } }, cache: 'no-cache' };
    const source = new PublicContactSource({ fec: 'k', openStates: null, civic: 'civic-key' }, fakeCivic(seen, [none, none]));
    const first = await source.forArea('CA', [CA49], 2026, { zip: '92130', holders: false });
    expect([first.feeds.civic, first.ballot, first.contacts.map((c) => c.source)]).toEqual(['ok', [], ['fec', 'fec']]);
    // "no-cache": asked again next time.
    await source.forArea('CA', [CA49], 2026, { zip: '92130', holders: false });
    expect(civicCalls(seen)).toHaveLength(2);

    const refused = new PublicContactSource(
      { fec: 'k', openStates: null, civic: 'bad' },
      fakeCivic([], [{ status: 400, body: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } } }]),
    );
    expect((await refused.forArea('CA', [CA49], 2026, { zip: '92130', holders: false })).feeds.civic).toBe('unavailable');

    const asked: Seen[] = [];
    const noKey = await new PublicContactSource({ fec: 'k', openStates: null, civic: null }, fakeCivic(asked, [])).forArea('CA', [CA49], 2026, { zip: '92130', holders: false });
    const noZip = await new PublicContactSource({ fec: 'k', openStates: null, civic: 'k' }, fakeCivic(asked, [])).forArea('CA', [CA49], 2026, HOLDERS);
    expect([noKey.feeds.civic, noZip.feeds.civic]).toEqual(['off', 'off']);
    expect(civicCalls(asked)).toHaveLength(0);
  });

  it('finds a contest’s district by its OCD division ID, else the area’s only one of that kind', () => {
    const area = [CA49, SD38, AD76, COUNTY, CITY];
    expect(civicDistrict('congressional', 'ocd-division/country:us/state:ca/cd:49', 'CA', area)?.geoid).toBe('0649');
    expect(civicDistrict('congressional', 'ocd-division/country:us/state:ca/cd:50', 'CA', area)).toBeNull();
    expect(civicDistrict('state_lower', 'ocd-division/country:us/state:ca/sldl:76', 'CA', area)?.geoid).toBe('06076');
    expect(civicDistrict('place', 'ocd-division/country:us/state:ca/place:san_diego', 'CA', area)?.geoid).toBe('0666000');
    expect(civicDistrict('county', 'ocd-division/country:us/state:ca/county:orange', 'CA', area)).toBeNull();
    expect(civicDistrict('state_upper', '', 'CA', area)?.geoid).toBe('06038');
    expect(civicDistrict('congressional', '', 'CA', [CA49, { ...CA49, geoid: '0650' }])).toBeNull();
    expect(civicDistrict('state', '', 'CA', [])).toMatchObject({ kind: 'state', geoid: '06' });
  });

  it('the local stand-in: the challenger’s website, a State Senate race, and a school board contest apart', async () => {
    const { contacts, ballot, feeds } = await new LocalContactSource().forArea('CA', [CA49, { ...SD38, geoid: '06001' }], 2026, { zip: '94615', holders: false });
    expect(feeds).toEqual({ fec: 'ok', congress: 'off', openstates: 'off', civic: 'ok', sos: 'ok' });
    expect(contacts.map((c) => `${c.source} ${c.office} ${c.name} ${c.website ?? '-'}`)).toEqual([
      'fec us_senate Sid Hopeful -',
      'fec us_house Hal House -',
      'fec us_house Cass Challenger https://cass.example',
      'civic state_upper Uma Upper -',
      'civic state_upper Bea Ballot https://bea.example',
      'sos statewide Gil Governor -',
      'sos statewide Rita Rival -',
    ]);
    expect(ballot.map((b) => [b.office, b.candidates.map((c) => c.name)])).toEqual([['Governing Board Member', ['Sal School']]]);
  });
});

describe('California’s own list of who is on the ballot', () => {
  const ON_THE_BALLOT = {
    governor: caRace('Governor - Statewide Results', [
      ['Xavier Becerra', 'Dem'],
      ['Steve Hilton', 'Rep'],
    ]),
    'superintendent-of-public-instruction': caRace('Superintendent of Public Instruction - Statewide Results', [
      ['Richard Barrera', 'Non'],
      ['Sonja Shaw', 'Non'],
    ]),
    // The FEC lists Kurdian too, who is not on this ballot.
    'us-rep/district/49': caRace('U.S. House of Representatives District 49 - Districtwide Results', [
      ['Mike Levin', 'Dem'],
      ['Pat Newcomer', 'PF'],
    ]),
    'state-senate/district/38': caRace('State Senate District 38 - Districtwide Results', [
      ['Catherine S. Blakespear', 'Dem', true],
      ['Laura Bassett', 'Rep'],
    ]),
  };

  it('lists the state’s candidates for the area’s races, over the FEC’s, and the seats not on the ballot', async () => {
    const seen: Seen[] = [];
    const source = new PublicContactSource({ fec: 'k', openStates: null, civic: null }, fakeRecords(seen, [], ON_THE_BALLOT));
    const { contacts, notUp, feeds } = await source.forArea('CA', [CA49, SD38, AD76, COUNTY], 2026, { zip: '92130', holders: false });
    expect(feeds.sos).toBe('ok');
    expect(contacts.map(line)).toEqual([
      'sos statewide@06 Governor: Xavier Becerra',
      'sos statewide@06 Governor: Steve Hilton',
      'sos statewide@06 Superintendent of Public Instruction: Richard Barrera',
      'sos statewide@06 Superintendent of Public Instruction: Sonja Shaw',
      'fec us_house@0649 U.S. Representative: Mike Levin',
      'sos us_house@0649 U.S. Representative: Pat Newcomer',
      'sos state_upper@06038 State Senator: Catherine S. Blakespear',
      'sos state_upper@06038 State Senator: Laura Bassett',
    ]);
    // The FEC's record is kept for the one it also lists; parties as people say them; the incumbent marked.
    expect(contacts[4]).toMatchObject({ contactId: 'fec:H8CA49058', incumbent: true, election: '2026' });
    expect(contacts.map((c) => c.party)).toEqual(['Democratic', 'Republican', null, null, 'Democratic', 'Peace and Freedom', 'Democratic', 'Republican']);
    expect(contacts[6]).toMatchObject({ incumbent: true, election: '2026', sourceUrl: 'https://www.sos.ca.gov/elections/upcoming-elections', photo: null });
    // No U.S. Senate race in California this year, and none for this Assembly seat; nothing asked for the county.
    expect(notUp).toEqual([
      { office: 'us_senate', kind: 'state', geoid: '06' },
      { office: 'state_lower', kind: 'state_lower', geoid: '06076' },
    ]);
    const races = seen.filter((r) => r.url.startsWith('https://api.sos.ca.gov')).map((r) => r.url.replace('https://api.sos.ca.gov/returns/', ''));
    expect(races).toEqual([
      'governor',
      'lieutenant-governor',
      'secretary-of-state',
      'controller',
      'treasurer',
      'attorney-general',
      'insurance-commissioner',
      'superintendent-of-public-instruction',
      'us-senate',
      'us-rep/district/49',
      'state-senate/district/38',
      'state-assembly/district/76',
    ]);
    // Kept: asking again sends nothing.
    const asked = seen.length;
    await source.forArea('CA', [CA49, SD38, AD76, COUNTY], 2026, { zip: '92130', holders: false });
    expect(seen).toHaveLength(asked);
  });

  it('leaves out the FEC’s filers for a seat that is not up, and asks only for California', async () => {
    const seen: Seen[] = [];
    const source = new PublicContactSource({ fec: 'k', openStates: null, civic: null }, fakeRecords(seen, [], { governor: ON_THE_BALLOT.governor }));
    const { contacts, notUp } = await source.forArea('CA', [CA49], 2026, { zip: null, holders: false });
    expect(notUp).toContainEqual({ office: 'us_house', kind: 'congressional', geoid: '0649' });
    expect(contacts.filter((c) => c.office === 'us_house')).toEqual([]);
    const asked = seen.filter((r) => r.url.startsWith('https://api.sos.ca.gov')).length;
    const texas = await new PublicContactSource({ fec: 'k', openStates: null, civic: null }, fakeRecords(seen, [], ON_THE_BALLOT)).forArea('TX', [], 2026, HOLDERS);
    expect([texas.feeds.sos, texas.notUp]).toEqual(['off', []]);
    expect(seen.filter((r) => r.url.startsWith('https://api.sos.ca.gov'))).toHaveLength(asked);
  });

  it('uses no list from another election, and says when the list does not answer', async () => {
    const stale = await new PublicContactSource({ fec: 'k', openStates: null, civic: null }, fakeRecords([])).forArea('CA', [CA49], 2026, HOLDERS);
    expect([stale.feeds.sos, stale.notUp, stale.contacts.some((c) => c.source === 'sos')]).toEqual(['off', [], false]);
    const down = await new PublicContactSource({ fec: 'k', openStates: null, civic: null }, fakeRecords([], ['api.sos.ca.gov'])).forArea('CA', [CA49], 2026, HOLDERS);
    expect([down.feeds.sos, down.notUp]).toEqual(['unavailable', []]);
    // Every race answering 500 is the service failing, not an empty ballot.
    const empty = await new PublicContactSource({ fec: 'k', openStates: null, civic: null }, fakeRecords([], [], {})).forArea('CA', [CA49], 2026, HOLDERS);
    expect([empty.feeds.sos, empty.notUp]).toEqual(['unavailable', []]);
    expect(empty.contacts.filter((c) => c.office === 'us_house' && c.role === 'candidate')).toHaveLength(2);
  });
});

const fecPerson = (id: string, name: string): AreaContact => ({
  contactId: `fec:${id}`,
  source: 'fec',
  role: 'candidate',
  office: 'us_house',
  officeTitle: 'U.S. Representative',
  district: { kind: 'congressional', geoid: '0649', state: 'CA', name: 'Congressional District 49' },
  name,
  party: null,
  email: null,
  contactUrl: null,
  website: null,
  sourceUrl: null,
  election: '2026',
  incumbent: false,
  photo: null,
  profile: null,
});

const uri = (v: string) => ({ type: 'uri', value: v });
const lit = (v: string) => ({ type: 'literal', value: v });
const LEVIN = 'http://www.wikidata.org/entity/Q55424854';

/** Wikidata, Wikipedia and Commons as they answer for Mike Levin; Kurdian has no Wikidata item. `down` lists hosts that fail. */
function fakeWiki(seen: Seen[], down: string[] = []): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ url: url.toString(), headers: (init?.headers ?? {}) as Record<string, string> });
    if (down.includes(url.host)) return json({}, 503);
    if (url.host === 'query.wikidata.org') {
      const query = url.searchParams.get('query') ?? '';
      expect(query).toContain('"H8CA49058"');
      // Levin is found by his FEC ID, each fact a row; the label service gives the bare ID where it has no English label.
      const levin = { property: lit('P1839'), id: lit('H8CA49058'), item: uri(LEVIN) };
      const position = (title: string, start: string, end?: string) => ({
        ...levin,
        kind: lit('position'),
        value: uri('http://www.wikidata.org/entity/Q13218630'),
        valueLabel: lit(title),
        start: lit(`${start}-01-03T00:00:00Z`),
        ...(end ? { end: lit(`${end}-01-03T00:00:00Z`) } : {}),
        placeLabel: lit("California's 49th congressional district"),
      });
      const fact = (kind: string, value: string) => ({ ...levin, kind: lit(kind), value: uri(`http://www.wikidata.org/entity/${value}`), valueLabel: lit(value) });
      return json({
        results: {
          bindings: [
            { ...levin, kind: lit('article'), value: uri('https://en.wikipedia.org/wiki/Mike_Levin') },
            { ...levin, kind: lit('image'), value: uri('http://commons.wikimedia.org/wiki/Special:FilePath/Mike%20Levin%20official%20photo.jpg') },
            position('member of the United States House of Representatives', '2019', '2021'),
            position('member of the United States House of Representatives', '2021'),
            position('member of the United States House of Representatives', '2021'),
            { ...position('House of Representatives', '2019'), start: undefined },
            fact('education', 'Stanford University'),
            fact('education', 'Duke University School of Law'),
            fact('occupation', 'lawyer'),
            fact('occupation', 'Q999999'),
          ],
        },
      });
    }
    if (url.host === 'en.wikipedia.org') {
      expect(url.pathname).toBe('/api/rest_v1/page/summary/Mike_Levin');
      return json({
        type: 'standard',
        extract: 'Michael Ted Levin is an American lawyer and politician.  He has served since 2019.',
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Mike_Levin' } },
      });
    }
    if (url.host === 'commons.wikimedia.org') {
      expect(url.searchParams.get('titles')).toBe('File:Mike Levin official photo.jpg');
      return json({
        query: {
          pages: [
            {
              title: 'File:Mike Levin official photo.jpg',
              imageinfo: [
                {
                  thumburl: 'https://upload.wikimedia.org/thumb/levin.jpg',
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Mike_Levin_official_photo.jpg',
                  extmetadata: { Artist: { value: '<a href="//x">U.S. House Office of Photography</a>' }, LicenseShortName: { value: 'Public domain' } },
                },
              ],
            },
          ],
        },
      });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof globalThis.fetch;
}

describe('biographies and experience, from Wikidata and Wikipedia', () => {
  const people = [fecPerson('H8CA49058', 'Mike Levin'), fecPerson('H6CA49169', 'Armen Kurdian'), { ...fecPerson('X', 'Nobody'), contactId: 'civic:1:x' }];

  it('matches people by their FEC ID only, and gives each the start of their article, offices held, study, work and photo', async () => {
    const seen: Seen[] = [];
    const source = new WikipediaProfileSource(fakeWiki(seen));
    const { people: out, state } = await source.withProfiles(people);
    expect(state).toBe('ok');
    expect(out[0]!.profile).toEqual({
      summary: 'Michael Ted Levin is an American lawyer and politician. He has served since 2019.',
      articleUrl: 'https://en.wikipedia.org/wiki/Mike_Levin',
      wikidataUrl: 'https://www.wikidata.org/wiki/Q55424854',
      positions: [{ title: 'member of the United States House of Representatives', place: "California's 49th congressional district", start: '2019', end: null }],
      education: ['Stanford University', 'Duke University School of Law'],
      occupations: ['lawyer'],
    });
    expect(out[0]!.photo).toEqual({
      url: 'https://upload.wikimedia.org/thumb/levin.jpg',
      credit: 'Photo: U.S. House Office of Photography, Public domain',
      creditUrl: 'https://commons.wikimedia.org/wiki/File:Mike_Levin_official_photo.jpg',
    });
    expect([out[1]!.profile, out[1]!.photo, out[2]]).toEqual([null, null, people[2]]);
    expect(seen.every((r) => r.headers['user-agent']?.startsWith('USTPVote2/'))).toBe(true);
    expect(new URL(seen[0]!.url).searchParams.get('query')).toContain('VALUES ?id { "H8CA49058" "H6CA49169" }');
    expect(seen.filter((r) => r.url.startsWith('https://query.wikidata.org'))).toHaveLength(1);
    // Each answer, and that there is none, is kept a day.
    const asked = seen.length;
    await source.withProfiles(people);
    expect(seen).toHaveLength(asked);
  });

  it('says Wikidata did not answer, leaves the people as they were, and asks again next time', async () => {
    const seen: Seen[] = [];
    const source = new WikipediaProfileSource(fakeWiki(seen, ['query.wikidata.org']));
    const { people: out, state } = await source.withProfiles(people);
    expect(state).toBe('unavailable');
    expect(out).toEqual(people);
    await source.withProfiles(people);
    expect(seen).toHaveLength(2);
  });

  it('keeps a profile without its article when Wikipedia fails, and asks for it again', async () => {
    const seen: Seen[] = [];
    const source = new WikipediaProfileSource(fakeWiki(seen, ['en.wikipedia.org']));
    const first = await source.withProfiles(people.slice(0, 1));
    expect([first.state, first.people[0]!.profile?.summary, first.people[0]!.profile?.positions.length]).toEqual(['unavailable', null, 1]);
    const asked = seen.length;
    await source.withProfiles(people.slice(0, 1));
    expect(seen.length).toBeGreaterThan(asked);
  });

  it('knows FEC and Bioguide IDs, and reads Commons’ credits as text', () => {
    expect(officialId('fec:H8CA49058')).toEqual({ property: 'P1839', id: 'H8CA49058' });
    expect(officialId('congress:L000593')).toEqual({ property: 'P1157', id: 'L000593' });
    expect([officialId('fec:H0601'), officialId('fec:"} ?x'), officialId('openstates:ocd-person/1'), officialId('admin:1')]).toEqual([null, null, null, null]);
    expect(plainText('<span>Jane &amp; <b>John</b>&nbsp;Doe</span>')).toBe('Jane & John Doe');
  });
});
