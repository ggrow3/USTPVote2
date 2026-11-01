import type { District } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { houseDistrictNumber, LocalContactSource, PublicContactSource } from './candidacies/contact-source.js';

const CA49: District = { kind: 'congressional', geoid: '0649', state: 'CA', name: 'Congressional District 49', point: { lat: 33.1, lng: -117.2 }, vintage: null };
const SD38: District = { kind: 'state_upper', geoid: '06038', state: 'CA', name: 'State Senate District 38', point: { lat: 33, lng: -117.1 }, vintage: null };
const AD76: District = { kind: 'state_lower', geoid: '06076', state: 'CA', name: 'Assembly District 76', point: { lat: 33, lng: -117.1 }, vintage: null };

type Seen = { url: string; headers: Record<string, string> };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The FEC, congress-legislators and Open States as they answer for San Diego; `down` lists hosts that fail. */
function fakeRecords(seen: Seen[], down: string[] = []): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const host = new URL(url).host;
    if (down.includes(host)) return json({ error: 'down' }, 503);
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
      const person = (id: string, name: string, org: string, title: string, classification = 'state') => ({
        id,
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
          person('s38', 'Catherine Blakespear', 'upper', 'Senator'),
          person('a76', 'Darshana Patel', 'lower', 'Assemblymember'),
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
    const source = new PublicContactSource({ fec: 'fec-key', openStates: 'os-key' }, fakeRecords(seen));
    const { contacts, feeds } = await source.forArea('CA', [CA49, SD38, AD76], 2026);
    expect(feeds).toEqual({ fec: 'ok', congress: 'ok', openstates: 'ok' });
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
    expect(contacts[4]).toMatchObject({ officeTitle: 'State Senator', email: 's38@legislature.example', website: null });
    expect(contacts[5]).toMatchObject({ officeTitle: 'Assemblymember' });
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
    await source.forArea('CA', [CA49, SD38, AD76], 2026);
    expect(seen).toHaveLength(asked);
  });

  it('asks for President in a presidential year, and leaves state legislators out without a key', async () => {
    const seen: Seen[] = [];
    const { contacts, feeds } = await new PublicContactSource({ fec: 'DEMO_KEY', openStates: null }, fakeRecords(seen)).forArea('CA', [SD38], 2028);
    expect(feeds.openstates).toBe('off');
    expect(contacts.filter((c) => c.office === 'us_president').map((c) => [c.name, c.district.geoid, c.party])).toEqual([['Jane Doe', 'US', null]]);
    expect(seen.some((r) => r.url.includes('openstates'))).toBe(false);
  });

  it('says which record did not answer, and keeps the others', async () => {
    const { contacts, feeds } = await new PublicContactSource({ fec: 'k', openStates: 'k' }, fakeRecords([], ['api.open.fec.gov'])).forArea('CA', [CA49], 2026);
    expect(feeds).toEqual({ fec: 'unavailable', congress: 'ok', openstates: 'ok' });
    expect(contacts.map((c) => c.source)).toEqual(['congress', 'congress']);
  });

  it('numbers House districts as Congress does', () => {
    expect(houseDistrictNumber('0649')).toBe(49);
    expect(houseDistrictNumber('0200')).toBe(0);
    expect(houseDistrictNumber('1198')).toBe(0);
  });

  it('the local stand-in: senators, a House race and legislators with email addresses', async () => {
    const { contacts } = await new LocalContactSource().forArea('CA', [CA49, SD38], 2026);
    expect(contacts.map((c) => `${c.role} ${c.office} ${c.name}`)).toEqual([
      'holder us_senate Sam Senator',
      'holder us_senate Sky Senator',
      'candidate us_senate Sid Hopeful',
      'holder us_house Hal House',
      'candidate us_house Hal House',
      'candidate us_house Cass Challenger',
      'holder state_upper Uma Upper',
    ]);
  });
});
