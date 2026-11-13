import { describe, expect, it } from 'vitest';
import { ordinal } from '../bills/bills.js';
import type { AreaContact } from './contacts.js';
import { STATE_FIPS } from './districts.js';
import {
  HOUSE_SEATS,
  houseSeats,
  peopleWithPages,
  personContactId,
  personPath,
  personRecordsKey,
  personView,
  raceCode,
  raceGroups,
  raceNotUp,
  raceOf,
  racePartyCandidates,
  racePath,
  racePlace,
  racePlaces,
  raceSeats,
  raceSitemapPaths,
  raceTitle,
  seatGeoid,
  seatName,
  seatOfGeoid,
  senateUp,
} from './races.js';
import type { PublicCandidacy } from './views.js';

const person = (over: Partial<AreaContact> & Pick<AreaContact, 'contactId' | 'name'>): AreaContact => ({
  source: 'fec',
  role: 'candidate',
  office: 'us_house',
  officeTitle: 'U.S. Representative',
  district: { kind: 'congressional', geoid: '0612', state: 'CA', name: 'Congressional District 12' },
  party: null,
  email: null,
  contactUrl: null,
  website: null,
  sourceUrl: null,
  election: '2028',
  incumbent: false,
  photo: null,
  profile: null,
  ...over,
});

const SENATE = { kind: 'state', geoid: '06', state: 'CA', name: 'CA' } as const;
const NATION = { kind: 'nation', geoid: 'US', state: null, name: 'United States' } as const;

describe('the House seats', () => {
  it('are the 2020 apportionment’s 435, with DC and five territories electing one each', () => {
    const states = Object.entries(HOUSE_SEATS).filter(([s]) => !['DC', 'AS', 'GU', 'MP', 'PR', 'VI'].includes(s));
    expect(states).toHaveLength(50);
    expect(states.reduce((sum, [, n]) => sum + n, 0)).toBe(435);
    expect(Object.keys(HOUSE_SEATS).sort()).toEqual(Object.keys(STATE_FIPS).sort());
    expect(houseSeats('CA')).toHaveLength(52);
    expect(houseSeats('WY')).toEqual(['at-large']);
    expect(racePlaces()).toHaveLength(56 + 435 + 6);
  });

  it('have their Census GEOIDs: an at-large seat 00, DC’s and the territories’ 98', () => {
    expect(seatGeoid('CA', 12)).toBe('0612');
    expect(seatGeoid('WY', 'at-large')).toBe('5600');
    expect(seatGeoid('DC', 'at-large')).toBe('1198');
    expect(seatOfGeoid('0612')).toEqual({ state: 'CA', seat: 12 });
    expect(seatOfGeoid('5600')).toEqual({ state: 'WY', seat: 'at-large' });
    expect(seatOfGeoid('7298')).toEqual({ state: 'PR', seat: 'at-large' });
    expect([seatOfGeoid('0653'), seatOfGeoid('0600'), seatOfGeoid('5601'), seatOfGeoid('9912'), seatOfGeoid('06001')]).toEqual([null, null, null, null, null]);
  });
});

