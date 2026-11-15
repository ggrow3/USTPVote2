import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

/**
 * A Site Admin does what every other role but System Admin does, without being granted it (design §10.1), deciding
 * two-person requests included, though never their own (§10.2).
 */
let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;
let site: Member;
let site2: Member;
let auditor: Member;
let ea: Member;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const decide = (by: User, id: string, decision: 'approve' | 'reject' = 'approve') =>
  api.call('POST', `/v1/admin/approvals/${id}/decision`, by, { decision, reason: 'reviewed' });
const draft = async (by: User) =>
  (await api.call('POST', '/v1/admin/elections', by, { title: 'Officers', secrecy: 'secret', opensAt: inDays(10), closesAt: inDays(17) })).body
    .electionId as string;

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  site = await api.member('site@example.test');
  site2 = await api.member('site2@example.test');
  auditor = await api.member('auditor@example.test');
  ea = await api.member('election.admin@example.test');
  await api.grant(site.accountId, 'site_admin', sa1);
  await api.grant(site2.accountId, 'site_admin', sa1);
  await api.grant(auditor.accountId, 'auditor', sa1);
  await api.grant(ea.accountId, 'election_admin', sa1);
  const voter = await api.member('v1@example.test');
  await api.firebase.db.collection('members').doc(voter.accountId).set({
    accountId: voter.accountId,
    status: 'active',
    legalName: voter.email,
    preferredName: null,
    state: 'CA',
    bylawsVersion: '2026.1',
    memberSince: new Date().toISOString(),
    statusChangedAt: new Date().toISOString(),
  });
});

describe('a Site Admin', () => {
  it("uses every other role's routes while holding Site Admin alone", async () => {
    expect((await api.call('GET', '/v1/me', site)).body.roles).toEqual(['site_admin']);
    for (const path of [
      '/v1/admin/applications?status=pending', // Membership Admin
      '/v1/admin/inbox/team',
      '/v1/admin/elections', // Election Admin, Auditor
      '/v1/admin/audit/verify', // Auditor
      '/v1/admin/courses/transhumanism', // Course Administrator
      '/v1/admin/communications/calendar', // Communications Admin
      '/v1/admin/accounts', // their own
    ]) {
      expect((await api.call('GET', path, site)).status, path).toBe(200);
    }
    expect((await api.call('POST', '/v1/admin/elections', site, { title: 'Officers', secrecy: 'secret', opensAt: inDays(10), closesAt: inDays(17) })).status).toBe(201);
    expect((await api.call('POST', '/v1/admin/courses', site, { title: 'Futures Lab', summary: 'Hands-on.' })).status).toBe(201);
  });

  it('gives nobody else a role they do not hold', async () => {
    expect(await api.call('GET', '/v1/admin/audit/verify', ea)).toMatchObject({ status: 403, body: { detail: 'requires role auditor' } });
    expect((await api.call('GET', '/v1/admin/applications?status=pending', ea)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/elections', ea)).status).toBe(200);
  });

  it("stays out of System Admins' own tools", async () => {
    for (const path of ['/v1/admin/sign-in-methods', '/v1/admin/api-keys', '/v1/admin/mfa-policy']) {
      expect((await api.call('GET', path, site)).status, path).toBe(403);
    }
    expect(await api.call('POST', `/v1/admin/accounts/${ea.accountId}/delete`, site, { reason: 'test' })).toMatchObject({
      status: 403,
      body: { detail: 'requires role system_admin' },
    });
    expect(await api.call('POST', '/v1/admin/roles', site, { accountId: ea.accountId, role: 'system_admin', change: 'grant', reason: 'test' })).toMatchObject({
      status: 403,
      body: { detail: 'system_admin is granted and revoked only by a system_admin' },
    });
  });

  it('requests a two-person action, which another Site Admin or an Auditor decides, never the requester', async () => {
    const url = `/v1/admin/elections/${await draft(site)}`;
    const roll = await api.call('POST', `${url}/roll`, site, { reason: 'roll for 2026' });
    expect(roll).toMatchObject({ status: 201, body: { status: 'pending', count: 1 } });
    const id = roll.body.approvalId as string;

    expect(await decide(site, id)).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/different person/) } });
    expect(await decide(site, id, 'reject')).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/different person/) } });
    expect((await api.call('GET', url, site)).body.roll.status).toBe('pending');

    // Another Site Admin decides it, as an Auditor would, and the ledger names them.
    expect((await decide(site2, id)).body).toMatchObject({ status: 'executed', decidedBy: site2.accountId });
    expect((await api.call('GET', url, site)).body.roll.status).toBe('approved');
    const decided = await api.firebase.db.collection('audit_events').where('type', '==', 'approval.decided').get();
    expect(decided.docs.map((d) => d.data().actor)).toEqual([site2.accountId]);

    // An Auditor decides a Site Admin's request, and a Site Admin an Election Admin's.
    const second = await api.call('POST', `/v1/admin/elections/${await draft(site)}/roll`, site, { reason: 'roll' });
    expect((await decide(auditor, second.body.approvalId)).body.status).toBe('executed');
    const third = await api.call('POST', `/v1/admin/elections/${await draft(ea)}/roll`, ea, { reason: 'roll' });
    expect(await decide(ea, third.body.approvalId)).toMatchObject({ status: 403 });
    expect((await decide(site, third.body.approvalId, 'reject')).body.status).toBe('rejected');
  });

  it('can be given the membership inbox’s conversations and the social calendar’s items', async () => {
    const names = async (path: string) => ((await api.call('GET', path, site)).body as { accountId: string }[]).map((m) => m.accountId).sort();
    const both = [site.accountId, site2.accountId].sort();
    expect(await names('/v1/admin/inbox/team')).toEqual(both);
    expect(await names('/v1/admin/communications/team')).toEqual(both);
  });
});
