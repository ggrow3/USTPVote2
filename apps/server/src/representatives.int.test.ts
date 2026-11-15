import type { EmailTemplate, LedgerEntry, RepresentativesView } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AREA_LOOKUP_RATE, PublicRepresentativesController } from './candidacies/candidacies.controller.js';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

// DISTRICTS=local (testing/emulator.ts): a ZIP code is in the first district of each kind, and one ending in 5 in both
// congressional districts; one starting with 9 is in California, with 1 in New York; 00000 is nowhere.
// LocalContactSource gives made-up senators, a representative and state legislators, some with a phone number.

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
  api.app.get(PublicRepresentativesController).forget();
  const [sa1] = await api.systemAdmins();
  ada = await api.member('ada@example.test');
  comms = await api.member('comms@example.test');
  await api.grant(comms.accountId, 'communications_admin', sa1!);
  await api.firebase.db
    .collection('members')
    .doc(ada.accountId)
    .set({ accountId: ada.accountId, status: 'active', legalName: 'Ada Brooks', preferredName: null, state: 'CA', contact: { city: 'Oakland', postalCode: '94615', phone: null } });
});

const names = (v: RepresentativesView) => v.representatives.map((c) => `${c.source} ${c.office}@${c.district.geoid} ${c.name}`);
const lookUp = (zip: unknown, headers: Record<string, string> = {}) => api.call('POST', '/v1/public/representatives/area', undefined, { zip }, headers);
const enter = (body: Record<string, unknown>) =>
  api.call('POST', '/v1/admin/area-contacts', comms, { role: 'holder', office: 'county', officeTitle: 'County Supervisor', state: 'CA', districtId: '06001', ...body });

describe('the Representatives page (design §5.19)', () => {
  it('for a member: who holds each office in their own area, with phone numbers, accounts, emails and call scripts, and never their ZIP code', async () => {
    expect((await enter({ name: 'Cora County', phone: '510-555-0100' })).status).toBe(201);
    // Someone running, and an official of another county: neither is a representative here.
    await enter({ role: 'candidate', name: 'Rae Running', electionDate: '2030-11-05' });
    await enter({ districtId: '06003', name: 'Sam Second' });

    const res = await api.call('GET', '/v1/candidacies/area/representatives', ada);
    expect(res.status).toBe(200);
    const v = res.body as RepresentativesView;
    expect(v.area).toMatchObject({ state: 'CA', basis: 'zip' });
    expect(v.feeds).toEqual({ fec: 'off', congress: 'ok', openstates: 'ok', civic: 'off', sos: 'off' });
    expect(names(v)).toEqual([
      'congress us_senate@06 Sam Senator',
      'congress us_senate@06 Sky Senator',
      'congress us_house@0601 Hal House',
      'congress us_house@0602 Hal House',
      'openstates state_upper@06001 Uma Upper',
      'openstates state_lower@06001 Lou Lower',
      'admin county@06001 Cora County',
    ]);
    const hal = v.representatives.find((c) => c.name === 'Hal House')!;
    expect(hal).toMatchObject({ phone: '202-555-0149', contactUrl: 'https://house.example/contact', website: 'https://house.example' });
    expect(hal.social?.map((s) => s.network)).toEqual(['x', 'facebook', 'youtube']);
    expect(v.representatives.at(-1)).toMatchObject({ phone: '510-555-0100', email: null });
    expect(v.representatives.every((c) => c.role === 'holder')).toBe(true);
    expect(v.templates.map((t) => t.channel)).toEqual(['email', 'email', 'email', 'call', 'call']);
    expect(JSON.stringify(v)).not.toContain('94615');

    expect((await api.call('GET', '/v1/candidacies/area/representatives')).status).toBe(401);
  });

  it('for anyone, by a ZIP code: the same people, the communications team’s too; the ZIP code is checked, limited and not kept', async () => {
    await enter({ name: 'Cora County', phone: '510-555-0100' });
    const res = await lookUp('94601');
    expect(res.status).toBe(200);
    const v = res.body as RepresentativesView;
    expect(v.area).toMatchObject({ state: 'CA', basis: 'zip' });
    expect(names(v)).toEqual([
      'congress us_senate@06 Sam Senator',
      'congress us_senate@06 Sky Senator',
      'congress us_house@0601 Hal House',
      'openstates state_upper@06001 Uma Upper',
      'openstates state_lower@06001 Lou Lower',
      'admin county@06001 Cora County',
    ]);
    expect(v.templates.some((t) => t.channel === 'call')).toBe(true);
    expect(JSON.stringify(v)).not.toContain('94601');

    expect((await lookUp('9460')).status).toBe(400);
    expect((await lookUp('00000')).status).toBe(404);
    expect((await api.call('POST', '/v1/public/representatives/area', undefined, { zip: '94601', state: 'CA' })).status).toBe(400);

    // Each address may look up so many a minute; another address is counted apart.
    api.app.get(PublicRepresentativesController).forget();
    const from = { 'x-forwarded-for': '203.0.113.7' };
    for (let i = 0; i < AREA_LOOKUP_RATE.visits; i++) expect((await lookUp('94601', from)).status).toBe(200);
    expect((await lookUp('94601', from)).status).toBe(429);
    expect((await lookUp('94601', { 'x-forwarded-for': '203.0.113.8' })).status).toBe(200);
  });

  it('call scripts are kept with the email templates: added without a subject, ledgered, offered to the page', async () => {
    const script = { channel: 'call', name: 'Call about a bill', audience: 'holder', body: 'Hello, I am {myName}, calling {name} {asRole}.' };
    const added = await api.call('POST', '/v1/admin/email-templates', comms, script);
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ channel: 'call', subject: '', version: 1 });
    expect((await api.call('POST', '/v1/admin/email-templates', comms, { ...script, name: 'With a subject', subject: 'Hello' })).status).toBe(400);
    expect((await api.call('POST', '/v1/admin/email-templates', comms, { name: 'An email', body: 'Dear {name}' })).status).toBe(400);

    const v = (await lookUp('94601')).body as RepresentativesView;
    expect(v.templates.filter((t: EmailTemplate) => t.channel === 'call').map((t) => t.name)).toEqual([
      'Call to support research on aging',
      'Call to ask for a meeting',
      'Call about a bill',
    ]);
    const snap = await api.firebase.db.collection('audit_events').where('type', '==', 'email_template.changed').orderBy('seq').get();
    const ledgered = snap.docs.map((d) => d.data() as LedgerEntry);
    expect(ledgered.map((e) => [e.payload.change, e.payload.name])).toEqual([['added', 'Call about a bill']]);
  });
});