describe('a race page’s address', () => {
  it('is a lower-case state, then a district with no leading zero or at-large', () => {
    expect(racePlace('ca')).toEqual({ state: 'CA', seat: null });
    expect(racePlace('ca', '12')).toEqual({ state: 'CA', seat: 12 });
    expect(racePlace('ca', '52')).toEqual({ state: 'CA', seat: 52 });
    expect(racePlace('wy', 'at-large')).toEqual({ state: 'WY', seat: 'at-large' });
    expect(racePlace('dc', 'at-large')).toEqual({ state: 'DC', seat: 'at-large' });
    for (const [state, district] of [['CA', undefined], ['ca', '012'], ['ca', '0'], ['ca', '53'], ['ca', 'at-large'], ['wy', '1'], ['zz', undefined], ['c', undefined], ['ca', '1e1']] as const) {
      expect(racePlace(state, district), `${state}/${district}`).toBeNull();
    }
  });

  it('comes back from a place, and names it', () => {
    for (const place of racePlaces()) {
      const [state, district] = racePath(place).split('/').slice(2);
      expect(racePlace(state!, district)).toEqual(place);
    }
    expect(racePath({ state: 'WY', seat: 'at-large' })).toBe('/races/wy/at-large');
    expect([raceCode({ state: 'CA', seat: 12 }), raceCode({ state: 'WY', seat: 'at-large' }), raceCode({ state: 'CA', seat: null })]).toEqual(['CA-12', 'WY-AL', 'CA']);
    expect(raceTitle({ state: 'CA', seat: 12 }, 2028)).toBe('2028 candidates in CA-12');
    expect(raceTitle({ state: 'CA', seat: null }, 2028)).toBe('2028 candidates in California');
    expect(raceTitle({ state: 'DC', seat: null }, 2028)).toBe('2028 candidates in the District of Columbia');
    expect(raceTitle({ state: 'WY', seat: 'at-large' }, 2028)).toBe('2028 candidates for Wyoming’s at-large congressional district');
    expect(seatName({ state: 'TX', seat: 21 })).toBe('Texas’s 21st congressional district');
    expect(seatName({ state: 'VI', seat: 'at-large' })).toBe('the U.S. Virgin Islands’ seat in the U.S. House');
    expect(seatName({ state: 'DC', seat: 'at-large' })).toBe('the District of Columbia’s seat in the U.S. House');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 52].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '52nd']);
  });

  it('is where a person belongs: their House seat, or their state for the Senate and statewide offices', () => {
    expect(raceOf(person({ contactId: 'fec:H8CA12001', name: 'A' }))).toEqual({ state: 'CA', seat: 12 });
    expect(raceOf(person({ contactId: 'fec:S8CA00001', name: 'A', office: 'us_senate', district: SENATE }))).toEqual({ state: 'CA', seat: null });
    expect(raceOf(person({ contactId: 'sos:gov', name: 'A', office: 'statewide', district: SENATE }))).toEqual({ state: 'CA', seat: null });
    expect(raceOf(person({ contactId: 'fec:P80000001', name: 'A', office: 'us_president', district: NATION }))).toBeNull();
    expect(raceOf(person({ contactId: 'openstates:x', name: 'A', office: 'state_upper', district: { kind: 'state_upper', geoid: '06038', state: 'CA', name: 'SD 38' } }))).toBeNull();
  });
});

describe('the Senate classes', () => {
  it('elect each state’s seats two years in three, each class every six years', () => {
    expect([senateUp('CA', 2024), senateUp('CA', 2026), senateUp('CA', 2028), senateUp('CA', 2030)]).toEqual([true, false, true, true]);
    expect([senateUp('DE', 2026), senateUp('DE', 2028)]).toEqual([true, false]);
    expect(senateUp('DC', 2028)).toBe(false);
    for (const state of Object.keys(HOUSE_SEATS).filter((s) => !['DC', 'AS', 'GU', 'MP', 'PR', 'VI'].includes(s))) {
      expect([2024, 2026, 2028].filter((y) => senateUp(state, y)), state).toHaveLength(2);
    }
  });

  it('say a state’s Senate seats are not up, unless someone runs in a special election', () => {
    const de = { state: 'DE', seat: null } as const;
    const deSenate = { office: 'us_senate', kind: 'state', geoid: '10' } as const;
    expect(raceNotUp(de, [], [], 2028)).toEqual([deSenate]);
    expect(raceNotUp(de, [], [person({ contactId: 'fec:S8DE00001', name: 'Special', office: 'us_senate', district: { ...SENATE, geoid: '10', state: 'DE' } })], 2028)).toEqual([]);
    expect(raceNotUp({ state: 'CA', seat: null }, [], [], 2028)).toEqual([]);
    expect(raceNotUp({ state: 'DC', seat: null }, [], [], 2028)).toEqual([]);
    // The state's own list's seats, each on its own page.
    const listed = [{ office: 'us_house', kind: 'congressional', geoid: '0612' }, { office: 'us_senate', kind: 'state', geoid: '06' }] as const;
    expect(raceNotUp({ state: 'CA', seat: 12 }, listed, [], 2026)).toEqual([listed[0]]);
    expect(raceNotUp({ state: 'CA', seat: null }, listed, [], 2026)).toEqual([listed[1]]);
  });
});

