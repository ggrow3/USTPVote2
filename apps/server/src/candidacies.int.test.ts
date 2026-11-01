import type { AdminCandidacy, CandidateArea, District, LedgerEntry, MyCandidacy, PublicCandidacy } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

// DISTRICTS=local (testing/emulator.ts): two made-up districts of each kind per state, e.g. California's 0601 and 0602.

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;
let ma: Member;
let ma2: Member;
let ada: Member;
let bo: Member;

/** Gives the account a member record with this status, as the membership context would. */
async function memberRecord(user: Member, legalName: string, status = 'active', preferredName: string | null = null) {
  await api.firebase.db.collection('members').doc(user.accountId).set({ accountId: user.accountId, status, legalName, preferredName, state: 'CA' });
}

const DECLARATION = {
  office: 'us_house',
  officeTitle: 'U.S. Representative',
  state: 'CA',
  districtId: '0602',
  electionDate: '2030-11-05',
  election: 'general',
  ballotLabel: 'Transhumanist',
  platform: 'Fund longevity research.\nOpen science for everyone.',
  website: 'https://ada.example',
};

const declare = (by: User, body: Record<string, unknown> = {}) => api.call('POST', '/v1/candidacies', by, { ...DECLARATION, ...body });
const decide = (by: User, id: string, decision: 'approve' | 'decline', basedOn: number, note: string | null = null) =>
  api.call('POST', `/v1/admin/candidacies/${id}/decision`, by, { decision, note, basedOn });
const publicList = async () => (await api.call('GET', '/v1/public/candidacies')).body as PublicCandidacy[];

async function entries(): Promise<LedgerEntry[]> {
  const snap = await api.firebase.db.collection('audit_events').where('type', '==', 'candidacy.changed').orderBy('seq').get();
  return snap.docs.map((d) => d.data() as LedgerEntry);
}

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  ma = await api.member('membership.admin@example.test');
  ma2 = await api.member('membership.admin2@example.test');
  ada = await api.member('ada@example.test');
  bo = await api.member('bo@example.test');
  await api.grant(ma.accountId, 'membership_admin', sa1);
  await api.grant(ma2.accountId, 'membership_admin', sa1);
  await memberRecord(ma, 'Mae Admin');
  await memberRecord(ada, 'Ada Brooks', 'active', 'Ada');
  await memberRecord(bo, 'Bo Lee', 'applicant');
});

describe('districts', () => {
  it('lists the districts of a kind in a state, for anyone', async () => {
    const res = await api.call('GET', '/v1/public/districts?kind=congressional&state=CA');
    expect(res.status).toBe(200);
    expect((res.body as District[]).map((d) => [d.geoid, d.name, d.state])).toEqual([
      ['0601', 'Congressional District 1', 'CA'],
      ['0602', 'Congressional District 2', 'CA'],
    ]);
    expect((await api.call('GET', '/v1/public/districts?kind=nation')).body).toMatchObject([{ geoid: 'US', name: 'United States' }]);
    expect((await api.call('GET', '/v1/public/districts?kind=ward&state=CA')).status).toBe(400);
    expect((await api.call('GET', '/v1/public/districts?kind=county&state=XX')).status).toBe(400);
  });

  it('gives a district’s outline, or 404 for one it does not know', async () => {
    const res = await api.call('GET', '/v1/public/districts/congressional/0602/boundary');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon' } }] });
    expect((await api.call('GET', '/v1/public/districts/congressional/0699/boundary')).status).toBe(404);
    expect((await api.call('GET', '/v1/public/districts/nation/US/boundary')).status).toBe(404);
  });

  it('says whether the map has a key', async () => {
    expect((await api.call('GET', '/v1/public/maps')).body).toEqual({ googleMapsKey: null });
  });
});

