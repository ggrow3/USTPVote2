import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

let admin: User & { accountId: string };
let bylaws: { version: string; contentHash: string };

const application = () => ({
  bylawsVersion: bylaws.version,
  bylawsHash: bylaws.contentHash,
  legalName: 'Robin Applicant',
  dateOfBirth: '1990-04-01',
  attestsAge: true,
  formVersion: 0,
  usVoteEligible: true,
  agreesWithCoreIdeals: true,
  state: 'CA',
  city: 'San Francisco',
  postalCode: '941101234',
  phone: '(555) 123-4567',
  statement: 'I want to help.',
  volunteer: true,
  newsletter: true,
});

/** An application from outside the US: the country, and none of the state, city and ZIP code a US one needs. */
const abroad = () => {
  const { state: _, city: __, postalCode: ___, ...rest } = application();
  return { ...rest, country: 'GB', region: 'Greater London', phone: '+44 20 7946 0958' };
};

beforeEach(async () => {
  await resetEmulators();
  const [sa1, sa2] = await api.systemAdmins();
  admin = await api.member('membership.admin@example.test');
  await api.grant(admin.accountId, 'membership_admin', sa1);
  const published = await api.call('POST', '/v1/admin/bylaws', admin, {
    version: '2026.1',
    title: 'USTP Bylaws',
    text: 'Article I. Name.\n',
  });
  expect(published.status).toBe(201);
  bylaws = published.body;
});

describe('bylaws', () => {
  it('publishes immutable versions with a content hash, readable without sign-in', async () => {
    const current = await api.call('GET', '/v1/bylaws/current');
    expect(current.body).toMatchObject({ version: '2026.1', contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const again = await api.call('POST', '/v1/admin/bylaws', admin, { version: '2026.1', title: 'x', text: 'y' });
    expect(again.status).toBe(409);
  });

  it('amends only the current version, and lists and serves every version', async () => {
    const amendment = { title: 'USTP Bylaws', text: 'Article I. Name.\nArticle II. Purpose.\n' };
    const unanchored = await api.call('POST', '/v1/admin/bylaws', admin, { ...amendment, version: '2026.2' });
    expect(unanchored).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/2026\.1 is the current/) } });

    const second = await api.call('POST', '/v1/admin/bylaws', admin, {
      ...amendment,
      version: '2026.2',
      amends: '2026.1',
      changeNote: 'Adds Article II.',
    });
    expect(second).toMatchObject({ status: 201, body: { version: '2026.2', amends: '2026.1', changeNote: 'Adds Article II.' } });
    const stale = await api.call('POST', '/v1/admin/bylaws', admin, { ...amendment, version: '2026.3', amends: '2026.1' });
    expect(stale.status).toBe(409);

    const list = await api.call('GET', '/v1/bylaws');
    expect(list.body.map((v: { version: string }) => v.version)).toEqual(['2026.2', '2026.1']);
    expect(list.body[0]).not.toHaveProperty('text');
    expect((await api.call('GET', '/v1/bylaws/2026.1')).body).toMatchObject({ version: '2026.1', text: 'Article I. Name.\n' });
    expect((await api.call('GET', '/v1/bylaws/current')).body.version).toBe('2026.2');
    expect((await api.call('GET', '/v1/bylaws/9999')).status).toBe(404);
  });

  it('clears the bylaws with a blank version, ledgered, after which applicants agree to none', async () => {
    const blank = { version: '2026.2', title: 'USTP Bylaws', text: '  \n', amends: '2026.1' };
    const cleared = await api.call('POST', '/v1/admin/bylaws', admin, blank);
    expect(cleared).toMatchObject({ status: 201, body: { version: '2026.2', text: '', amends: '2026.1' } });
    const published = await api.firebase.db.collection('audit_events').where('type', '==', 'bylaws.published').get();
    expect(published.docs.map((d) => d.data().payload.version).sort()).toEqual(['2026.1', '2026.2']);
    expect((await api.call('GET', '/v1/bylaws/current')).body).toMatchObject({ version: '2026.2', text: '' });
    // Already blank: nothing to clear.
    expect(await api.call('POST', '/v1/admin/bylaws', admin, { ...blank, version: '2026.3', amends: '2026.2' })).toMatchObject({
      status: 409,
      body: { detail: expect.stringMatching(/already blank/) },
    });

    const robin = await api.member('robin@example.test');
    // A page that still showed version 2026.1 is sent back to read the application again.
    expect(await api.call('POST', '/v1/registration/applications', robin, application())).toMatchObject({
      status: 409,
      body: { detail: expect.stringMatching(/none are in force/) },
    });
    const res = await api.call('POST', '/v1/registration/applications', robin, { ...application(), bylawsVersion: null, bylawsHash: null });
    expect(res).toMatchObject({ status: 201, body: { bylawsVersion: null, bylawsHash: null } });
    expect((await api.call('GET', '/v1/me', robin)).body.member).toMatchObject({ status: 'applicant', bylawsVersion: null });

    // Bylaws again: applicants agree to them once more, and an application agreeing to none is refused.
    const again = await api.call('POST', '/v1/admin/bylaws', admin, { version: '2026.3', title: 'USTP Bylaws', text: 'Article I. Name.\n', amends: '2026.2' });
    expect(again.status).toBe(201);
    const sam = await api.member('sam@example.test');
    expect(await api.call('POST', '/v1/registration/applications', sam, { ...application(), bylawsVersion: null, bylawsHash: null })).toMatchObject({
      status: 409,
      body: { detail: expect.stringMatching(/bylaws have changed/) },
    });
  });
});

