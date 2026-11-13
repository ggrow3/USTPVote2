import { Collections, generalElectionDay, nextFederalElectionYear, type CandidacyContent, type PersonView, type RaceRecordsRecord, type RaceView } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RacesService } from './candidacies/races.service.js';
import { resetEmulators, TestApi } from './testing/emulator.js';

// DISTRICTS=local (testing/emulator.ts): the Census lists two congressional districts per state (0601, 0602 in
// California); LocalContactSource gives each state two senators and a Senate candidate, each House seat its member, who
// runs again, and a challenger, California a governor's race, and two candidates for President in a presidential year.
// LocalProfileSource gives Hal House a profile.

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

const YEAR = nextFederalElectionYear(new Date().toISOString().slice(0, 10));
const PRESIDENTIAL = YEAR % 4 === 0;

beforeEach(async () => {
  await resetEmulators();
  api.app.get(RacesService).forget();
});

const race = async (path: string) => {
  const res = await api.call('GET', `/v1/public/races/${path}`);
  expect(res.status, path).toBe(200);
  return res.body as RaceView;
};
const line = (c: { contactId: string; name: string }) => `${c.contactId} ${c.name}`;
/** A request with its headers and text, as Hosting forwards it. */
const raw = (url: string) => api.app.inject({ method: 'GET', url });

/** An Active member's approved candidacy. */
async function seedCandidacy(candidacyId: string, name: string, district: CandidacyContent['district'], office: CandidacyContent['office'] = 'us_house') {
  const db = api.firebase.db;
  const content: CandidacyContent = {
    office,
    officeTitle: office === 'us_house' ? 'U.S. Representative' : 'State Senator',
    district,
    electionDate: generalElectionDay(YEAR),
    election: 'general',
    ballotLabel: null,
    platform: 'Fund longevity research.',
    website: null,
  };
  const [first, ...rest] = name.split(' ');
  await db.collection(Collections.members).doc(`acct-${candidacyId}`).set({ accountId: `acct-${candidacyId}`, status: 'active', legalName: name, preferredName: first && rest.length ? null : name });
  await db.collection(Collections.candidacies).doc(candidacyId).set({
    candidacyId,
    accountId: `acct-${candidacyId}`,
    status: 'open',
    published: content,
    publishedAt: '2026-10-01T12:00:00.000Z',
    publishedBy: 'admin',
    proposed: null,
    proposedAt: null,
    declined: null,
    public: true,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  });
}

const CA1 = { kind: 'congressional', geoid: '0601', state: 'CA', name: 'Congressional District 1', point: null, vintage: null } as const;

describe('a House seat’s race page', () => {
  it('lists who holds the seat and who runs, from public records, the party’s candidates first, for anyone', async () => {
    // A member running for the seat, whom the FEC also lists as Cass Challenger: listed once, as the party's.
    await seedCandidacy('cand-cass', 'Cass Challenger', CA1);
    await seedCandidacy('cand-other', 'Ola Other', { ...CA1, geoid: '0602', name: 'Congressional District 2' });
    const res = await raw('/v1/public/races/ca/1');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300, s-maxage=3600');
    const v = res.json<RaceView>();
    expect(v).toMatchObject({ state: 'CA', seat: 1, code: 'CA-1', title: `${YEAR} candidates in CA-1`, electionYear: YEAR, seats: [], profiles: 'ok' });
    // The Census district, with its point for the map.
    expect(v.district).toMatchObject({ geoid: '0601', name: 'Congressional District 1', point: { lat: expect.any(Number) } });
    expect(v.party.map((c) => c.name)).toEqual(['Cass Challenger']);
    expect(v.holders.map(line)).toEqual(['congress:H060100 Hal House']);
    expect(v.candidates.map(line)).toEqual(['fec:H0CA01001 Hal House']);
    expect(v.candidates[0]).toMatchObject({ incumbent: true, profile: { summary: expect.stringContaining('made-up') } });
    expect(v.feeds).toEqual({ fec: 'ok', congress: 'ok', openstates: 'off', civic: 'off', sos: 'ok' });
    expect(v.checkedAt).toMatch(/^\d{4}-/);
  });

  it('has a page for every seat the apportionment gives, its Census name or its number where the list has none', async () => {
    const v = await race('ca/52');
    expect(v.district).toMatchObject({ geoid: '0652', name: 'Congressional District 52', point: null });
    expect(v.holders.map(line)).toEqual(['congress:H065200 Hal House']);
    const wy = await race('wy/at-large');
    expect(wy).toMatchObject({ code: 'WY-AL', title: `${YEAR} candidates for Wyoming’s at-large congressional district`, district: { geoid: '5600' } });
    expect(wy.holders.map(line)).toEqual(['congress:H560000 Hal House']);
  });

  it('is a 404 for an address that is no page, without reading any record', async () => {
    for (const path of ['CA', 'ca/0', 'ca/012', 'ca/53', 'ca/at-large', 'wy/1', 'zz', 'ca/1/2', 'c']) {
      expect((await api.call('GET', `/v1/public/races/${path}`)).status, path).toBe(404);
    }
    expect((await api.firebase.db.collection(Collections.raceRecords).get()).size).toBe(0);
  });
});

