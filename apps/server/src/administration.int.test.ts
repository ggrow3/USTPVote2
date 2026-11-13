import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalsService } from './administration/approvals.service.js';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;
let sa2: Member;
let pat: Member;

beforeEach(async () => {
  await resetEmulators();
  [sa1, sa2] = await api.systemAdmins();
  pat = await api.member('pat@example.test');
});

const changeRole = (by: User, accountId: string, role: string, change = 'grant') =>
  api.call('POST', '/v1/admin/roles', by, { accountId, role, change, reason: 'staffing' });
const decide = (by: User, id: string, decision: 'approve' | 'reject') =>
  api.call('POST', `/v1/admin/approvals/${id}/decision`, by, { decision, reason: 'reviewed' });
const rolesOf = async (m: Member) => (await api.call('GET', '/v1/me', m)).body.roles;

describe('role changes (one System Admin)', () => {
  it('take effect at once, with no approval request, and are ledgered with the admin as actor', async () => {
    const res = await changeRole(sa1, pat.accountId, 'auditor');
    expect(res).toMatchObject({ status: 201, body: { accountId: pat.accountId, roles: ['auditor'] } });
    expect(await rolesOf(pat)).toEqual(['auditor']);
    expect((await api.call('GET', '/v1/admin/approvals', sa2)).body).toEqual([]);

    const assignment = (await api.firebase.db.collection('role_assignments').doc(`${pat.accountId}_auditor`).get()).data();
    expect(assignment).toMatchObject({ grantedBy: sa1.accountId, approvedBy: null, approvalId: null, revokedAt: null });
    const events = (await api.firebase.db.collection('audit_events').orderBy('seq').get()).docs.map((d) => d.data());
    expect(events.map((e) => e.type)).toEqual(['role.granted', 'role.granted', 'role.granted']); // bootstrap ×2, then this
    expect(events[2]).toMatchObject({ actor: sa1.accountId, subject: pat.accountId, payload: { role: 'auditor', reason: 'staffing' } });
  });

  it('revoke the same way', async () => {
    await api.grant(pat.accountId, 'election_admin', sa1);
    await api.grant(pat.accountId, 'membership_admin', sa1);
    const res = await changeRole(sa2, pat.accountId, 'election_admin', 'revoke');
    expect(res.body).toEqual({ accountId: pat.accountId, roles: ['membership_admin'] });
    expect(await rolesOf(pat)).toEqual(['membership_admin']);
    const assignment = (await api.firebase.db.collection('role_assignments').doc(`${pat.accountId}_election_admin`).get()).data();
    expect(assignment).toMatchObject({ revokedBy: sa2.accountId, revokedAt: expect.any(String) });
  });

  it('let one System Admin grant and revoke System Admin too', async () => {
    await api.grant(pat.accountId, 'system_admin', sa1);
    expect(await rolesOf(pat)).toEqual(['system_admin']);
    expect((await changeRole(pat, sa2.accountId, 'system_admin', 'revoke')).status).toBe(201);
    expect(await rolesOf(sa2)).toEqual([]);
    expect((await changeRole(sa2, pat.accountId, 'system_admin', 'revoke')).status).toBe(403);
  });

  it('refuse incompatible roles, duplicate grants, unknown accounts, and changes to your own roles', async () => {
    await api.grant(pat.accountId, 'auditor', sa1);
    expect((await changeRole(sa1, pat.accountId, 'election_admin')).body.detail).toMatch(/cannot be held together/);
    expect((await changeRole(sa1, pat.accountId, 'auditor')).body.detail).toMatch(/already holds/);
    expect((await changeRole(sa1, pat.accountId, 'election_admin', 'revoke')).body.detail).toMatch(/does not hold/);
    expect((await changeRole(sa1, '01890000-0000-7000-8000-000000000000', 'auditor')).status).toBe(404);
    expect(await changeRole(sa1, sa1.accountId, 'membership_admin')).toMatchObject({
      status: 403,
      body: { detail: expect.stringMatching(/own account/) },
    });
    expect((await changeRole(sa1, sa1.accountId, 'system_admin', 'revoke')).status).toBe(403);
    expect((await changeRole(pat, sa1.accountId, 'membership_admin')).status).toBe(403);
    expect(await rolesOf(sa1)).toEqual(['system_admin']);
  });

  it('refuse a third role, and allow it again once one is revoked', async () => {
    await api.grant(pat.accountId, 'membership_admin', sa1);
    await api.grant(pat.accountId, 'election_admin', sa1);
    expect(await changeRole(sa1, pat.accountId, 'system_admin')).toMatchObject({
      status: 409,
      body: { detail: 'an account may hold at most 2 roles, and this one already holds election_admin and membership_admin' },
    });
    expect(await rolesOf(pat)).toEqual(['election_admin', 'membership_admin']);

    expect((await changeRole(sa2, pat.accountId, 'membership_admin', 'revoke')).status).toBe(201);
    expect(await changeRole(sa1, pat.accountId, 'system_admin')).toMatchObject({
      status: 201,
      body: { roles: ['election_admin', 'system_admin'] },
    });
  });

  it('still decide role requests made while role changes were two-person', async () => {
    const approvals = api.app.get(ApprovalsService);
    const pending = (role: string) =>
      api.firebase.db.runTransaction((tx) =>
        approvals.createRequest(tx, {
          action: 'role.grant',
          subject: pat.accountId,
          payload: { accountId: pat.accountId, role, change: 'grant' },
          reason: 'made before the change',
          requestedBy: sa1.accountId,
        }),
      );
    const old = await pending('election_admin');
    expect((await decide(sa1, old.id, 'approve')).body.detail).toMatch(/different person/);
    expect((await decide(sa2, old.id, 'approve')).body).toMatchObject({ status: 'executed', decidedBy: sa2.accountId });
    expect(await rolesOf(pat)).toEqual(['election_admin']);
    const assignment = (await api.firebase.db.collection('role_assignments').doc(`${pat.accountId}_election_admin`).get()).data();
    expect(assignment).toMatchObject({ grantedBy: sa1.accountId, approvedBy: sa2.accountId, approvalId: old.id });

    const rejected = await pending('membership_admin');
    expect((await decide(sa2, rejected.id, 'reject')).body.status).toBe('rejected');
    expect(await rolesOf(pat)).toEqual(['election_admin']);
  });
});

