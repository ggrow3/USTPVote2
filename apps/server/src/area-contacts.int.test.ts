import type { AreaContactRecord, AreaContactsView, EmailTemplate, LedgerEntry } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

// DISTRICTS=local (testing/emulator.ts): a ZIP code is in the first district of each kind, and one ending in 5 in both
// congressional districts; LocalContactSource gives made-up senators, a House race and state legislators.

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;
let comms: Member;
let ada: Member;

async function memberRecord(user: Member, postalCode: string | null) {
  await api.firebase.db
    .collection('members')
    .doc(user.accountId)
    .set({ accountId: user.accountId, status: 'active', legalName: 'Ada Brooks', preferredName: null, state: 'CA', contact: postalCode ? { city: 'Oakland', postalCode, phone: null } : null });
}

const view = async (by: User) => (await api.call('GET', '/v1/candidacies/area/contacts', by)).body as AreaContactsView;
const names = (v: AreaContactsView) => v.contacts.map((c) => `${c.source} ${c.role} ${c.office}@${c.district.geoid} ${c.name}`);

const COUNTY = { role: 'holder', office: 'county', officeTitle: 'County Supervisor', state: 'CA', districtId: '06001', name: 'Cora County', email: 'cora@county.example' };
const add = (body: Record<string, unknown>, by: User = comms) => api.call('POST', '/v1/admin/area-contacts', by, body);

async function entries(type: string): Promise<LedgerEntry[]> {
  const snap = await api.firebase.db.collection('audit_events').where('type', '==', type).orderBy('seq').get();
  return snap.docs.map((d) => d.data() as LedgerEntry);
}

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  comms = await api.member('comms@example.test');
  ada = await api.member('ada@example.test');
  await api.grant(comms.accountId, 'communications_admin', sa1);
  await memberRecord(ada, '94615');
});

describe('the Your area page', () => {
  it('lists who holds and who runs for each office the ZIP code reaches, with every office’s email', async () => {
    const v = await view(ada);
    expect(v.area).toMatchObject({ state: 'CA', basis: 'zip' });
    expect(v.feeds).toEqual({ fec: 'ok', congress: 'ok', openstates: 'ok' });
    expect(v.electionYear % 2).toBe(0);
    expect(names(v)).toEqual([
      'congress holder us_senate@06 Sam Senator',
      'congress holder us_senate@06 Sky Senator',
      'fec candidate us_senate@06 Sid Hopeful',
      'congress holder us_house@0601 Hal House',
      'fec candidate us_house@0601 Hal House',
      'fec candidate us_house@0601 Cass Challenger',
      'congress holder us_house@0602 Hal House',
      'fec candidate us_house@0602 Hal House',
      'fec candidate us_house@0602 Cass Challenger',
      'openstates holder state_upper@06001 Uma Upper',
      'openstates holder state_lower@06001 Lou Lower',
    ]);
    expect(Object.keys(v.templates)).toHaveLength(8);
    expect(v.templates.us_house).toMatchObject({ version: 0, body: expect.stringContaining('{asRole}') });
    expect(JSON.stringify(v)).not.toContain('94615');
  });

  it('without a ZIP code lists only nationwide and statewide offices; it needs a sign-in', async () => {
    await memberRecord(ada, null);
    await add(COUNTY);
    const v = await view(ada);
    expect(v.area.basis).toBe('no_zip');
    expect(v.contacts.every((c) => c.district.kind === 'state' || c.district.kind === 'nation')).toBe(true);
    expect((await api.call('GET', '/v1/candidacies/area/contacts')).status).toBe(401);
  });
});

