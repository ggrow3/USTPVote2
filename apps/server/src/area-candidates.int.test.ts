import type { AreaCandidatesView } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AREA_LOOKUP_RATE, PublicAreaCandidatesController } from './candidacies/candidacies.controller.js';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

// DISTRICTS=local (testing/emulator.ts): a ZIP code is in the first district of each kind, and one ending in 5 in both
// congressional districts; one starting with 9 is in California, with 1 in New York; 00000 is nowhere.
// LocalContactSource gives a House race and, with a ZIP code, a ballot; LocalProfileSource a profile for Hal House.

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let ada: Member;
let comms: Member;

beforeEach(async () => {
  await resetEmulators();
  api.app.get(PublicAreaCandidatesController).forget();
  const [sa1] = await api.systemAdmins();
  ada = await api.member('ada@example.test');
  comms = await api.member('comms@example.test');
  await api.grant(comms.accountId, 'communications_admin', sa1!);
  await api.firebase.db
    .collection('members')
    .doc(ada.accountId)
    .set({ accountId: ada.accountId, status: 'active', legalName: 'Ada Brooks', preferredName: null, state: 'CA', contact: { city: 'Oakland', postalCode: '94615', phone: null } });
});

const names = (v: AreaCandidatesView) => v.candidates.map((c) => `${c.source} ${c.office}@${c.district.geoid} ${c.name}`);
const lookUp = (zip: unknown, headers: Record<string, string> = {}) => api.call('POST', '/v1/public/candidates/area', undefined, { zip }, headers);

describe('the Candidates page’s people in an area', () => {
  it('for a member, in their own area: who holds and runs for each office, from public records and admins, with the ballot and profiles, and never their ZIP code', async () => {
    const enter = (body: Record<string, unknown>) =>
      api.call('POST', '/v1/admin/area-contacts', comms, { role: 'candidate', office: 'county', officeTitle: 'County Supervisor', state: 'CA', ...body });
    await enter({ districtId: '06001', name: 'Cora County', electionDate: '2030-11-05' });
    await enter({ role: 'holder', districtId: '06001', name: 'Hope Holder' });
    // Not in Ada's area, or past its election: neither is listed.
    await enter({ districtId: '06003', name: 'Sam Second', electionDate: '2030-11-05' });
    await enter({ districtId: '06001', name: 'Pat Past', electionDate: '2020-11-03' });
    const res = await api.call('GET', '/v1/candidacies/area/candidates', ada);
    expect(res.status).toBe(200);
    const v = res.body as AreaCandidatesView;
    expect(v.area).toMatchObject({ state: 'CA', basis: 'zip' });
    expect(v.feeds).toEqual({ fec: 'ok', congress: 'ok', openstates: 'ok', civic: 'ok', sos: 'ok' });
    expect(v.notUp).toEqual([]);
    expect(v.profiles).toBe('ok');
    expect(names(v)).toEqual([
      'fec us_senate@06 Sid Hopeful',
      'fec us_house@0601 Hal House',
      'fec us_house@0601 Cass Challenger',
      'fec us_house@0602 Hal House',
      'fec us_house@0602 Cass Challenger',
      'civic state_upper@06001 Uma Upper',
      'civic state_upper@06001 Bea Ballot',
      'sos statewide@06 Gil Governor',
      'sos statewide@06 Rita Rival',
      'sos state_lower@06001 Lou Lower',
      'sos state_lower@06001 Ana Assembly',
      'admin county@06001 Cora County',
    ]);
    expect(v.candidates.every((c) => c.role === 'candidate')).toBe(true);
    expect(v.holders.map((c) => `${c.source} ${c.office}@${c.district.geoid} ${c.name}`)).toEqual([
      'congress us_senate@06 Sam Senator',
      'congress us_senate@06 Sky Senator',
      'congress us_house@0601 Hal House',
      'congress us_house@0602 Hal House',
      'openstates state_upper@06001 Uma Upper',
      'openstates state_lower@06001 Lou Lower',
      'admin county@06001 Hope Holder',
    ]);
    expect(v.candidates[1]).toMatchObject({ incumbent: true, profile: { summary: expect.stringContaining('made-up') } });
    expect(v.candidates[6]).toMatchObject({ email: 'bea@campaign.example', website: 'https://bea.example', photo: { url: 'https://bea.example/photo.jpg' } });
    expect(v.ballot).toMatchObject([{ office: 'Governing Board Member', candidates: [{ name: 'Sal School' }] }]);
    expect(JSON.stringify(v)).not.toContain('94615');
    expect((await api.call('GET', '/v1/candidacies/area/candidates')).status).toBe(401);
  });

  it('for anyone, by a ZIP code they type: its state and districts, public records only, and nothing kept', async () => {
    await api.call('POST', '/v1/admin/area-contacts', comms, {
      role: 'candidate',
      office: 'county',
      officeTitle: 'County Executive',
      state: 'NY',
      districtId: '36001',
      name: 'Nell North',
      electionDate: '2030-11-05',
    });
    const res = await lookUp('10005');
    expect(res.status).toBe(200);
    const v = res.body as AreaCandidatesView;
    expect(v.area.state).toBe('NY');
    expect(v.area.districts.map((d) => `${d.kind}:${d.geoid}`)).toEqual([
      'congressional:3601',
      'congressional:3602',
      'state_upper:36001',
      'state_lower:36001',
      'county:36001',
      'place:3600100',
    ]);
    expect(names(v)).toContain('fec us_house@3602 Cass Challenger');
    expect(v.candidates.some((c) => c.source === 'admin')).toBe(false);
    expect(v.holders).toEqual([]);
    // California's own list is California's only.
    expect(v.feeds).toMatchObject({ congress: 'off', openstates: 'off', sos: 'off' });
    expect(v.ballot).toHaveLength(1);
    expect(JSON.stringify(v)).not.toContain('10005');
    expect((await api.firebase.db.listCollections()).map((c) => c.id)).not.toContain('area_lookups');
  });

  it('refuses a ZIP code that is not five digits, and one the Census has no area for', async () => {
    for (const zip of ['9213', '92130-1234', 92130, null]) expect((await lookUp(zip)).status).toBe(400);
    const nowhere = await lookUp('00000');
    expect(nowhere.status).toBe(404);
    expect(nowhere.body.detail).toMatch(/no area for that ZIP code/);
  });

  it('limits how often one address looks up a ZIP code', async () => {
    const from = { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' };
    for (let i = 0; i < AREA_LOOKUP_RATE.visits; i++) expect((await lookUp('94615', from)).status).toBe(200);
    expect((await lookUp('94615', from)).status).toBe(429);
    expect((await lookUp('94615', { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' })).status).toBe(200);
  });
});