describe('role changes by a Site Admin', () => {
  let site: Member;
  let kim: Member;

  beforeEach(async () => {
    site = await api.member('site@example.test');
    kim = await api.member('kim@example.test');
    await api.grant(site.accountId, 'site_admin', sa1);
  });

  it('take effect at once for every role but System Admin, Site Admin included, ledgered with the Site Admin as actor', async () => {
    expect(await changeRole(site, pat.accountId, 'membership_admin')).toMatchObject({ status: 201, body: { roles: ['membership_admin'] } });
    expect(await changeRole(site, kim.accountId, 'site_admin')).toMatchObject({ status: 201, body: { roles: ['site_admin'] } });
    expect((await changeRole(site, kim.accountId, 'site_admin', 'revoke')).status).toBe(201);
    expect((await changeRole(site, pat.accountId, 'membership_admin', 'revoke')).status).toBe(201);
    expect((await changeRole(site, pat.accountId, 'auditor')).status).toBe(201);
    expect(await rolesOf(pat)).toEqual(['auditor']);
    const last = (await api.firebase.db.collection('audit_events').orderBy('seq', 'desc').limit(1).get()).docs[0]!.data();
    expect(last).toMatchObject({ type: 'role.granted', actor: site.accountId, subject: pat.accountId, payload: { role: 'auditor', reason: 'staffing' } });
  });

  it('refuse System Admin and a System Admin’s roles (403), the rules every grant keeps (409), and their own roles', async () => {
    expect(await changeRole(site, pat.accountId, 'system_admin')).toMatchObject({
      status: 403,
      body: { detail: 'system_admin is granted and revoked only by a system_admin' },
    });
    expect((await changeRole(site, sa2.accountId, 'system_admin', 'revoke')).status).toBe(403);
    // The account ID alone says nothing about its roles: the API reads them inside the change.
    expect(await changeRole(site, sa2.accountId, 'membership_admin')).toMatchObject({
      status: 403,
      body: { detail: 'the roles of a system_admin are changed only by a system_admin' },
    });
    expect(await rolesOf(sa2)).toEqual(['system_admin']);
    expect(await changeRole(site, site.accountId, 'site_admin', 'revoke')).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/own account/) } });

    await api.grant(pat.accountId, 'auditor', sa1);
    expect(await changeRole(site, pat.accountId, 'site_admin')).toMatchObject({ status: 409, body: { detail: /cannot be held together/ } });
    expect(await changeRole(sa1, site.accountId, 'system_admin')).toMatchObject({
      status: 409,
      body: { detail: 'system_admin cannot be held together with site_admin' },
    });
    await api.grant(kim.accountId, 'membership_admin', sa1);
    await api.grant(kim.accountId, 'election_admin', sa1);
    expect(await changeRole(site, kim.accountId, 'site_admin')).toMatchObject({ status: 409, body: { detail: /at most 2 roles/ } });
  });

  it('see the People list, but never delete an account or a test voter (403)', async () => {
    expect((await api.call('GET', '/v1/admin/accounts', site)).status).toBe(200);
    const leaving = await api.member('leaving@example.test');
    const remove = await api.call('POST', `/v1/admin/accounts/${leaving.accountId}/delete`, site, { reason: 'demo account, no longer used' });
    expect(remove).toMatchObject({ status: 403, body: { detail: 'requires role system_admin' } });
    expect((await api.firebase.db.collection('accounts').doc(leaving.accountId).get()).exists).toBe(true);
    expect((await api.firebase.auth.getUser(leaving.uid)).uid).toBe(leaving.uid);
    // Test voters too, and the testing tools, which stay with System Admins.
    const voters = await api.call('POST', '/v1/testing/personas/delete', site, { voters: [kim.accountId] });
    expect(voters).toMatchObject({ status: 403, body: { detail: 'requires role system_admin' } });
    expect((await api.call('GET', '/v1/testing/personas', site)).status).toBe(403);
    // And the sign-in settings, the API keys and the room's model server.
    expect((await api.call('GET', '/v1/admin/sign-in-methods', site)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/mfa-policy', site)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/api-keys', site)).status).toBe(403);
    expect((await api.call('PUT', '/v1/admin/room/settings/server', site, { on: true })).status).toBe(403);
  });

  it('use the other System Admin settings: navigation, email, the room, the sign-in log', async () => {
    for (const path of ['/v1/admin/navigation', '/v1/admin/notice-settings', '/v1/admin/mail/log', '/v1/admin/room/settings', '/v1/admin/security/sign-ins']) {
      expect((await api.call('GET', path, site)).status, path).toBe(200);
    }
  });
});