describe('a state’s race page', () => {
  it('lists President, the Senate and statewide offices, and every House seat with who holds it and how many run', async () => {
    await seedCandidacy('cand-cass', 'Cass Challenger', CA1);
    await seedCandidacy('cand-sen', 'Sena Torr', { kind: 'state_upper', geoid: '06001', state: 'CA', name: 'State Senate District 1', point: null, vintage: null }, 'state_upper');
    const v = await race('ca');
    expect(v).toMatchObject({ seat: null, code: 'CA', title: `${YEAR} candidates in California`, district: null });
    // Every one of the party's candidates in the state, at any level.
    expect(v.party.map((c) => c.name).sort()).toEqual(['Cass Challenger', 'Sena Torr']);
    expect(v.holders.map(line)).toEqual(['congress:S060001 Sam Senator', 'congress:S060002 Sky Senator']);
    expect(v.candidates.map(line)).toEqual([
      ...(PRESIDENTIAL ? ['fec:P00000001 Pat President', 'fec:P00000002 Rae Runner'] : []),
      'fec:S0CA00001 Sid Hopeful',
      'sos:CA:governor:gil-governor Gil Governor',
      'sos:CA:governor:rita-rival Rita Rival',
    ]);
    expect(v.seats).toHaveLength(52);
    expect(v.seats[0]).toEqual({ seat: 1, code: 'CA-1', path: '/races/ca/1', holders: [{ contactId: 'congress:H060100', name: 'Hal House', party: 'Democrat' }], running: 2, party: 1 });
  });

  it('says a state’s Senate seats are not up in a year neither is elected; DC has none', async () => {
    const de = await race('de');
    // Delaware's seats are class 1 and 2: elected in 2030 and 2026, so not in 2028, unless the records list a special election.
    if (YEAR === 2028) expect(de.notUp).toEqual(de.candidates.some((c) => c.office === 'us_senate') ? [] : [{ office: 'us_senate', kind: 'state', geoid: '10' }]);
    const dc = await race('dc');
    expect(dc.holders).toEqual([]);
    expect(dc.seats.map((s) => s.code)).toEqual(['DC-AL']);
  });
});

