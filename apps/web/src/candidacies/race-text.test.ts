import type { AreaContact, PersonView } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { personRoleText, personShareable, raceCredit, raceCrumbs, raceShareable, seatSummaryText, stateOffices } from './race-text.js';

const ORIGIN = 'https://vote.example';
const levin: AreaContact = {
  contactId: 'congress:L000593',
  source: 'congress',
  role: 'holder',
  office: 'us_house',
  officeTitle: 'U.S. Representative',
  district: { kind: 'congressional', geoid: '0649', state: 'CA', name: 'Congressional District 49' },
  name: 'Mike Levin',
  party: 'Democrat',
  email: null,
  contactUrl: null,
  website: null,
  sourceUrl: null,
  election: null,
  incumbent: false,
  photo: null,
  profile: null,
};
const race = { path: '/races/ca/49', code: 'CA-49', title: '2028 candidates in CA-49', seat: 'California’s 49th congressional district' };
const view = (person: AreaContact): PersonView => ({ person, electionYear: 2028, race, also: null, others: [], checkedAt: '2026-11-12T00:00:00.000Z' });

describe('the race pages’ words', () => {
  it('name what a state’s page covers', () => {
    expect(stateOffices('CA', 2028)).toBe('President, the U.S. Senate and its 52 seats in the U.S. House');
    expect(stateOffices('CA', 2026, true)).toBe('the U.S. Senate, the statewide offices and its 52 seats in the U.S. House');
    expect(stateOffices('TX', 2026)).toBe('the U.S. Senate and its 38 seats in the U.S. House');
    expect(stateOffices('WY', 2026)).toBe('the U.S. Senate and its seat in the U.S. House');
    expect(stateOffices('DC', 2026)).toBe('its seat in the U.S. House');
  });

  it('sum up a House seat on its state’s page', () => {
    const seat = { seat: 49, code: 'CA-49', path: '/races/ca/49', holders: [{ contactId: 'congress:L000593', name: 'Mike Levin', party: 'Democrat' }], running: 2, party: 1 };
    expect(seatSummaryText(seat)).toBe('Mike Levin (Democrat) · 3 running');
    expect(seatSummaryText({ ...seat, holders: [], running: 0, party: 0 })).toBe('Vacant, or not listed · nobody listed as running yet');
  });

  it('credit the records, California’s list only where it was used', () => {
    const feeds = { fec: 'ok', congress: 'ok', openstates: 'off', civic: 'off', sos: 'off' } as const;
    expect(raceCredit(feeds)).not.toMatch(/California/);
    expect(raceCredit({ ...feeds, sos: 'ok' })).toMatch(/California’s ballot/);
  });

  it('share a race page by its own address', () => {
    expect(raceShareable({ state: 'CA', seat: 49, title: '2028 candidates in CA-49', electionYear: 2028, candidates: [] }, ORIGIN)).toEqual({
      text: '2028 candidates in CA-49: who is running, and who holds the seat now.',
      url: 'https://vote.example/races/ca/49',
      hashtags: [],
      title: '2028 candidates in CA-49',
    });
    const wy = raceShareable({ state: 'WY', seat: null, title: '2028 candidates in Wyoming', electionYear: 2028, candidates: [] }, ORIGIN);
    expect(wy).toMatchObject({ url: 'https://vote.example/races/wy', text: '2028 candidates in Wyoming: who is running for President, the U.S. Senate and its seat in the U.S. House, and who holds those seats now.' });
  });

  it('say a person’s part and share their page', () => {
    expect(personRoleText(view(levin))).toBe('U.S. Representative for California’s 49th congressional district');
    const running = { ...levin, contactId: 'fec:H8CA49058', source: 'fec', role: 'candidate', election: '2028' } as const;
    expect(personRoleText(view(running))).toBe('Running for U.S. Representative, California’s 49th congressional district, in 2028');
    expect(personShareable(view(levin), ORIGIN)).toEqual({
      text: 'Mike Levin (Democrat), U.S. Representative for California’s 49th congressional district.',
      url: 'https://vote.example/people/L000593',
      hashtags: [],
      title: 'Mike Levin',
    });
    expect(personShareable(view(running), ORIGIN).text).toBe('Mike Levin (Democrat), a candidate for U.S. Representative, California’s 49th congressional district, in 2028.');
  });

  it('lead back up from a seat to its state and every race', () => {
    expect(raceCrumbs('CA', race)).toEqual([
      { label: 'Races', to: '/races' },
      { label: 'California', to: '/races/ca' },
      { label: 'CA-49', to: '/races/ca/49' },
    ]);
    expect(raceCrumbs('DC', null).map((c) => c.label)).toEqual(['Races', 'The District of Columbia']);
  });
});
