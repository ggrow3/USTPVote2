import { describe, expect, it } from 'vitest';
import {
  addAreaContact,
  areaContactContent,
  areaContactInputSchema,
  areaContactView,
  changeAreaContact,
  fecDisplayName,
  generalElectionDay,
  groupAreaContacts,
  inContactArea,
  isPublicLedgerEvent,
  mergeContacts,
  nextFederalElectionYear,
  OFFICES_OF_KIND,
  removeAreaContact,
  type AreaContact,
  type CandidateArea,
  type District,
} from '../index.js';

const AT = '2026-11-01T12:00:00.000Z';
const CA49: District = { kind: 'congressional', geoid: '0649', state: 'CA', name: 'Congressional District 49', point: null, vintage: null };
const SD38: District = { kind: 'state_upper', geoid: '06038', state: 'CA', name: 'State Senate District 38', point: null, vintage: null };
const AREA: CandidateArea = { state: 'CA', districts: [CA49, SD38], basis: 'zip' };

const INPUT = {
  role: 'holder',
  office: 'state_upper',
  officeTitle: 'State Senator',
  state: 'CA',
  districtId: '06038',
  name: 'Ana Ruiz',
  email: 'ana@senate.example',
};

const person = (over: Partial<AreaContact>): AreaContact => ({
  contactId: 'x',
  source: 'fec',
  role: 'candidate',
  office: 'us_house',
  officeTitle: 'U.S. Representative',
  district: { kind: 'congressional', geoid: '0649', state: 'CA', name: 'Congressional District 49' },
  name: 'Mike Levin',
  party: 'Democratic Party',
  email: null,
  contactUrl: null,
  website: null,
  sourceUrl: null,
  election: '2026',
  incumbent: false,
  ...over,
});

describe('admin entries', () => {
  it('need a district the office is elected from, and an election date only for someone running', () => {
    expect(areaContactInputSchema.safeParse(INPUT).success).toBe(true);
    expect(areaContactInputSchema.safeParse({ ...INPUT, electionDate: '2026-11-03' }).error?.issues[0]?.path).toEqual(['electionDate']);
    expect(areaContactInputSchema.safeParse({ ...INPUT, role: 'candidate' }).error?.issues[0]?.path).toEqual(['electionDate']);
    expect(areaContactInputSchema.safeParse({ ...INPUT, role: 'candidate', electionDate: '2026-11-03' }).success).toBe(true);
    expect(areaContactInputSchema.safeParse({ ...INPUT, districtId: '4801' }).error?.issues[0]?.path).toEqual(['districtId']);
    expect(areaContactInputSchema.safeParse({ ...INPUT, office: 'us_president', state: 'CA', districtId: null }).error?.issues[0]?.path).toEqual(['state']);
    expect(areaContactInputSchema.safeParse({ ...INPUT, office: 'statewide', officeTitle: 'Governor', districtId: null }).success).toBe(true);
  });

  it('take an email address and https addresses, or none', () => {
    expect(areaContactInputSchema.parse({ ...INPUT, email: '  ' })).toMatchObject({ email: null, contactUrl: null, website: null, party: null });
    expect(areaContactInputSchema.safeParse({ ...INPUT, email: 'not an address' }).error?.issues[0]?.path).toEqual(['email']);
    expect(areaContactInputSchema.safeParse({ ...INPUT, contactUrl: 'http://senate.example/contact' }).error?.issues[0]?.message).toBe('use the https:// address');
  });

  it('are added, changed from the version edited, and removed, each ledgered for Auditors', () => {
    const content = areaContactContent(areaContactInputSchema.parse(INPUT), SD38);
    const { record, event } = addAreaContact(content, 'c1', 'admin', AT);
    expect(record).toMatchObject({ contactId: 'c1', name: 'Ana Ruiz', district: SD38, version: 1 });
    expect(record).not.toHaveProperty('districtId');
    expect(event).toMatchObject({ type: 'area_contact.changed', subject: 'c1', payload: { change: 'added', role: 'holder', office: 'state_upper', geoid: '06038', name: 'Ana Ruiz' } });
    expect(isPublicLedgerEvent('area_contact.changed')).toBe(false);
    const changed = changeAreaContact(record, { ...content, name: 'Ana M. Ruiz' }, 1, 'admin', AT);
    expect(changed.ok && changed.value.record).toMatchObject({ name: 'Ana M. Ruiz', version: 2 });
    expect(changeAreaContact(record, content, 2, 'admin', AT)).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(changeAreaContact(null, content, 1, 'admin', AT)).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(removeAreaContact(null, 'admin')).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(removeAreaContact(record, 'admin')).toMatchObject({ ok: true, value: { payload: { change: 'removed' } } });
    expect(areaContactView(record)).toMatchObject({ source: 'admin', election: null, district: { kind: 'state_upper', geoid: '06038', name: 'State Senate District 38' } });
  });
});