describe('what Communications Admins enter', () => {
  it('shows people in the member’s districts, takes the place of a record’s entry for the same person, and is ledgered', async () => {
    const county = await add(COUNTY);
    expect(county.status).toBe(201);
    const record = county.body as AreaContactRecord;
    expect(record).toMatchObject({ name: 'Cora County', district: { kind: 'county', geoid: '06001', name: 'First County' }, version: 1 });
    await add({ ...COUNTY, districtId: '06003', name: 'Elsewhere Person' });
    await add({ role: 'holder', office: 'us_house', officeTitle: 'U.S. Representative', state: 'CA', districtId: '0601', name: 'hal  house', email: 'hal@house.example' });
    await add({ ...COUNTY, role: 'candidate', name: 'Past Runner', electionDate: '2020-11-03' });
    await add({ ...COUNTY, role: 'candidate', name: 'Next Runner', electionDate: '2030-11-05' });

    const v = await view(ada);
    expect(v.contacts.filter((c) => c.source === 'admin').map((c) => c.name)).toEqual(['Cora County', 'hal  house', 'Next Runner']);
    const house = v.contacts.filter((c) => c.office === 'us_house' && c.district.geoid === '0601' && c.role === 'holder');
    expect(house).toMatchObject([{ source: 'admin', email: 'hal@house.example' }]);

    const changed = await api.call('PUT', `/v1/admin/area-contacts/${record.contactId}`, comms, { contact: { ...COUNTY, name: 'Cora M. County' }, basedOn: 1 });
    expect(changed.body).toMatchObject({ name: 'Cora M. County', version: 2 });
    expect((await api.call('PUT', `/v1/admin/area-contacts/${record.contactId}`, comms, { contact: COUNTY, basedOn: 1 })).status).toBe(409);
    expect((await api.call('DELETE', `/v1/admin/area-contacts/${record.contactId}`, comms)).status).toBe(204);
    expect((await api.call('DELETE', `/v1/admin/area-contacts/${record.contactId}`, comms)).status).toBe(404);
    expect((await entries('area_contact.changed')).filter((e) => e.subject === record.contactId).map((e) => e.payload.change)).toEqual(['added', 'changed', 'removed']);
    expect(((await api.call('GET', '/v1/admin/area-contacts', comms)).body as AreaContactRecord[]).map((r) => r.name)).toEqual([
      'hal  house',
      'Next Runner',
      'Past Runner',
      'Elsewhere Person',
    ]);
  });

  it('must be in a district the Census lists; only Communications Admins enter people', async () => {
    const res = await add({ ...COUNTY, districtId: '06999' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toMatchObject([{ path: 'districtId' }]);
    expect((await add({ ...COUNTY, role: 'candidate' })).status).toBe(400);
    expect((await add(COUNTY, ada)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/area-contacts', ada)).status).toBe(403);
  });
});

describe('email templates', () => {
  it('start with the starting text; a saved one is what members get, ledgered for Auditors', async () => {
    const all = (await api.call('GET', '/v1/admin/email-templates', comms)).body as EmailTemplate[];
    expect(all.map((t) => [t.office, t.version])).toHaveLength(8);
    const saved = await api.call('PUT', '/v1/admin/email-templates/county', comms, { subject: 'Hello {name}', body: 'Dear {name}, {asRole}. {myName}', basedOn: 0 });
    expect(saved.body).toEqual({ office: 'county', subject: 'Hello {name}', body: 'Dear {name}, {asRole}. {myName}', version: 1 });
    expect((await view(ada)).templates.county).toMatchObject({ subject: 'Hello {name}', version: 1 });
    expect((await entries('email_template.changed')).map((e) => e.payload)).toMatchObject([{ office: 'county', version: 1 }]);
  });

  it('refuse an older version, an unknown placeholder, an unknown office and anyone else', async () => {
    const body = { subject: 'S', body: 'B', basedOn: 0 };
    await api.call('PUT', '/v1/admin/email-templates/us_house', comms, body);
    expect((await api.call('PUT', '/v1/admin/email-templates/us_house', comms, { ...body, body: 'C' })).status).toBe(409);
    const unknown = await api.call('PUT', '/v1/admin/email-templates/us_house', comms, { ...body, body: 'Dear {candidate}', basedOn: 1 });
    expect(unknown.status).toBe(400);
    expect(unknown.body.errors).toMatchObject([{ path: 'body' }]);
    expect((await api.call('PUT', '/v1/admin/email-templates/mayor', comms, body)).status).toBe(400);
    expect((await api.call('PUT', '/v1/admin/email-templates/county', ada, body)).status).toBe(403);
  });
});