describe('audit ledger', () => {
  it('verifies the chain end to end and detects an edited entry', async () => {
    await api.grant(pat.accountId, 'auditor', sa1);
    const verify = await api.call('GET', '/v1/admin/audit/verify', pat);
    // bootstrap ×2, role.granted
    expect(verify.body).toEqual({
      ok: true,
      entries: 3,
      head: expect.stringMatching(/^[0-9a-f]{64}$/),
      blocks: 0,
      unblocked: 3,
      anchored: 0,
    });
    expect((await api.call('GET', '/v1/admin/audit/verify', sa1)).status).toBe(403);

    const events = (await api.call('GET', '/v1/admin/audit/events?after=1&limit=2', pat)).body;
    expect(events.map((e: { seq: number; type: string }) => [e.seq, e.type])).toEqual([
      [2, 'role.granted'],
      [3, 'role.granted'],
    ]);

    await api.firebase.db.collection('audit_events').doc('000000000003').update({ 'payload.reason': 'edited later' });
    expect((await api.call('GET', '/v1/admin/audit/verify', pat)).body).toMatchObject({ ok: false, part: 'entry', at: 3 });
  });
});

describe('People list (GET /v1/admin/accounts)', () => {
  let kim: Member;
  let lee: Member;

  beforeEach(async () => {
    kim = await api.member('kim@example.test');
    const leeUser = await api.user('lee@example.test', { emailVerified: false });
    lee = { ...leeUser, accountId: (await api.call('POST', '/v1/accounts', leeUser)).body.accountId };
  });

  const list = (by: User | undefined, query = '') => api.call('GET', `/v1/admin/accounts${query}`, by);
  const emails = (rows: { primaryEmail: string }[]) => rows.map((r) => r.primaryEmail);

  /** Active roles by accountId, read straight from `role_assignments/{accountId}_{role}`. */
  async function rolesInFirestore(): Promise<Map<string, string[]>> {
    const byAccount = new Map<string, string[]>();
    for (const doc of (await api.firebase.db.collection('role_assignments').get()).docs) {
      const { accountId, role, revokedAt } = doc.data();
      expect(doc.id).toBe(`${accountId}_${role}`);
      if (revokedAt === null) byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), role].sort());
    }
    return byAccount;
  }

  it('is for System and Site Admins only', async () => {
    await api.grant(pat.accountId, 'membership_admin', sa1);
    await api.grant(kim.accountId, 'auditor', sa1);
    expect((await list(undefined)).status).toBe(401);
    expect((await list(lee)).status).toBe(403);
    expect(await list(pat)).toMatchObject({ status: 403, body: { detail: 'requires role system_admin or site_admin' } });
    expect((await list(kim)).status).toBe(403);
    expect((await list(sa1)).status).toBe(200);
    await api.grant(pat.accountId, 'site_admin', sa1);
    expect((await list(pat)).status).toBe(200);
  });

  it('shows the roles each account holds in role_assignments, and only what the list needs', async () => {
    await api.grant(pat.accountId, 'election_admin', sa1);
    await api.grant(pat.accountId, 'membership_admin', sa2);
    await api.grant(kim.accountId, 'auditor', sa1);
    expect((await changeRole(sa1, pat.accountId, 'election_admin', 'revoke')).status).toBe(201);
    // Member status comes from members/{accountId}; nothing else from the member record is shown.
    await api.firebase.db
      .collection('members')
      .doc(pat.accountId)
      .set({ accountId: pat.accountId, status: 'active', legalName: 'Pat Doe', state: 'CA' });

    const rows = (await list(sa1)).body;
    expect(emails(rows)).toEqual(['kim@example.test', 'lee@example.test', 'pat@example.test', 'sa1@example.test', 'sa2@example.test']);
    const expected = await rolesInFirestore();
    for (const row of rows) expect(row.roles).toEqual(expected.get(row.accountId) ?? []);
    expect(Object.fromEntries(rows.map((r: { primaryEmail: string; roles: string[] }) => [r.primaryEmail, r.roles]))).toEqual({
      'kim@example.test': ['auditor'],
      'lee@example.test': [],
      'pat@example.test': ['membership_admin'],
      'sa1@example.test': ['system_admin'],
      'sa2@example.test': ['system_admin'],
    });
    expect(rows.find((r: { accountId: string }) => r.accountId === pat.accountId)).toEqual({
      accountId: pat.accountId,
      displayName: null,
      primaryEmail: 'pat@example.test',
      emailVerified: true,
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      memberStatus: 'active',
      roles: ['membership_admin'],
      onDeletionList: false,
    });
    expect(rows.find((r: { accountId: string }) => r.accountId === lee.accountId)).toMatchObject({ emailVerified: false, memberStatus: null });
  });

  it('pages in email order and searches by email prefix', async () => {
    const first = (await list(sa1, '?limit=2')).body;
    const second = (await list(sa1, `?limit=2&after=${first[1].accountId}`)).body;
    const third = (await list(sa1, `?limit=2&after=${second[1].accountId}`)).body;
    expect([first, second, third].map(emails)).toEqual([
      ['kim@example.test', 'lee@example.test'],
      ['pat@example.test', 'sa1@example.test'],
      ['sa2@example.test'],
    ]);
    expect(emails((await list(sa1, '?email=SA')).body)).toEqual(['sa1@example.test', 'sa2@example.test']);
    expect(emails((await list(sa1, `?email=sa&after=${sa1.accountId}`)).body)).toEqual(['sa2@example.test']);
    expect(emails((await list(sa1, '?email=pat%40')).body)).toEqual(['pat@example.test']);
    expect((await list(sa1, '?email=zed')).body).toEqual([]);
  });

  it('filters to role holders, with the same order, search and paging', async () => {
    await api.grant(kim.accountId, 'auditor', sa1);
    expect(emails((await list(sa1, '?role=any')).body)).toEqual(['kim@example.test', 'sa1@example.test', 'sa2@example.test']);
    expect(emails((await list(sa1, '?role=auditor')).body)).toEqual(['kim@example.test']);
    expect(emails((await list(sa1, '?role=any&email=sa')).body)).toEqual(['sa1@example.test', 'sa2@example.test']);
    expect(emails((await list(sa1, '?role=system_admin&limit=1')).body)).toEqual(['sa1@example.test']);
    expect(emails((await list(sa1, `?role=system_admin&after=${sa1.accountId}`)).body)).toEqual(['sa2@example.test']);
    // The cursor may be someone who no longer holds the role; the page continues after their place.
    expect(emails((await list(sa1, `?role=system_admin&after=${lee.accountId}`)).body)).toEqual(['sa1@example.test', 'sa2@example.test']);
    expect((await list(sa1, '?role=election_admin')).body).toEqual([]);
  });

  it('rejects bad parameters', async () => {
    for (const query of ['?role=nope', '?limit=0', '?limit=101', `?after=${'0'.repeat(65)}`, '?after=01890000-0000-7000-8000-000000000000']) {
      expect((await list(sa1, query)).status, query).toBe(400);
    }
  });
});

