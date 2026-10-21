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
