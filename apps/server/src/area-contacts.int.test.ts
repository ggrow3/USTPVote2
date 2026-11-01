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
    expect(v.feeds).toEqual({ fec: 'ok', congress: 'ok', openstates: 'ok', civic: 'ok', sos: 'ok' });
    expect(v.profiles).toBe('ok');
    expect(v.electionYear % 2).toBe(0);
    expect(v.notUp).toEqual([]);
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
      'civic candidate state_upper@06001 Uma Upper',
      'civic candidate state_upper@06001 Bea Ballot',
      'sos candidate statewide@06 Gil Governor',
      'sos candidate statewide@06 Rita Rival',
      'sos candidate state_lower@06001 Lou Lower',
      'sos candidate state_lower@06001 Ana Assembly',
    ]);
    // The ballot adds the challenger's website and a State Senate race; a school board is listed apart.
    expect(v.contacts.find((c) => c.contactId === 'fec:C0601')).toMatchObject({ website: 'https://cass.example', election: expect.stringMatching(/-11-03$/) });
    expect(v.ballot.map((b) => [b.office, b.district, b.candidates.map((c) => c.name)])).toEqual([
      ['Governing Board Member', 'Example Unified School District, Trustee Area 2', ['Sal School']],
    ]);
    // Wikidata's stand-in knows the representative, in office and running.
    const hal = v.contacts.filter((c) => c.name === 'Hal House' && c.district.geoid === '0601');
    expect(hal.map((c) => [c.role, c.profile?.positions.length, c.photo?.credit])).toEqual([
      ['holder', 2, 'Photo: Example Photographer, CC BY-SA 4.0'],
      ['candidate', 2, 'Photo: Example Photographer, CC BY-SA 4.0'],
    ]);
    expect(v.templates.map((t) => [t.templateId, t.version])).toEqual([
      ['starting-stance', 0],
      ['starting-meeting', 0],
      ['starting-questions', 0],
    ]);
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
  let memb: Member;
  beforeEach(async () => {
    memb = await api.member('memb@example.test');
    await api.grant(memb.accountId, 'membership_admin', sa1);
  });

  const TEMPLATE = { name: 'Invite to a forum', offices: ['county'], audience: 'holder', subject: 'Hello {name}', body: 'Dear {name}, {asRole}. {myName}' };
  const list = async (by: User = comms) => (await api.call('GET', '/v1/admin/email-templates', by)).body as EmailTemplate[];

  it('start with three ready-made ones; Membership and Communications Admins both add, change and remove them, ledgered', async () => {
    expect((await list(memb)).map((t) => t.name)).toEqual(['Where they stand on longevity and science', 'Ask for a meeting', 'Questions for a candidate']);

    const added = await api.call('POST', '/v1/admin/email-templates', memb, TEMPLATE);
    expect(added.status).toBe(201);
    const template = added.body as EmailTemplate;
    expect(template).toMatchObject({ ...TEMPLATE, version: 1 });
    const changed = await api.call('PUT', `/v1/admin/email-templates/${template.templateId}`, comms, { template: { ...TEMPLATE, offices: ['local', 'county'] }, basedOn: 1 });
    expect(changed.body).toMatchObject({ templateId: template.templateId, offices: ['county', 'local'], version: 2 });
    expect((await api.call('PUT', '/v1/admin/email-templates/starting-meeting', memb, { template: { ...TEMPLATE, name: 'Meet us' }, basedOn: 0 })).status).toBe(200);

    // Members get the list in its order, and the page offers each person those that suit them.
    expect((await view(ada)).templates.map((t) => [t.name, t.version])).toEqual([
      ['Where they stand on longevity and science', 0],
      ['Meet us', 1],
      ['Questions for a candidate', 0],
      ['Invite to a forum', 2],
    ]);

    expect((await api.call('DELETE', '/v1/admin/email-templates/starting-questions', comms)).status).toBe(204);
    expect((await api.call('DELETE', '/v1/admin/email-templates/starting-questions', memb)).status).toBe(404);
    expect((await list()).map((t) => t.name)).toEqual(['Where they stand on longevity and science', 'Meet us', 'Invite to a forum']);

    const ledgered = await entries('email_template.changed');
    expect(ledgered.map((e) => [e.actor, e.payload.change, e.payload.version])).toEqual([
      [memb.accountId, 'added', 1],
      [comms.accountId, 'changed', 2],
      [memb.accountId, 'changed', 1],
      [comms.accountId, 'removed', 0],
    ]);
    expect(ledgered[0]!.payload.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuse an older version, an unknown placeholder, a name in use, an unknown template and anyone else', async () => {
    const template = (await api.call('POST', '/v1/admin/email-templates', comms, TEMPLATE)).body as EmailTemplate;
    const put = (body: unknown, id = template.templateId, by: User = comms) => api.call('PUT', `/v1/admin/email-templates/${id}`, by, body);
    expect((await put({ template: TEMPLATE, basedOn: 1 })).status).toBe(409);
    expect((await put({ template: { ...TEMPLATE, body: 'C' }, basedOn: 0 })).status).toBe(409);
    const unknown = await put({ template: { ...TEMPLATE, body: 'Dear {candidate}' }, basedOn: 1 });
    expect(unknown.status).toBe(400);
    expect(unknown.body.errors).toMatchObject([{ path: 'template.body' }]);
    expect((await api.call('POST', '/v1/admin/email-templates', memb, { ...TEMPLATE, name: 'invite to a FORUM' })).status).toBe(409);
    expect((await put({ template: TEMPLATE, basedOn: 0 }, 'no-such-template')).status).toBe(404);

    const election = await api.member('election@example.test');
    await api.grant(election.accountId, 'election_admin', sa1);
    for (const by of [ada, election, sa1]) {
      expect((await api.call('GET', '/v1/admin/email-templates', by)).status).toBe(403);
      expect((await api.call('POST', '/v1/admin/email-templates', by, { ...TEMPLATE, name: 'Other' })).status).toBe(403);
      expect((await put({ template: { ...TEMPLATE, body: 'D' }, basedOn: 1 }, template.templateId, by)).status).toBe(403);
      expect((await api.call('DELETE', `/v1/admin/email-templates/${template.templateId}`, by)).status).toBe(403);
    }
    expect((await list()).map((t) => t.version)).toEqual([0, 0, 0, 1]);
  });
});