describe('the Your area page', () => {
  it('holds nationwide and statewide offices, and districts only when the ZIP code placed the member', () => {
    expect(inContactArea({ kind: 'nation', geoid: 'US', state: null }, AREA)).toBe(true);
    expect(inContactArea({ kind: 'state', geoid: '06', state: 'CA' }, AREA)).toBe(true);
    expect(inContactArea({ kind: 'congressional', geoid: '0649', state: 'CA' }, AREA)).toBe(true);
    expect(inContactArea({ kind: 'congressional', geoid: '0650', state: 'CA' }, AREA)).toBe(false);
    expect(inContactArea({ kind: 'congressional', geoid: '0649', state: 'CA' }, { ...AREA, districts: [], basis: 'unplaced' })).toBe(false);
    expect(inContactArea({ kind: 'state', geoid: '41', state: 'OR' }, AREA)).toBe(false);
  });

  it('lists every office of the area, nationwide first, with who holds it and who runs', () => {
    const groups = groupAreaContacts(AREA, [
      person({ contactId: 'a', name: 'Eli Stern' }),
      person({ contactId: 'b', name: 'Mike Levin', incumbent: true }),
      person({ contactId: 'c', role: 'holder', name: 'Mike Levin', election: null }),
      person({ contactId: 'd', office: 'state_upper', district: { kind: 'state_upper', geoid: '06038', state: 'CA', name: 'State Senate District 38' }, role: 'holder' }),
      person({ contactId: 'e', district: { kind: 'congressional', geoid: '0650', state: 'CA', name: 'Congressional District 50' } }),
    ]);
    expect(groups.map((g) => `${g.office}@${g.district.geoid}`)).toEqual(['us_president@US', 'us_senate@06', 'statewide@06', 'us_house@0649', 'state_upper@06038']);
    const house = groups.find((g) => g.office === 'us_house')!;
    expect(house.holders.map((c) => c.contactId)).toEqual(['c']);
    expect(house.candidates.map((c) => c.contactId)).toEqual(['b', 'a']);
    expect(groups.flatMap((g) => [...g.holders, ...g.candidates]).some((c) => c.contactId === 'e')).toBe(false);
    expect(OFFICES_OF_KIND.state).toEqual(['us_senate', 'statewide']);
  });

  it('lets an admin entry for the same person take the place of the public record’s', () => {
    const fec = person({ contactId: 'fec:1', name: 'Mike Levin' });
    const entered = person({ contactId: 'admin-1', source: 'admin', name: 'mike  levin', email: 'mike@campaign.example' });
    const other = person({ contactId: 'fec:2', name: 'Eli Stern' });
    expect(mergeContacts([fec, other], [entered]).map((c) => c.contactId)).toEqual(['fec:2', 'admin-1']);
    const record = { ...fec, incumbent: true, sourceUrl: 'https://www.fec.gov/data/candidate/1/', website: 'https://levin.example' };
    expect(mergeContacts([record], [{ ...entered, party: null }])[0]).toMatchObject({
      contactId: 'admin-1',
      source: 'admin',
      email: 'mike@campaign.example',
      party: 'Democratic Party',
      website: 'https://levin.example',
      sourceUrl: 'https://www.fec.gov/data/candidate/1/',
      incumbent: true,
    });
    expect(mergeContacts([fec], [{ ...entered, role: 'holder' }]).map((c) => c.contactId)).toEqual(['fec:1', 'admin-1']);
  });

  it('knows the next federal general election', () => {
    expect(generalElectionDay(2026)).toBe('2026-11-03');
    expect(generalElectionDay(2028)).toBe('2028-11-07');
    expect(generalElectionDay(2022)).toBe('2022-11-08');
    expect(nextFederalElectionYear('2026-11-01')).toBe(2026);
    expect(nextFederalElectionYear('2026-11-03')).toBe(2026);
    expect(nextFederalElectionYear('2026-11-04')).toBe(2028);
    expect(nextFederalElectionYear('2027-03-01')).toBe(2028);
  });

  it('writes the FEC’s names as people do', () => {
    expect(fecDisplayName('LEVIN, MIKE')).toBe('Mike Levin');
    expect(fecDisplayName('PARKER, STAR L')).toBe('Star L Parker');
    expect(fecDisplayName('MCDONALD, JOHN A. JR.')).toBe('John A. McDonald Jr.');
    expect(fecDisplayName("O'BRIEN-SMITH, MARY MRS.")).toBe("Mary O'Brien-Smith");
    expect(fecDisplayName('DE LA CRUZ, ANA III')).toBe('Ana De La Cruz III');
    expect(fecDisplayName('WRITE IN')).toBe('Write In');
  });
});
