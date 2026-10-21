import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signIn, TestApi, resetEmulators } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());
beforeEach(() => resetEmulators());

describe('authentication', () => {
  it('serves health checks publicly and requires sign-in elsewhere, as problem details', async () => {
    expect((await api.call('GET', '/healthz')).status).toBe(200);
    const res = await api.call('GET', '/v1/me');
    expect(res.status).toBe(401);
    expect(res.contentType).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 401, detail: 'sign in required' });
  });

  it('rejects a forged token', async () => {
    const res = await api.call('GET', '/v1/me', { email: 'x', uid: 'x', token: 'not-a-jwt' });
    expect(res.status).toBe(401);
  });
});

describe('accounts', () => {
  it('creates an account on first sign-in, idempotently', async () => {
    const user = await api.user('alex@example.test');
    expect((await api.call('GET', '/v1/me', user)).body).toEqual({ account: null, identities: [], member: null, roles: [] });

    const first = await api.call('POST', '/v1/accounts', user);
    expect(first.status).toBe(201);
    expect(first.body.accountId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    const again = await api.call('POST', '/v1/accounts', user);
    expect(again).toMatchObject({ status: 200, body: { created: false, accountId: first.body.accountId } });

    const me = (await api.call('GET', '/v1/me', user)).body;
    expect(me.account).toMatchObject({ accountId: first.body.accountId, primaryEmail: 'alex@example.test', emailVerified: true });
    expect(me.identities).toEqual([expect.objectContaining({ uid: user.uid, provider: 'password' })]);
    expect(me.roles).toEqual([]);
  });

  it('links and unlinks a second login, keeping at least one', async () => {
    const alex = await api.member('alex@example.test');
    const second = await api.user('alex.other@example.test');

    expect((await api.call('POST', '/v1/me/identities', alex, { idToken: 'garbage' })).status).toBe(400);
    const link = await api.call('POST', '/v1/me/identities', alex, { idToken: second.token });
    expect(link.status).toBe(201);
    expect((await api.call('POST', '/v1/me/identities', alex, { idToken: second.token })).status).toBe(409);

    // Signing in with the linked login reaches the same account.
    const viaSecond = await api.call('POST', '/v1/accounts', second);
    expect(viaSecond.body).toEqual({ created: false, accountId: alex.accountId });
    expect((await api.call('GET', '/v1/me', alex)).body.identities).toHaveLength(2);

    expect((await api.call('DELETE', `/v1/me/identities/${second.uid}`, alex)).status).toBe(204);
    const last = await api.call('DELETE', `/v1/me/identities/${alex.uid}`, alex);
    expect(last).toMatchObject({ status: 409, body: { detail: 'you cannot remove your only login method' } });
  });

  it('refuses to link a login that already belongs to another account', async () => {
    const alex = await api.member('alex@example.test');
    const sam = await api.member('sam@example.test');
    expect((await api.call('POST', '/v1/me/identities', alex, { idToken: sam.token })).status).toBe(409);
  });

  it('makes the configured bootstrap emails System Admins, and records it in the ledger', async () => {
    const [sa1] = await api.systemAdmins();
    expect((await api.call('GET', '/v1/me', sa1)).body.roles).toEqual(['system_admin']);
    const entries = await api.firebase.db.collection('audit_events').get();
    expect(entries.docs.map((d) => d.data())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'role.granted', actor: 'bootstrap', subject: sa1.accountId, seq: 1 }),
      ]),
    );
  });

  it('validates request bodies field by field', async () => {
    const alex = await api.member('alex@example.test');
    const res = await api.call('POST', '/v1/me/identities', alex, { idToken: '', extra: true });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });
});

describe('sign-in method switches', () => {
  it('lets a System Admin switch providers off, but not all of them or their own', async () => {
    const [sa1] = await api.systemAdmins();
    const member = await api.member('member@example.test');
    expect((await api.call('PUT', '/v1/admin/sign-in-methods', member, { 'google.com': false })).status).toBe(403);

    const off = await api.call('PUT', '/v1/admin/sign-in-methods', sa1, { 'google.com': false, 'apple.com': false });
    expect(off.body).toEqual({ 'google.com': false, 'microsoft.com': true, 'apple.com': false, password: true });

    expect((await api.call('PUT', '/v1/admin/sign-in-methods', sa1, { password: false })).body.detail).toMatch(
      /the sign-in method you are using/,
    );
    const all = await api.call('PUT', '/v1/admin/sign-in-methods', sa1, { 'microsoft.com': false, password: false });
    expect(all.body.detail).toMatch(/at least one/);
  });

  it('blocks tokens from a disabled provider', async () => {
    const [sa1] = await api.systemAdmins();
    const member = await api.member('member@example.test');
    // Seed the switch directly (an admin would first have to sign in another way to turn off their own method).
    await api.firebase.db
      .collection('sign_in_methods')
      .doc('password')
      .set({ provider: 'password', enabled: false, updatedAt: new Date().toISOString(), updatedBy: sa1.accountId });
    const fresh = await TestApi.start(); // new instance: no cached switches
    try {
      const res = await fresh.call('GET', '/v1/me', { ...member, token: await signIn(member.email) });
      expect(res).toMatchObject({ status: 403, body: { detail: 'sign-in with password is not enabled' } });
    } finally {
      await fresh.close();
    }
  });
});