describe('the records behind the race pages', () => {
  const stored = async (key: string) => (await api.firebase.db.collection(Collections.raceRecords).doc(key).get()).data() as RaceRecordsRecord | undefined;

  it('are read once for a whole state and kept a day for every api instance: public records only, no profiles', async () => {
    const first = await race('ca/1');
    const record = (await stored('CA'))!;
    expect(record).toMatchObject({ key: 'CA', electionYear: YEAR, checkedAt: first.checkedAt });
    expect(Date.parse(record.freshUntil) - Date.parse(record.checkedAt)).toBe(24 * 60 * 60 * 1000);
    expect(record.contacts.every((c) => c.profile === null)).toBe(true);
    expect(record.people).toContain('fec:H0CA01001');
    expect(record.people).toContain('congress:H060100');
    expect(record.people.some((id) => id.startsWith('sos:'))).toBe(false);
    // Another seat, another instance (nothing held in memory): the same records, not read again.
    api.app.get(RacesService).forget();
    expect((await race('ca/2')).checkedAt).toBe(first.checkedAt);
    // A day later, they are read again.
    await api.firebase.db.collection(Collections.raceRecords).doc('CA').update({ freshUntil: '2000-01-01T00:00:00.000Z' });
    api.app.get(RacesService).forget();
    expect((await race('ca/1')).checkedAt).not.toBe(first.checkedAt);
  });

  it('read again when they are another election’s', async () => {
    await race('tx');
    await api.firebase.db.collection(Collections.raceRecords).doc('TX').update({ electionYear: YEAR - 2, checkedAt: '2000-01-01T00:00:00.000Z' });
    api.app.get(RacesService).forget();
    const v = await race('tx');
    expect(v.checkedAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect((await stored('TX'))?.electionYear).toBe(YEAR);
  });
});

describe('a person’s page', () => {
  const person = async (id: string) => {
    const res = await raw(`/v1/public/people/${id}`);
    expect(res.statusCode, id).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300, s-maxage=3600');
    return res.json<PersonView>();
  };

  it('a member of Congress: their seat’s page, their own run for it, and everyone else listed for it', async () => {
    await race('ca/1');
    const v = await person('H060100');
    expect(v.person).toMatchObject({ contactId: 'congress:H060100', name: 'Hal House', role: 'holder', profile: { summary: expect.stringContaining('made-up') } });
    expect(v.race).toEqual({ path: '/races/ca/1', code: 'CA-1', title: `${YEAR} candidates in CA-1`, seat: 'California’s 1st congressional district' });
    expect(v.also).toMatchObject({ contactId: 'fec:H0CA01001', role: 'candidate', incumbent: true });
    expect(v.others.map(line)).toEqual(['fec:H0CA01002 Cass Challenger']);
  });

  it('an FEC candidate nobody has read the race of yet: found in the state their ID was filed in', async () => {
    const v = await person('S0TX00001');
    expect(v.person).toMatchObject({ name: 'Sid Hopeful', office: 'us_senate', role: 'candidate' });
    expect(v.race).toEqual({ path: '/races/tx', code: 'TX', title: `${YEAR} candidates in Texas`, seat: 'Texas' });
    expect(v.others.map((c) => c.name)).toEqual(['Sam Senator', 'Sky Senator']);
  });

  it.runIf(PRESIDENTIAL)('a candidate for President: no race page of their own', async () => {
    const v = await person('P00000001');
    expect(v).toMatchObject({ person: { name: 'Pat President' }, race: null, also: null });
    expect(v.others.map((c) => c.name)).toEqual(['Rae Runner']);
  });

  it('is a 404 for an ID no record lists, or one in no official shape', async () => {
    await race('ca');
    for (const id of ['Z999999', 'H0CA99009', 'H8ZZ49058', 'sos:CA:governor:gil-governor', 'gil-governor', 'h060100']) {
      expect((await api.call('GET', `/v1/public/people/${encodeURIComponent(id)}`)).status, id).toBe(404);
    }
  });
});

describe('the sitemap', () => {
  it('lists every race page, and the people of the records held', async () => {
    const before = (await raw('/sitemap.xml')).body;
    expect(before).toContain('/races</loc>');
    expect(before).toContain('/races/ca/52</loc>');
    expect(before).toContain('/races/wy/at-large</loc>');
    expect(before).not.toContain('/people/');
    await race('ca/1');
    const after = (await raw('/sitemap.xml')).body;
    expect(after).toContain('/people/H060100</loc>');
    expect(after).toContain('/people/H0CA01002</loc>');
    expect(after).not.toContain('gil-governor');
  });
});