describe('a person’s page', () => {
  it('is found by their FEC candidate or Bioguide ID, and only those', () => {
    expect(personContactId('H8CA49058')).toBe('fec:H8CA49058');
    expect(personContactId('L000593')).toBe('congress:L000593');
    expect([personContactId('h8ca49058'), personContactId('L00059'), personContactId('X'), personContactId('H8CA4905/')]).toEqual([null, null, null, null]);
    expect(personPath('fec:H8CA49058')).toBe('/people/H8CA49058');
    expect(personPath('congress:L000593')).toBe('/people/L000593');
    expect([personPath('fec:L000593'), personPath('congress:H8CA49058'), personPath('sos:CA:governor:x'), personPath('civic:1'), personPath('admin:1')]).toEqual([null, null, null, null, null]);
    expect([personRecordsKey('H8CA49058'), personRecordsKey('S4TX00001'), personRecordsKey('P80001571'), personRecordsKey('L000593'), personRecordsKey('H8ZZ49058')]).toEqual(['CA', 'TX', 'US', null, null]);
    expect(peopleWithPages([person({ contactId: 'fec:H8CA49058', name: 'A' }), person({ contactId: 'sos:x', name: 'B' }), person({ contactId: 'fec:H8CA49058', name: 'A' })])).toEqual(['fec:H8CA49058']);
  });

  it('has their seat, who else is listed for it, and their other part', () => {
    const levin = person({ contactId: 'congress:L000593', name: 'Mike Levin', role: 'holder', source: 'congress', election: null });
    const running = person({ contactId: 'fec:H8CA49058', name: 'Michael T. Levin', incumbent: true });
    const rival = person({ contactId: 'fec:H6CA12169', name: 'Armen Kurdian' });
    const elsewhere = person({ contactId: 'fec:H6CA13001', name: 'Mike Levin', district: { kind: 'congressional', geoid: '0613', state: 'CA', name: 'CD 13' } });
    const record = { contacts: [levin, running, rival, elsewhere], electionYear: 2028, checkedAt: '2026-11-12T00:00:00.000Z' };
    const view = personView('congress:L000593', record)!;
    expect(view.race).toEqual({ path: '/races/ca/12', code: 'CA-12', title: '2028 candidates in CA-12', seat: 'California’s 12th congressional district' });
    expect(view.also?.contactId).toBe('fec:H8CA49058');
    expect(view.others.map((c) => c.contactId)).toEqual(['fec:H6CA12169']);
    expect(personView('fec:H8CA49058', record)!.also?.contactId).toBe('congress:L000593');
    expect(personView('fec:H6CA12169', record)!.also).toBeNull();
    expect(personView('fec:nobody', record)).toBeNull();
  });
});