describe('with no bylaws published', () => {
  it('takes an application agreeing to none', async () => {
    await resetEmulators();
    await api.systemAdmins();
    const robin = await api.member('robin@example.test');
    expect((await api.call('GET', '/v1/bylaws/current')).status).toBe(404);
    const res = await api.call('POST', '/v1/registration/applications', robin, { ...application(), bylawsVersion: null, bylawsHash: null });
    expect(res).toMatchObject({ status: 201, body: { status: 'pending', bylawsVersion: null } });
  });
});

describe('applications', () => {
  it('takes an application against the current bylaws, once', async () => {
    const robin = await api.member('robin@example.test');
    const stale = await api.call('POST', '/v1/registration/applications', robin, { ...application(), bylawsHash: '0'.repeat(64) });
    expect(stale).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/bylaws have changed/) } });

    const res = await api.call('POST', '/v1/registration/applications', robin, application());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'pending', bylawsHash: bylaws.contentHash, accountId: robin.accountId });
    expect((await api.call('GET', '/v1/me', robin)).body.member).toMatchObject({ status: 'applicant', state: 'CA' });
    expect((await api.call('POST', '/v1/registration/applications', robin, application())).status).toBe(409);
    expect((await api.call('GET', '/v1/registration/applications/me', robin)).body).toHaveLength(1);
  });

  it('keeps the full application for review but copies only contact and consent to the member', async () => {
    const robin = await api.member('robin@example.test');
    const { body: app } = await api.call('POST', '/v1/registration/applications', robin, application());
    expect(app).toMatchObject({
      dateOfBirth: '1990-04-01',
      attestations: { minimumAge: 18 },
      formVersion: 0,
      usVoteEligible: true,
      agreesWithCoreIdeals: true,
      contact: { city: 'San Francisco', postalCode: '94110-1234', phone: '+15551234567' },
      communications: { newsletter: app.submittedAt, announcements: null },
      volunteer: true,
      runForOffice: false,
    });
    const member = (await api.call('GET', '/v1/me', robin)).body.member;
    expect(member).toMatchObject({
      contact: app.contact,
      communications: app.communications,
      usVoteEligible: true,
      agreesWithCoreIdeals: true,
    });
    expect(member).not.toHaveProperty('dateOfBirth');
  });

  it('takes an application from outside the US without a state, city or ZIP code, and keeps the country', async () => {
    const robin = await api.member('robin@example.test');
    const res = await api.call('POST', '/v1/registration/applications', robin, abroad());
    expect(res.status).toBe(201);
    const place = {
      country: 'GB',
      state: null,
      region: 'Greater London',
      contact: { city: null, postalCode: null, phone: '+442079460958' },
    };
    expect(res.body).toMatchObject(place);
    expect((await api.call('GET', '/v1/me', robin)).body.member).toMatchObject({ status: 'applicant', ...place });
  });

  it('still needs the state, city and ZIP code of an applicant in the US, the country they get when none is given', async () => {
    const robin = await api.member('robin@example.test');
    const { state: _, city: __, postalCode: ___, ...nowhere } = application();
    const res = await api.call('POST', '/v1/registration/applications', robin, { ...nowhere, country: 'US' });
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual(['state', 'city', 'postalCode']);
    const unknown = await api.call('POST', '/v1/registration/applications', robin, { ...application(), country: 'ZZ' });
    expect(unknown).toMatchObject({ status: 400, body: { errors: [{ path: 'country', message: 'choose your country' }] } });

    const { body: app } = await api.call('POST', '/v1/registration/applications', robin, application());
    expect(app).toMatchObject({ country: 'US', state: 'CA', region: null });
  });

  it('records the one Staying in touch box as both opt-ins, or as neither when it is unticked', async () => {
    const robin = await api.member('robin@example.test');
    const ticked = await api.call('POST', '/v1/registration/applications', robin, { ...application(), announcements: true });
    expect(ticked.body.communications).toEqual({ newsletter: ticked.body.submittedAt, announcements: ticked.body.submittedAt });

    const sam = await api.member('sam@example.test');
    const unticked = await api.call('POST', '/v1/registration/applications', sam, { ...abroad(), newsletter: false, announcements: false });
    expect(unticked.body.communications).toEqual({ newsletter: null, announcements: null });
    expect((await api.call('GET', '/v1/me', sam)).body.member.communications).toEqual({ newsletter: null, announcements: null });
  });

  it('refuses applicants under the minimum age, a missing attestation and an unanswered question', async () => {
    const robin = await api.member('robin@example.test');
    const young = `${new Date().getUTCFullYear() - 16}-01-01`;
    const tooYoung = await api.call('POST', '/v1/registration/applications', robin, { ...application(), dateOfBirth: young });
    expect(tooYoung.status).toBe(400);
    const unattested = await api.call('POST', '/v1/registration/applications', robin, { ...application(), attestsAge: false });
    expect(unattested.status).toBe(400);
    const { usVoteEligible: _, ...unanswered } = application();
    const res = await api.call('POST', '/v1/registration/applications', robin, unanswered);
    expect(res).toMatchObject({ status: 400, body: { errors: [{ path: 'usVoteEligible', message: 'answer Yes or No' }] } });
  });

  it('takes No to both membership questions, making an Allied Member who can be admitted', async () => {
    const robin = await api.member('robin@example.test');
    const res = await api.call('POST', '/v1/registration/applications', robin, {
      ...application(),
      usVoteEligible: false,
      agreesWithCoreIdeals: false,
    });
    expect(res).toMatchObject({ status: 201, body: { usVoteEligible: false, agreesWithCoreIdeals: false } });
    const approved = await api.call('POST', `/v1/admin/applications/${res.body.applicationId}/decision`, admin, {
      decision: 'approve',
      reason: 'Welcome',
    });
    expect(approved.status).toBe(201);
    expect((await api.call('GET', '/v1/me', robin)).body.member).toMatchObject({
      status: 'active',
      usVoteEligible: false,
      agreesWithCoreIdeals: false,
    });
  });

  it('caps applications per account', async () => {
    const robin = await api.member('robin@example.test');
    for (let i = 0; i < 3; i++) {
      const { body: app } = await api.call('POST', '/v1/registration/applications', robin, application());
      const rejected = await api.call('POST', `/v1/admin/applications/${app.applicationId}/decision`, admin, {
        decision: 'reject',
        reason: 'incomplete',
      });
      expect(rejected.body).toMatchObject({ status: 'rejected' });
    }
    const fourth = await api.call('POST', '/v1/registration/applications', robin, application());
    expect(fourth).toMatchObject({ status: 429, body: { detail: expect.stringMatching(/at most 3 applications/) } });
  });

  it('requires a verified email and an account', async () => {
    const unverified = await api.user('unverified@example.test', { emailVerified: false });
    expect((await api.call('POST', '/v1/accounts', unverified)).status).toBe(201);
    expect((await api.call('POST', '/v1/registration/applications', unverified, application())).status).toBe(403);
    const noAccount = await api.user('noaccount@example.test');
    expect((await api.call('POST', '/v1/registration/applications', noAccount, application())).status).toBe(403);
  });

  it('is decided by a Membership Admin with a written reason', async () => {
    const robin = await api.member('robin@example.test');
    const { body: app } = await api.call('POST', '/v1/registration/applications', robin, application());

    expect((await api.call('GET', '/v1/admin/applications', robin)).status).toBe(403);
    const pending = await api.call('GET', '/v1/admin/applications?status=pending', admin);
    expect(pending.body.map((a: { applicationId: string }) => a.applicationId)).toEqual([app.applicationId]);

    const noReason = await api.call('POST', `/v1/admin/applications/${app.applicationId}/decision`, admin, { decision: 'approve' });
    expect(noReason.status).toBe(400);
    const approved = await api.call('POST', `/v1/admin/applications/${app.applicationId}/decision`, admin, {
      decision: 'approve',
      reason: 'Meets membership criteria',
    });
    expect(approved.body).toMatchObject({ status: 'approved', decidedBy: admin.accountId });
    const twice = await api.call('POST', `/v1/admin/applications/${app.applicationId}/decision`, admin, {
      decision: 'reject',
      reason: 'changed my mind',
    });
    expect(twice.status).toBe(409);

    const member = (await api.call('GET', '/v1/me', robin)).body.member;
    expect(member).toMatchObject({ status: 'active', memberSince: expect.any(String) });
  });

  it('does not let an admin decide their own application', async () => {
    const { body: app } = await api.call('POST', '/v1/registration/applications', admin, application());
    const res = await api.call('POST', `/v1/admin/applications/${app.applicationId}/decision`, admin, {
      decision: 'approve',
      reason: 'self',
    });
    expect(res.status).toBe(403);
  });
});