describe('a member’s own area', () => {
  const area = async (by?: User) => api.call('GET', '/v1/candidacies/area', by);
  const zip = (user: Member, postalCode: string) =>
    api.firebase.db.collection('members').doc(user.accountId).update({ contact: { city: 'Oakland', postalCode, phone: null } });

  it('is worked out from the ZIP code on the record, which it never sends back', async () => {
    await zip(ada, '94615-1234');
    const res = await area(ada);
    expect(res.status).toBe(200);
    const body = res.body as CandidateArea;
    expect(body).toMatchObject({ state: 'CA', basis: 'zip' });
    expect(body.districts.map((d) => `${d.kind}:${d.geoid}`)).toEqual([
      'congressional:0601',
      'congressional:0602',
      'state_upper:06001',
      'state_lower:06001',
      'county:06001',
      'place:0600100',
    ]);
    expect(body.districts[0]).toMatchObject({ name: 'Congressional District 1', state: 'CA', vintage: 'Local test districts' });
    expect(JSON.stringify(body)).not.toMatch(/94615|1234|Oakland/);
  });

  it('is the whole state without a ZIP code, or with one the Census draws no area for; any status', async () => {
    expect((await area(bo)).body).toEqual({ state: 'CA', districts: [], basis: 'no_zip' });
    await zip(bo, '00000');
    expect((await area(bo)).body).toEqual({ state: 'CA', districts: [], basis: 'unplaced' });
  });

  it('needs a sign-in and a membership record', async () => {
    expect((await area()).status).toBe(401);
    expect((await area(await api.member('nobody@example.test'))).status).toBe(404);
  });
});

describe('declaring', () => {
  it('an Active member declares; it waits for review, with the district as the source names it', async () => {
    const res = await declare(ada);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      accountId: ada.accountId,
      stage: 'waiting',
      public: false,
      published: null,
      proposed: {
        office: 'us_house',
        district: { kind: 'congressional', geoid: '0602', state: 'CA', name: 'Congressional District 2', vintage: 'Local test districts' },
        electionDate: '2030-11-05',
      },
    });
    expect(await publicList()).toEqual([]);
    expect((await api.call('GET', '/v1/candidacies/mine', ada)).body).toMatchObject([{ candidacyId: res.body.candidacyId, stage: 'waiting' }]);
    expect(await entries()).toEqual([]);
  });

  it('a statewide office needs only the state; a district must be one the source lists', async () => {
    const senate = await declare(ada, { office: 'us_senate', officeTitle: 'U.S. Senator', districtId: null });
    expect(senate.body.proposed.district).toMatchObject({ kind: 'state', geoid: '06', name: 'State CA' });
    const unknown = await declare(ada, { districtId: '0699' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.errors).toEqual([{ path: 'districtId', message: 'choose a district from the list' }]);
  });

  it('only Active members declare', async () => {
    expect((await declare(bo)).status).toBe(403);
    expect((await declare(ma, { electionDate: '2020-11-03' })).status).toBe(409);
  });
});