describe('a race page’s people', () => {
  const holder = person({ contactId: 'congress:P000197', name: 'Nancy Pelosi', role: 'holder', source: 'congress', election: null, party: 'Democrat' });
  const one = person({ contactId: 'fec:H8CA12001', name: 'One' });
  const senator = person({ contactId: 'congress:P000145', name: 'Alex Padilla', role: 'holder', source: 'congress', office: 'us_senate', officeTitle: 'U.S. Senator', district: SENATE, election: null });
  const president = person({ contactId: 'fec:P80000001', name: 'Pat', office: 'us_president', officeTitle: 'President of the United States', district: NATION });

  it('are in office cards: the House seat on its page; President, Senate and statewide offices on the state’s', () => {
    const seat = raceGroups({ state: 'CA', seat: 12, district: null, holders: [holder], candidates: [one] }, 'holders');
    expect(seat.map((g) => [g.office, g.district.geoid, g.holders.length, g.candidates.length])).toEqual([['us_house', '0612', 1, 1]]);
    const governor = person({ contactId: 'sos:gov', name: 'Gil', source: 'sos', office: 'statewide', officeTitle: 'Governor', district: SENATE });
    const view = { state: 'CA', seat: null, district: null, holders: [senator], candidates: [president, governor] };
    const cards = (part: 'holders' | 'candidates') => raceGroups(view, part).map((g) => [g.office, g.district.geoid, g.holders.length, g.candidates.length]);
    // Nobody's record lists who holds the presidency or the statewide offices, so those have no card for who holds them.
    expect(cards('holders')).toEqual([['us_senate', '06', 1, 0]]);
    expect(cards('candidates')).toEqual([
      ['us_president', 'US', 0, 1],
      ['us_senate', '06', 1, 0],
      ['statewide', '06', 0, 1],
    ]);
    expect(raceGroups({ ...view, candidates: [president] }, 'candidates').map((g) => g.office)).toEqual(['us_president', 'us_senate']);
    expect(raceGroups({ state: 'DC', seat: null, district: null, holders: [], candidates: [] }, 'candidates').map((g) => g.office)).toEqual(['us_president']);
  });

  it('on a state’s page, each House seat with who holds it, how many run, and the party’s candidates', () => {
    const party = { office: 'us_house', district: { kind: 'congressional', geoid: '0612', state: 'CA' } } as unknown as PublicCandidacy;
    const seats = raceSeats('CA', [holder, one, senator], [party]);
    expect(seats).toHaveLength(52);
    expect(seats[11]).toEqual({ seat: 12, code: 'CA-12', path: '/races/ca/12', holders: [{ contactId: 'congress:P000197', name: 'Nancy Pelosi', party: 'Democrat' }], running: 1, party: 1 });
    expect(seats[0]).toMatchObject({ holders: [], running: 0, party: 0 });
  });

  it('the party’s candidates there, for elections not over', () => {
    const c = (office: string, kind: string, geoid: string, state: string | null, electionDate = '2028-11-07') =>
      ({ candidacyId: `${office}${geoid}${electionDate}`, office, district: { kind, geoid, state }, electionDate }) as unknown as PublicCandidacy;
    const all = [c('us_house', 'congressional', '0612', 'CA'), c('us_house', 'congressional', '0613', 'CA'), c('state_upper', 'state_upper', '06038', 'CA'), c('us_president', 'nation', 'US', null), c('us_house', 'congressional', '0612', 'CA', '2024-11-05'), c('us_senate', 'state', '48', 'TX')];
    const ids = (list: PublicCandidacy[]) => list.map((x) => x.candidacyId);
    expect(ids(racePartyCandidates({ state: 'CA', seat: 12 }, all, '2026-11-12'))).toEqual(['us_house06122028-11-07']);
    expect(ids(racePartyCandidates({ state: 'CA', seat: null }, all, '2026-11-12'))).toEqual(['us_house06122028-11-07', 'us_house06132028-11-07', 'state_upper060382028-11-07', 'us_presidentUS2028-11-07']);
  });
});

describe('the sitemap’s race pages', () => {
  it('are every state’s and seat’s, then each person’s page once', () => {
    const paths = raceSitemapPaths(['fec:H8CA49058', 'congress:L000593', 'sos:x', 'fec:H8CA49058']);
    expect(paths.slice(0, 3)).toEqual(['/races/al', '/races/al/1', '/races/al/2']);
    expect(paths).toContain('/races/wy/at-large');
    expect(paths.slice(-2)).toEqual(['/people/H8CA49058', '/people/L000593']);
    expect(paths).toHaveLength(497 + 2);
  });
});