describe('member status', () => {
  async function activeMember() {
    const robin = await api.member('robin@example.test');
    const { body: app } = await api.call('POST', '/v1/registration/applications', robin, application());
    await api.call('POST', `/v1/admin/applications/${app.applicationId}/decision`, admin, { decision: 'approve', reason: 'ok' });
    return robin;
  }

  it('follows the state machine, with history linked to the ledger', async () => {
    const robin = await activeMember();
    const suspend = await api.call('POST', `/v1/admin/members/${robin.accountId}/status`, admin, {
      to: 'suspended',
      reason: 'Code of conduct review',
    });
    expect(suspend.body.status).toBe('suspended');
    const bad = await api.call('POST', `/v1/admin/members/${robin.accountId}/status`, admin, { to: 'lapsed', reason: 'x' });
    expect(bad.status).toBe(409);

    expect((await api.call('POST', '/v1/me/resign', robin, {})).body.status).toBe('resigned');
    expect((await api.call('POST', '/v1/registration/applications', robin, application())).status).toBe(201);

    const history = (await api.call('GET', `/v1/admin/members/${robin.accountId}/history`, admin)).body;
    expect(history.map((h: { from: string | null; to: string }) => `${h.from}→${h.to}`)).toEqual([
      'resigned→applicant',
      'suspended→resigned',
      'active→suspended',
      'applicant→active',
      'null→applicant',
    ]);
    expect(history.every((h: { ledgerSeq: number }) => Number.isInteger(h.ledgerSeq))).toBe(true);
  });

  it('keeps admins from changing their own status', async () => {
    const res = await api.call('POST', `/v1/admin/members/${admin.accountId}/status`, admin, { to: 'suspended', reason: 'x' });
    expect(res.status).toBe(403);
  });

  it('lists members by status with paging', async () => {
    const robin = await activeMember();
    const list = await api.call('GET', '/v1/admin/members?status=active&limit=10', admin);
    expect(list.body.map((m: { accountId: string }) => m.accountId)).toEqual([robin.accountId]);
    expect((await api.call('GET', '/v1/admin/members?status=bogus', admin)).status).toBe(400);
  });
});

