import type { AreaContact, PersonView, PublicCandidacy, RaceView } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { personPreview, racePreview } from './candidacies/race-preview.js';

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

const pelosi = person({ contactId: 'congress:P000197', name: 'Nancy Pelosi', role: 'holder', source: 'congress', party: 'Democrat', election: null });
const seatView = (over: Partial<RaceView> = {}): RaceView => ({
  state: 'CA',
  seat: 12,
  code: 'CA-12',
  title: '2028 candidates in CA-12',
  electionYear: 2028,
  district: null,
  party: [],
  holders: [pelosi],
  candidates: [person({ contactId: 'fec:H8CA12001', name: 'One' }), person({ contactId: 'fec:H8CA12002', name: 'Two' })],
  notUp: [],
  seats: [],
  feeds: { fec: 'ok', congress: 'ok', openstates: 'off', civic: 'off', sos: 'off' },
  profiles: 'off',
  checkedAt: '2026-11-12T00:00:00.000Z',
  ...over,
});

describe('a race page’s link preview', () => {
  it('names the seat, who holds it and how many run, the party’s candidates among them', () => {
    const ada = { name: 'Ada Brooks' } as PublicCandidacy;
    const preview = racePreview({ state: 'CA', seat: 12 }, seatView({ party: [ada] }), 2028);
    expect(preview.title).toBe('2028 candidates in CA-12');
    expect(preview.description).toBe(
      'Who is running for California’s 12th congressional district in 2028, and who holds the seat now: Nancy Pelosi (Democrat). 3 candidates listed so far. Among them the Transhumanist Party’s Ada Brooks. From public records: FEC filings and the members of Congress.',
    );
    expect(preview.card).toEqual({
      kicker: 'U.S. House · 2028',
      title: '2028 candidates in CA-12',
      lines: ['California’s 12th congressional district', 'Holds the seat: Nancy Pelosi (Democrat)', '3 candidates listed so far'],
    });
  });

  it('says what the page is before any record is held, never waiting for one', () => {
    const preview = racePreview({ state: 'WY', seat: 'at-large' }, null, 2028);
    expect(preview.title).toBe('2028 candidates for Wyoming’s at-large congressional district');
    expect(preview.card.lines).toEqual(['Wyoming’s at-large congressional district']);
    expect(preview.description).not.toMatch(/listed so far/);
    // Read, with nobody running yet.
    const empty = racePreview({ state: 'CA', seat: 12 }, seatView({ candidates: [] }), 2028);
    expect(empty.description).toMatch(/Nancy Pelosi \(Democrat\)\. Nobody listed as running yet\./);
    expect(empty.card.lines?.at(-1)).toBe('Nobody listed as running yet');
  });

  it('on a state’s page, the Senate race and the House seats’ candidates together', () => {
    const senate = person({ contactId: 'fec:S8CA00001', name: 'Sen', office: 'us_senate', district: { kind: 'state', geoid: '06', state: 'CA', name: 'CA' } });
    const seats = [
      { seat: 1, code: 'CA-1', path: '/races/ca/1', holders: [], running: 2, party: 1 },
      { seat: 2, code: 'CA-2', path: '/races/ca/2', holders: [], running: 3, party: 0 },
    ];
    const preview = racePreview({ state: 'CA', seat: null }, seatView({ seat: null, code: 'CA', title: '2028 candidates in California', holders: [], candidates: [senate], seats }), 2028);
    expect(preview.title).toBe('2028 candidates in California');
    expect(preview.description).toMatch(/^Who is running in California in 2028 for President, the U\.S\. Senate and its 52 seats in the U\.S\. House/);
    expect(preview.card).toEqual({ kicker: 'Races · 2028', title: '2028 candidates in California', lines: ['U.S. Senate: 1 candidate', 'U.S. House: 6 candidates for 52 seats'] });
    const dc = racePreview({ state: 'DC', seat: null }, null, 2026);
    expect(dc.description).toMatch(/^Who is running in the District of Columbia in 2026 for its seat in the U\.S\. House/);
  });
});

describe('a person’s link preview', () => {
  const view = (p: AreaContact, also: AreaContact | null = null): PersonView => ({
    person: p,
    electionYear: 2028,
    race: { path: '/races/ca/12', code: 'CA-12', title: '2028 candidates in CA-12', seat: 'California’s 12th congressional district' },
    also,
    others: [],
    checkedAt: '2026-11-12T00:00:00.000Z',
  });

  it('a member of Congress: their office and seat, and whether they run again', () => {
    const preview = personPreview(view(pelosi, person({ contactId: 'fec:H8CA05020', name: 'Nancy Pelosi', incumbent: true })));
    expect(preview).toMatchObject({ title: 'Nancy Pelosi · U.S. Representative', type: 'profile' });
    expect(preview.description).toBe('Nancy Pelosi (Democrat), U.S. Representative for California’s 12th congressional district, running again in 2028. Who else is listed for the seat, from public records.');
    expect(preview.card).toEqual({ kicker: 'U.S. Representative', title: 'Nancy Pelosi', lines: ['California’s 12th congressional district', 'Democrat', 'Running again in 2028'] });
  });

  it('a candidate: the race they run in', () => {
    const preview = personPreview({ ...view(person({ contactId: 'fec:P80000001', name: 'Pat', office: 'us_president', officeTitle: 'President of the United States' })), race: null });
    expect(preview.title).toBe('Pat · Candidate for President of the United States');
    expect(preview.card).toEqual({ kicker: 'Candidate · President of the United States', title: 'Pat', lines: ['The United States', 'Running in 2028'] });
  });
});