describe('review', () => {
  it('a Membership Admin approves: public, and ledgered with what was approved', async () => {
    const { candidacyId } = (await declare(ada)).body as MyCandidacy;
    const res = await decide(ma, candidacyId, 'approve', 1);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ stage: 'public', name: 'Ada', memberStatus: 'active', publishedBy: ma.accountId });
    expect(await publicList()).toMatchObject([
      { candidacyId, name: 'Ada', officeTitle: 'U.S. Representative', district: { name: 'Congressional District 2' }, platform: DECLARATION.platform },
    ]);
    expect((await api.call('GET', `/v1/public/candidacies/${candidacyId}`)).body).toMatchObject({ candidacyId, name: 'Ada' });
    const [entry] = await entries();
    expect(entry).toMatchObject({ actor: ma.accountId, subject: ada.accountId, payload: { candidacyId, change: 'approved', districtGeoid: '0602' } });
    expect(entry!.payload.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a decline goes back to the member with the note; nobody reviews their own', async () => {
    const mine = (await declare(ma)).body as MyCandidacy;
    expect((await decide(ma, mine.candidacyId, 'approve', 1)).status).toBe(403);
    const declined = await decide(ma2, mine.candidacyId, 'decline', 1, 'Which district do you mean?');
    expect(declined.body).toMatchObject({ stage: 'declined', declined: { note: 'Which district do you mean?', by: ma2.accountId } });
    expect((await decide(ma2, mine.candidacyId, 'approve', 2)).status).toBe(409);
    expect((await api.call('POST', `/v1/admin/candidacies/${mine.candidacyId}/decision`, ma2, { decision: 'decline', note: '', basedOn: 2 })).status).toBe(400);
  });

  it('refuses a review of an older version, and members cannot use the admin routes', async () => {
    const { candidacyId } = (await declare(ada)).body as MyCandidacy;
    await api.call('PUT', `/v1/candidacies/${candidacyId}`, ada, { candidacy: { ...DECLARATION, platform: 'Changed' }, basedOn: 1 });
    expect((await decide(ma, candidacyId, 'approve', 1)).status).toBe(409);
    expect((await api.call('GET', '/v1/admin/candidacies', ada)).status).toBe(403);
  });

  it('lists what waits for review first, with who the member is', async () => {
    const first = (await declare(ada)).body as MyCandidacy;
    await decide(ma, first.candidacyId, 'approve', 1);
    const second = (await declare(ada, { office: 'state_upper', officeTitle: 'State Senator', districtId: '06001' })).body as MyCandidacy;
    const list = (await api.call('GET', '/v1/admin/candidacies', ma)).body as AdminCandidacy[];
    expect(list.map((c) => [c.candidacyId, c.stage, c.name, c.memberState])).toEqual([
      [second.candidacyId, 'waiting', 'Ada', 'CA'],
      [first.candidacyId, 'public', 'Ada', 'CA'],
    ]);
  });
});

describe('after approval', () => {
  let candidacyId: string;
  beforeEach(async () => {
    candidacyId = ((await declare(ada)).body as MyCandidacy).candidacyId;
    await decide(ma, candidacyId, 'approve', 1);
  });

  it('a change waits for review while the approved version stays public', async () => {
    const res = await api.call('PUT', `/v1/candidacies/${candidacyId}`, ada, { candidacy: { ...DECLARATION, platform: 'New platform' }, basedOn: 2 });
    expect(res.body).toMatchObject({ stage: 'public_change_waiting', proposed: { platform: 'New platform' }, version: 3 });
    expect((await publicList())[0]).toMatchObject({ platform: DECLARATION.platform });
    await decide(ma, candidacyId, 'approve', 3);
    expect((await publicList())[0]).toMatchObject({ platform: 'New platform' });
    expect((await api.call('PUT', `/v1/candidacies/${candidacyId}`, bo, { candidacy: DECLARATION, basedOn: 4 })).status).toBe(403);
  });

  it('is hidden while the member is not Active', async () => {
    await memberRecord(ada, 'Ada Brooks', 'lapsed', 'Ada');
    expect(await publicList()).toEqual([]);
    expect((await api.call('GET', `/v1/public/candidacies/${candidacyId}`)).status).toBe(404);
  });

  it('the member withdraws it: off the page, and ledgered', async () => {
    const res = await api.call('POST', `/v1/candidacies/${candidacyId}/withdraw`, ada);
    expect(res.body).toMatchObject({ stage: 'withdrawn', status: 'withdrawn', public: false });
    expect(await publicList()).toEqual([]);
    expect((await entries()).map((e) => e.payload.change)).toEqual(['approved', 'withdrawn']);
    expect((await api.call('POST', `/v1/candidacies/${candidacyId}/withdraw`, ada)).status).toBe(409);
  });

  it('a Membership Admin takes it down with a reason', async () => {
    expect((await api.call('POST', `/v1/admin/candidacies/${candidacyId}/remove`, ma, { reason: '' })).status).toBe(400);
    const res = await api.call('POST', `/v1/admin/candidacies/${candidacyId}/remove`, ma, { reason: 'Not on the ballot' });
    expect(res.body).toMatchObject({ stage: 'removed', ended: { by: ma.accountId, reason: 'Not on the ballot' } });
    expect(await publicList()).toEqual([]);
    expect((await api.call('GET', '/v1/candidacies/mine', ada)).body).toMatchObject([{ stage: 'removed', ended: { reason: 'Not on the ballot' } }]);
  });
});
