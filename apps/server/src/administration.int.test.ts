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

  it('is for System Admins only', async () => {
    await api.grant(pat.accountId, 'membership_admin', sa1);
    await api.grant(kim.accountId, 'auditor', sa1);
    expect((await list(undefined)).status).toBe(401);
    expect((await list(lee)).status).toBe(403);
    expect(await list(pat)).toMatchObject({ status: 403, body: { detail: 'requires role system_admin' } });
    expect((await list(kim)).status).toBe(403);
    expect((await list(sa1)).status).toBe(200);
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