describe('member profiles and details', () => {
  async function activeMember() {
    const robin = await api.member('robin@example.test');
    const { body: app } = await api.call('POST', '/v1/registration/applications', robin, application());
    await api.call('POST', `/v1/admin/applications/${app.applicationId}/decision`, admin, { decision: 'approve', reason: 'ok' });
    return robin;
  }
  const lastEntry = async () =>
    (await api.firebase.db.collection('audit_events').orderBy('seq', 'desc').limit(1).get()).docs[0]!.data();
  const where = { state: 'OR', city: 'Portland', postalCode: '97201', phone: '' };

  it('shows a Membership Admin one member: the record, every application with its answers, and the history', async () => {
    const robin = await activeMember();
    const res = await api.call('GET', `/v1/admin/members/${robin.accountId}`, admin);
    expect(res.status).toBe(200);
    expect(res.body.member).toMatchObject({ accountId: robin.accountId, status: 'active', legalName: 'Robin Applicant' });
    expect(res.body.applications).toHaveLength(1);
    expect(res.body.applications[0]).toMatchObject({
      status: 'approved',
      dateOfBirth: '1990-04-01',
      statement: 'I want to help.',
      volunteer: true,
      decisionReason: 'ok',
    });
    expect(res.body.history.map((h: { to: string }) => h.to)).toEqual(['active', 'applicant']);

    expect((await api.call('GET', `/v1/admin/members/${robin.accountId}`, robin)).status).toBe(403);
    expect((await api.call('GET', `/v1/admin/members/${admin.accountId}`, admin)).status).toBe(404);
  });

  it('shows a Membership Admin whether the member turned the daily quote and joke on', async () => {
    const robin = await activeMember();
    const profile = () => api.call('GET', `/v1/admin/members/${robin.accountId}`, admin);
    expect((await profile()).body.preferences).toEqual({ dailyQuote: false });
    expect((await api.call('PUT', '/v1/me/preferences', robin, { dailyQuote: true })).status).toBe(200);
    expect((await profile()).body.preferences).toEqual({ dailyQuote: true });
  });

  it('lets members change their own details and email opt-ins, ledgered by field name only', async () => {
    const robin = await activeMember();
    const res = await api.call('POST', '/v1/me/details', robin, { preferredName: 'Rob', ...where, newsletter: false, announcements: true });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      legalName: 'Robin Applicant',
      preferredName: 'Rob',
      state: 'OR',
      contact: { city: 'Portland', postalCode: '97201', phone: null },
      communications: { newsletter: null, announcements: expect.any(String) },
    });
    const entry = await lastEntry();
    expect(entry).toMatchObject({ type: 'member.details_changed', actor: robin.accountId, subject: robin.accountId });
    expect(entry.payload).toEqual({
      fields: ['preferredName', 'state', 'contact.city', 'contact.postalCode', 'contact.phone', 'communications.newsletter', 'communications.announcements'],
      reason: null,
    });
    expect(JSON.stringify(entry)).not.toContain('Portland');

    const moved = await api.call('POST', '/v1/me/details', robin, {
      preferredName: 'Rob',
      country: 'DE',
      region: 'Berlin',
      newsletter: false,
      announcements: true,
    });
    expect(moved.status).toBe(201);
    expect(moved.body).toMatchObject({ country: 'DE', state: null, region: 'Berlin', contact: { city: null, postalCode: null } });
    expect((await lastEntry()).payload.fields).toEqual(['country', 'state', 'region', 'contact.city', 'contact.postalCode']);
    const back = await api.call('POST', '/v1/me/details', robin, { preferredName: 'Rob', ...where, newsletter: false, announcements: true });
    expect(back.body).toMatchObject({ country: 'US', state: 'OR', region: null });

    const same = await api.call('POST', '/v1/me/details', robin, { preferredName: 'Rob', ...where, newsletter: false, announcements: true });
    expect(same.status).toBe(409);
    const legal = await api.call('POST', '/v1/me/details', robin, { ...where, legalName: 'Someone Else', newsletter: false, announcements: false });
    expect(legal.status).toBe(400);
    const nobody = await api.member('nobody@example.test');
    expect((await api.call('POST', '/v1/me/details', nobody, { ...where, newsletter: false, announcements: false })).status).toBe(404);
  });

  it('lets another Membership Admin correct names and contact details with a reason, never the opt-ins', async () => {
    const robin = await activeMember();
    const correction = { legalName: 'Robin Q. Applicant', ...where, reason: 'Typo in the application' };
    const res = await api.call('POST', `/v1/admin/members/${robin.accountId}/details`, admin, correction);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ legalName: 'Robin Q. Applicant', state: 'OR', communications: { newsletter: expect.any(String) } });
    expect((await lastEntry()).payload).toEqual({
      fields: ['legalName', 'state', 'contact.city', 'contact.postalCode', 'contact.phone'],
      reason: 'Typo in the application',
    });

    const path = `/v1/admin/members/${robin.accountId}/details`;
    expect((await api.call('POST', path, admin, { ...correction, reason: ' ' })).status).toBe(400);
    expect((await api.call('POST', path, admin, { ...correction, newsletter: false })).status).toBe(400);
    expect((await api.call('POST', path, robin, correction)).status).toBe(403);
    expect((await api.call('POST', `/v1/admin/members/${admin.accountId}/details`, admin, correction)).status).toBe(403);
  });
});

describe('the applications queue', () => {
  it('tells Membership Admins how many wait and since when, and nobody else', async () => {
    const summary = () => api.call('GET', '/v1/admin/applications/summary', admin);
    expect((await summary()).body).toEqual({ pending: 0, oldestSubmittedAt: null });

    const first = await api.member('first@example.test');
    const second = await api.member('second@example.test');
    const one = await api.call('POST', '/v1/registration/applications', first, application());
    expect((await api.call('POST', '/v1/registration/applications', second, application())).status).toBe(201);
    expect((await summary()).body).toEqual({ pending: 2, oldestSubmittedAt: one.body.submittedAt });

    const decided = await api.call('POST', `/v1/admin/applications/${one.body.applicationId}/decision`, admin, { decision: 'approve', reason: 'reviewed' });
    expect(decided.status).toBe(201);
    expect((await summary()).body).toMatchObject({ pending: 1 });

    expect((await api.call('GET', '/v1/admin/applications/summary', second)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/applications/summary')).status).toBe(401);
  });
});