describe('deleting an account (POST /v1/admin/accounts/{accountId}/delete)', () => {
  let leaving: Member;

  beforeEach(async () => {
    leaving = await api.member('leaving@example.test');
  });

  const remove = (by: User, accountId: string) =>
    api.call('POST', `/v1/admin/accounts/${accountId}/delete`, by, { reason: 'demo account, no longer used' });
  const db = () => api.firebase.db;

  it('deletes a listed account that is not a member, with its logins, roles and records, and ledgers it', async () => {
    await api.grant(leaving.accountId, 'election_admin', sa1);
    const request = { action: 'role.grant', subject: leaving.accountId, status: 'pending', requestedBy: sa2.accountId };
    await db().collection('approval_requests').doc('old-request').set(request);
    await db().collection('sign_ins').doc(`${leaving.uid}_1`).set({ uid: leaving.uid, accountId: leaving.accountId });
    await db().collection('sign_ins').doc(`${leaving.uid}_0`).set({ uid: leaving.uid, accountId: null });
    await db().collection('page_visits').doc('visit').set({ accountId: leaving.accountId, page: 'courses' });
    await db().collection('course_progress').doc(`course_${leaving.accountId}`).set({ courseId: 'course', accountId: leaving.accountId });
    await db().collection('page_visits').doc('pats-visit').set({ accountId: pat.accountId, page: 'courses' });

    const rows = (await api.call('GET', '/v1/admin/accounts', sa1)).body as { accountId: string; onDeletionList: boolean }[];
    expect(Object.fromEntries(rows.map((r) => [r.accountId, r.onDeletionList]))).toMatchObject({
      [leaving.accountId]: true,
      [pat.accountId]: false,
    });
    const seq = (await db().collection('ledger_head').doc('main').get()).data()!.seq as number;

    expect((await remove(sa1, leaving.accountId)).status).toBe(204);

    expect((await db().collection('accounts').doc(leaving.accountId).get()).exists).toBe(false);
    expect((await db().collection('account_identities').doc(leaving.uid).get()).exists).toBe(false);
    for (const c of ['role_assignments', 'sign_ins', 'page_visits', 'course_progress']) {
      expect((await db().collection(c).where('accountId', '==', leaving.accountId).get()).size).toBe(0);
    }
    expect((await db().collection('sign_ins').where('uid', '==', leaving.uid).get()).size).toBe(0);
    expect((await db().collection('approval_requests').doc('old-request').get()).exists).toBe(false);
    expect((await db().collection('page_visits').doc('pats-visit').get()).exists).toBe(true);
    await expect(api.firebase.auth.getUser(leaving.uid)).rejects.toMatchObject({ code: 'auth/user-not-found' });

    const events = (await db().collection('audit_events').where('seq', '>', seq).orderBy('seq').get()).docs.map((d) => d.data());
    const reason = 'demo account, no longer used';
    expect(events.map((e) => [e.type, e.actor, e.subject])).toEqual([
      ['role.revoked', sa1.accountId, leaving.accountId],
      ['identity.unlinked', sa1.accountId, leaving.accountId],
      ['account.deleted', sa1.accountId, leaving.accountId],
    ]);
    expect(events.map((e) => e.payload)).toEqual([
      { role: 'election_admin', reason },
      { uid: leaving.uid, provider: 'password', reason },
      { email: 'leaving@example.test', uid: leaving.uid, reason },
    ]);
    // The chain still verifies: the deletion only appended to it.
    const auditor = await api.member('auditor@example.test');
    await api.grant(auditor.accountId, 'auditor', sa1);
    expect((await api.call('GET', '/v1/admin/audit/verify', auditor)).body).toMatchObject({ ok: true });
  });

  it('deletes a listed member with their membership: member record, status history, applications and ticked first steps', async () => {
    const member = { accountId: leaving.accountId, status: 'active' };
    await db().collection('members').doc(leaving.accountId).set(member);
    await db().collection('member_status_history').doc('h1').set({ accountId: leaving.accountId, from: null, to: 'applicant' });
    await db().collection('member_status_history').doc('h2').set({ accountId: leaving.accountId, from: 'applicant', to: 'active' });
    await db().collection('applications').doc('a1').set({ accountId: leaving.accountId, status: 'approved' });
    await db().collection('first_step_ticks').doc(leaving.accountId).set({ ticked: ['bylaws'], updatedAt: '2026-11-12T00:00:00.000Z' });
    await db().collection('members').doc(pat.accountId).set({ accountId: pat.accountId, status: 'active' });
    // An election in which the account is on no roll and has not voted does not stop it, nor does a rejected roll.
    await db().collection('elections').doc('e1').set({ electionId: 'e1' });
    await db().collection('eligibility_snapshots').doc('s1').set({ electionId: 'e1', status: 'approved', accountIds: [pat.accountId] });
    await db().collection('eligibility_snapshots').doc('s2').set({ electionId: 'e1', status: 'rejected', accountIds: [leaving.accountId] });

    expect((await remove(sa1, leaving.accountId)).status).toBe(204);

    expect((await db().collection('members').doc(leaving.accountId).get()).exists).toBe(false);
    expect((await db().collection('first_step_ticks').doc(leaving.accountId).get()).exists).toBe(false);
    for (const c of ['member_status_history', 'applications']) {
      expect((await db().collection(c).where('accountId', '==', leaving.accountId).get()).size).toBe(0);
    }
    expect((await db().collection('members').doc(pat.accountId).get()).exists).toBe(true);
    expect((await db().collection('accounts').doc(leaving.accountId).get()).exists).toBe(false);
  });

  it('refuses accounts not on the list, on an election roll or that voted, your own, and anyone but a System Admin', async () => {
    const site = await api.member('site@example.test');
    await api.grant(site.accountId, 'site_admin', sa1);
    const onRoll = await api.member('leaving-member@example.test');
    await db().collection('elections').doc('e1').set({ electionId: 'e1' });
    const roll = db().collection('eligibility_snapshots').doc('s1');
    await api.grant(pat.accountId, 'membership_admin', sa1);

    expect(await remove(sa1, pat.accountId)).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/deletion list/) } });
    // On a roll waiting for an Auditor, approved, or approved and later replaced.
    for (const status of ['pending', 'approved', 'superseded']) {
      await roll.set({ electionId: 'e1', status, accountIds: [pat.accountId, onRoll.accountId] });
      expect(await remove(sa1, onRoll.accountId), status).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/election roll/) } });
    }
    await roll.delete();
    await db().collection('elections').doc('e1').collection('participation').doc(onRoll.accountId).set({ castAt: '2026-11-02T12:00:00.000Z' });
    expect(await remove(sa1, onRoll.accountId)).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/voted/) } });
    expect(await remove(sa1, sa1.accountId)).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/own account/) } });
    expect(await remove(pat, leaving.accountId)).toMatchObject({ status: 403, body: { detail: 'requires role system_admin' } });
    expect(await remove(site, leaving.accountId)).toMatchObject({ status: 403, body: { detail: 'requires role system_admin' } });
    expect(await remove(site, '01a00000-0000-7000-8000-000000000000')).toMatchObject({ status: 403 });
    expect((await remove(sa1, '01a00000-0000-7000-8000-000000000000')).status).toBe(404);
    expect((await api.call('POST', `/v1/admin/accounts/${leaving.accountId}/delete`, sa1, { reason: ' ' })).status).toBe(400);

    for (const id of [pat.accountId, onRoll.accountId, sa1.accountId, leaving.accountId]) {
      expect((await db().collection('accounts').doc(id).get()).exists).toBe(true);
    }
    expect((await api.firebase.auth.getUser(leaving.uid)).uid).toBe(leaving.uid);
  });
});
