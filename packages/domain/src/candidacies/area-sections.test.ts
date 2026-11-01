import { describe, expect, it } from 'vitest';
import { areaSections, isAmong, personMarks, samePerson, type AreaContact, type CandidateArea, type District, type PublicCandidacy } from '../index.js';

const CA49: District = { kind: 'congressional', geoid: '0649', state: 'CA', name: 'Congressional District 49', point: null, vintage: null };
const AD77: District = { kind: 'state_lower', geoid: '06077', state: 'CA', name: 'Assembly District 77', point: null, vintage: null };
const SD38: District = { kind: 'state_upper', geoid: '06038', state: 'CA', name: 'State Senate District 38', point: null, vintage: null };
const CA50: District = { kind: 'congressional', geoid: '0650', state: 'CA', name: 'Congressional District 50', point: null, vintage: null };
const AREA: CandidateArea = { state: 'CA', districts: [CA49, SD38, AD77], basis: 'zip' };
const TODAY = '2026-11-01';

const person = (over: Partial<AreaContact>): AreaContact => ({
  contactId: `x:${over.name ?? 'Mike Levin'}:${over.role ?? 'candidate'}`,
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
  photo: null,
  profile: null,
  ...over,
});

const candidacy = (over: Partial<PublicCandidacy>): PublicCandidacy => ({
  candidacyId: `c:${over.name ?? 'Ada Brooks'}`,
  name: 'Ada Brooks',
  office: 'state_lower',
  officeTitle: 'Member of the State Assembly',
  district: AD77,
  electionDate: '2026-11-03',
  election: 'general',
  ballotLabel: 'Transhumanist',
  platform: 'Longer, healthier lives.',
  website: null,
  publishedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const LEVIN_HOLDER = person({ source: 'congress', role: 'holder', election: null });
const LEVIN_RUNNING = person({ incumbent: true });
const KURDIAN = person({ name: 'Armen Kurdian', party: 'Republican Party' });
const ASSEMBLY_HOLDER = person({ source: 'openstates', role: 'holder', office: 'state_lower', officeTitle: 'Assemblymember', district: AD77, name: 'Tasha Boerner', election: null });

describe('the same person', () => {
  it('is the same seat and the same name, loosely', () => {
    expect(samePerson(LEVIN_HOLDER, LEVIN_RUNNING)).toBe(true);
    expect(samePerson(LEVIN_RUNNING, person({ name: 'MIKE  LÉVIN' }))).toBe(true);
    expect(samePerson(LEVIN_RUNNING, KURDIAN)).toBe(false);
  });

  it('takes a preferred name for the full one by first initial and surname, a suffix aside', () => {
    expect(samePerson(person({ name: 'Mike Levin' }), person({ name: 'Michael T. Levin' }))).toBe(true);
    expect(samePerson(person({ name: 'John Smith' }), person({ name: 'John A. Smith Jr.' }))).toBe(true);
    expect(samePerson(person({ name: 'Mike Levin' }), person({ name: 'Sara Levin' }))).toBe(false);
    expect(samePerson(person({ name: 'Cher' }), person({ name: 'Chad' }))).toBe(false);
  });

  it('is never someone for another seat by initial and surname', () => {
    expect(samePerson(LEVIN_RUNNING, person({ district: CA50 }))).toBe(false);
    expect(samePerson(person({ name: 'Mike Levin' }), person({ name: 'Michael Levin', office: 'state_upper', district: SD38 }))).toBe(false);
  });

  it('is among people for the same seat, or by exactly the same name for any seat in the area', () => {
    const runsForSenate = person({ office: 'state_upper', officeTitle: 'State Senator', district: SD38, name: 'Tasha Boerner' });
    expect(isAmong(runsForSenate, [LEVIN_HOLDER, ASSEMBLY_HOLDER])).toBe(true);
    expect(isAmong(person({ office: 'state_upper', district: SD38, name: 'T. Boerner' }), [ASSEMBLY_HOLDER])).toBe(false);
    expect(isAmong(KURDIAN, [LEVIN_HOLDER, ASSEMBLY_HOLDER])).toBe(false);
  });
});

describe('the area pages’ three groups', () => {
  it('puts the party’s candidates, the representatives and the others running apart', () => {
    const ada = candidacy({});
    const s = areaSections(AREA, [LEVIN_HOLDER, LEVIN_RUNNING, KURDIAN, ASSEMBLY_HOLDER], [ada], TODAY);
    expect(s.party).toEqual([ada]);
    expect(s.holders).toEqual([LEVIN_HOLDER, ASSEMBLY_HOLDER]);
    const house = (groups: typeof s.running) => groups.find((g) => g.office === 'us_house' && g.district.geoid === '0649')!;
    expect(house(s.representatives).holders).toEqual([LEVIN_HOLDER]);
    expect(house(s.representatives).candidates).toEqual([]);
    expect(house(s.running).holders).toEqual([]);
    expect(house(s.running).candidates.map((c) => c.name)).toEqual(['Mike Levin', 'Armen Kurdian']);
    // Every office of the area is in both lists, each page choosing what to show.
    expect(s.representatives.map((g) => g.office)).toEqual(s.running.map((g) => g.office));
  });

  it('lists the party’s candidates in the area for elections to come only', () => {
    const here = candidacy({});
    const past = candidacy({ name: 'Past Person', electionDate: '2026-06-02', election: 'primary' });
    const elsewhere = candidacy({ name: 'Ben Cruz', office: 'us_house', officeTitle: 'U.S. Representative', district: CA50 });
    const president = candidacy({ name: 'Cy Dunn', office: 'us_president', officeTitle: 'President', district: { kind: 'nation', geoid: 'US', state: null, name: 'United States', point: null, vintage: null } });
    expect(areaSections(AREA, [], [here, past, elsewhere, president], TODAY).party).toEqual([here, president]);
    // A member whose ZIP code could not be placed sees every one in their state.
    expect(areaSections({ state: 'CA', districts: [], basis: 'no_zip' }, [], [here, past, elsewhere], TODAY).party).toEqual([here, elsewhere]);
  });

  it('lists a party candidate whom a public record also lists as running only with the party', () => {
    const member = candidacy({ name: 'Mike Levin', office: 'us_house', officeTitle: 'U.S. Representative', district: CA49 });
    const s = areaSections(AREA, [LEVIN_HOLDER, person({ name: 'Michael Levin', incumbent: true }), KURDIAN], [member], TODAY);
    const house = s.running.find((g) => g.office === 'us_house')!;
    expect(house.candidates.map((c) => c.name)).toEqual(['Armen Kurdian']);
    // Still one of the member's representatives, and marked as both.
    expect(s.representatives.find((g) => g.office === 'us_house')!.holders).toEqual([LEVIN_HOLDER]);
    expect(personMarks(LEVIN_HOLDER, s.holders, s.party)).toEqual({ representative: true, party: true });
    expect(personMarks(member, s.holders, s.party)).toEqual({ representative: true, party: true });
  });

  it('marks each person as what they are to the member', () => {
    const ada = candidacy({});
    const s = areaSections(AREA, [LEVIN_HOLDER, LEVIN_RUNNING, KURDIAN, ASSEMBLY_HOLDER], [ada], TODAY);
    expect(personMarks(LEVIN_RUNNING, s.holders, s.party)).toEqual({ representative: true, party: false });
    expect(personMarks(KURDIAN, s.holders, s.party)).toEqual({ representative: false, party: false });
    expect(personMarks(ada, s.holders, s.party)).toEqual({ representative: false, party: true });
    expect(personMarks(ASSEMBLY_HOLDER, s.holders, s.party)).toEqual({ representative: true, party: false });
  });

  it('marks someone in office here who runs for another seat as the party’s, never a namesake running elsewhere', () => {
    // The Assembly member runs for the State Senate as the party's candidate: their seat's card shows both badges.
    const forSenate = candidacy({ name: 'Tasha Boerner', office: 'state_upper', officeTitle: 'State Senator', district: SD38 });
    const s = areaSections(AREA, [ASSEMBLY_HOLDER], [forSenate], TODAY);
    expect(personMarks(ASSEMBLY_HOLDER, s.holders, s.party)).toEqual({ representative: true, party: true });
    // The party's candidate for one House seat; the FEC lists someone of that name for the next one too.
    const member = candidacy({ name: 'Cass Challenger', office: 'us_house', officeTitle: 'U.S. Representative', district: CA49 });
    const elsewhere = person({ name: 'Cass Challenger', district: { kind: 'congressional', geoid: '0650', state: 'CA', name: 'Congressional District 50' } });
    expect(personMarks(elsewhere, [], [member])).toEqual({ representative: false, party: false });
    expect(personMarks(person({ name: 'Cass Challenger' }), [], [member])).toEqual({ representative: false, party: true });
  });

  it('has no representatives for a ZIP code someone types, which lists only who runs', () => {
    const s = areaSections(AREA, [LEVIN_RUNNING, KURDIAN], [], TODAY);
    expect(s.holders).toEqual([]);
    expect(s.representatives.every((g) => g.holders.length === 0)).toBe(true);
    expect(personMarks(LEVIN_RUNNING, s.holders, s.party)).toEqual({ representative: false, party: false });
  });
});
