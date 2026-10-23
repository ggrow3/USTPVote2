import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

const request = (by: User, accountId: string, role: string, change = 'grant') =>
  api.call('POST', '/v1/admin/roles', by, { accountId, role, change, reason: 'staffing' });
const decide = (by: User, id: string, decision: 'approve' | 'reject') =>
  api.call('POST', `/v1/admin/approvals/${id}/decision`, by, { decision, reason: 'reviewed' });

describe('two-person role changes', () => {
  it('needs a second System Admin to approve', async () => {
    const req = await request(sa1, pat.accountId, 'auditor');
    expect(req.body).toMatchObject({ status: 'pending', action: 'role.grant', approverRole: 'system_admin' });

    const self = await decide(sa1, req.body.id, 'approve');
    expect(self).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/different person/) } });
    expect((await decide(pat, req.body.id, 'approve')).status).toBe(403);

    expect((await decide(sa2, req.body.id, 'approve')).body).toMatchObject({ status: 'executed', decidedBy: sa2.accountId });
    expect((await api.call('GET', '/v1/me', pat)).body.roles).toEqual(['auditor']);
    expect((await decide(sa2, req.body.id, 'approve')).status).toBe(403);
  });

  it('leaves roles untouched when rejected', async () => {
    const req = await request(sa1, pat.accountId, 'election_admin');
    expect((await decide(sa2, req.body.id, 'reject')).body.status).toBe('rejected');
    expect((await api.call('GET', '/v1/me', pat)).body.roles).toEqual([]);
  });

  it('revokes through the same flow', async () => {
    await api.grant(pat.accountId, 'election_admin', sa1, sa2);
    const req = await request(sa2, pat.accountId, 'election_admin', 'revoke');
    await decide(sa1, req.body.id, 'approve');
    expect((await api.call('GET', '/v1/me', pat)).body.roles).toEqual([]);
  });

  it('refuses incompatible roles, duplicate grants and requests about yourself', async () => {
    await api.grant(pat.accountId, 'auditor', sa1, sa2);
    expect((await request(sa1, pat.accountId, 'election_admin')).body.detail).toMatch(/cannot be held together/);
    expect((await request(sa1, pat.accountId, 'auditor')).body.detail).toMatch(/already holds/);
    expect((await request(sa1, sa1.accountId, 'membership_admin')).status).toBe(403);
    expect((await request(pat, sa1.accountId, 'membership_admin')).status).toBe(403);
  });

  it('keeps the person gaining a role from approving it', async () => {
    const req = await request(sa1, sa2.accountId, 'membership_admin');
    const res = await decide(sa2, req.body.id, 'approve');
    expect(res).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/own account/) } });
  });
});

describe('audit ledger', () => {
  it('verifies the chain end to end and detects an edited entry', async () => {
    await api.grant(pat.accountId, 'auditor', sa1, sa2);
    const verify = await api.call('GET', '/v1/admin/audit/verify', pat);
    // bootstrap ×2, approval.requested, approval.decided, role.granted
    expect(verify.body).toEqual({
      ok: true,
      entries: 5,
      head: expect.stringMatching(/^[0-9a-f]{64}$/),
      blocks: 0,
      unblocked: 5,
      anchored: 0,
    });
    expect((await api.call('GET', '/v1/admin/audit/verify', sa1)).status).toBe(403);

    const events = (await api.call('GET', '/v1/admin/audit/events?after=2&limit=2', pat)).body;
    expect(events.map((e: { seq: number; type: string }) => [e.seq, e.type])).toEqual([
      [3, 'approval.requested'],
      [4, 'approval.decided'],
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
    await api.grant(pat.accountId, 'membership_admin', sa1, sa2);
    await api.grant(kim.accountId, 'auditor', sa1, sa2);
    expect((await list(undefined)).status).toBe(401);
    expect((await list(lee)).status).toBe(403);
    expect(await list(pat)).toMatchObject({ status: 403, body: { detail: 'requires role system_admin' } });
    expect((await list(kim)).status).toBe(403);
    expect((await list(sa1)).status).toBe(200);
  });

  it('shows the roles each account holds in role_assignments, and only what the list needs', async () => {
    await api.grant(pat.accountId, 'election_admin', sa1, sa2);
    await api.grant(pat.accountId, 'membership_admin', sa2, sa1);
    await api.grant(kim.accountId, 'auditor', sa1, sa2);
    const revoke = await request(sa1, pat.accountId, 'election_admin', 'revoke');
    expect((await decide(sa2, revoke.body.id, 'approve')).body.status).toBe('executed');
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
    await api.grant(kim.accountId, 'auditor', sa1, sa2);
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
