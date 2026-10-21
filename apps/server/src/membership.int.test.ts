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
  state: 'CA',
  statement: 'I want to help.',
});

beforeEach(async () => {
  await resetEmulators();
  const [sa1, sa2] = await api.systemAdmins();
  admin = await api.member('membership.admin@example.test');
  await api.grant(admin.accountId, 'membership_admin', sa1, sa2);
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
