import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EmailVerifiedSync } from './accounts/email-verified-sync.js';
import { resetEmulators, SA1_EMAIL, SA2_EMAIL, signIn, TestApi } from './testing/emulator.js';

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
    expect((await api.call('GET', '/v1/me', user)).body).toEqual({
      account: null,
      identities: [],
      member: null,
      roles: [],
      mfa: { required: false, everywhere: false, signedInWithMfa: false },
      testing: { enabled: false, operator: null },
    });

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

  it('keeps the daily quote and joke off until the person turns it on, and records nothing in the ledger', async () => {
    const alex = await api.member('alex@example.test');
    const me = async () => (await api.call('GET', '/v1/me', alex)).body.account;
    expect((await me()).preferences).toBeUndefined();
    const ledgerSize = async () => (await api.firebase.db.collection('audit_events').count().get()).data().count;
    const before = await ledgerSize();

    const on = await api.call('PUT', '/v1/me/preferences', alex, { dailyQuote: true });
    expect(on).toMatchObject({ status: 200, body: { dailyQuote: true } });
    expect((await me()).preferences).toEqual({ dailyQuote: true });
    expect((await api.call('PUT', '/v1/me/preferences', alex, { dailyQuote: false })).body).toEqual({ dailyQuote: false });
    expect((await me()).preferences).toEqual({ dailyQuote: false });
    expect(await ledgerSize()).toBe(before);

    expect((await api.call('PUT', '/v1/me/preferences', alex, { dailyQuote: 'yes' })).status).toBe(400);
    expect((await api.call('PUT', '/v1/me/preferences', alex, { dailyQuote: true, other: 1 })).status).toBe(400);
    const noAccount = await api.user('nobody@example.test');
    expect((await api.call('PUT', '/v1/me/preferences', noAccount, { dailyQuote: true })).status).toBe(403);
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

  it('applies the bootstrap grant once a password sign-up verifies its email, but never re-grants a revoked role', async () => {
    const sa = await api.user(SA1_EMAIL, { emailVerified: false });
    const created = await api.call('POST', '/v1/accounts', sa);
    expect(created.status).toBe(201);
    expect((await api.call('GET', '/v1/me', sa)).body.roles).toEqual([]);

    await api.firebase.auth.updateUser(sa.uid, { emailVerified: true });
    const verified = { ...sa, token: await signIn(SA1_EMAIL) };
    expect((await api.call('POST', '/v1/accounts', verified)).body).toEqual({ created: false, accountId: created.body.accountId });
    expect((await api.call('GET', '/v1/me', verified)).body.roles).toEqual(['system_admin']);

    // Revoked (seeded directly here; normally a System Admin's change): a later sign-in must not restore it.
    await api.firebase.db
      .collection('role_assignments')
      .doc(`${created.body.accountId}_system_admin`)
      .update({ revokedAt: new Date().toISOString(), revokedBy: 'someone' });
    await api.call('POST', '/v1/accounts', verified);
    expect((await api.call('GET', '/v1/me', verified)).body.roles).toEqual([]);
  });

  it('marks the account’s email verified once a password sign-up confirms it, so election email reaches it', async () => {
    const alex = await api.user('alex@example.test', { emailVerified: false });
    const { accountId } = (await api.call('POST', '/v1/accounts', alex)).body;
    const account = async () => (await api.firebase.db.collection('accounts').doc(accountId).get()).data();
    expect(await account()).toMatchObject({ primaryEmail: 'alex@example.test', emailVerified: false });
    await api.call('POST', '/v1/accounts', alex); // still unverified: nothing changes
    expect((await account())!.emailVerified).toBe(false);

    await api.firebase.auth.updateUser(alex.uid, { emailVerified: true });
    const verified = { ...alex, token: await signIn('alex@example.test') };
    expect((await api.call('POST', '/v1/accounts', verified)).body).toEqual({ created: false, accountId });
    expect((await account())!.emailVerified).toBe(true);
    expect((await api.call('GET', '/v1/me', verified)).body.account).toMatchObject({ emailVerified: true });
  });

  it('catches up accounts whose login confirmed the address before that, when the api starts', async () => {
    const make = async (email: string) => {
      const user = await api.user(email, { emailVerified: false });
      return { user, accountId: (await api.call('POST', '/v1/accounts', user)).body.accountId as string };
    };
    const confirmed = await make('confirmed@example.test');
    const unconfirmed = await make('unconfirmed@example.test');
    await api.firebase.auth.updateUser(confirmed.user.uid, { emailVerified: true });
    const verified = async (accountId: string) => (await api.firebase.db.collection('accounts').doc(accountId).get()).get('emailVerified');

    expect(await api.app.get(EmailVerifiedSync).run()).toBe(1);
    expect(await verified(confirmed.accountId)).toBe(true);
    expect(await verified(unconfirmed.accountId)).toBe(false);
    expect(await api.app.get(EmailVerifiedSync).run()).toBe(0);
  });

  it('skips the bootstrap grant while the account already holds two roles, and applies it once it holds one', async () => {
    const sa2 = await api.member(SA2_EMAIL);
    const sa = await api.user(SA1_EMAIL, { emailVerified: false });
    const { accountId } = (await api.call('POST', '/v1/accounts', sa)).body;
    await api.grant(accountId, 'membership_admin', sa2);
    await api.grant(accountId, 'election_admin', sa2);

    await api.firebase.auth.updateUser(sa.uid, { emailVerified: true });
    const verified = { ...sa, token: await signIn(SA1_EMAIL) };
    await api.call('POST', '/v1/accounts', verified);
    expect((await api.call('GET', '/v1/me', verified)).body.roles).toEqual(['election_admin', 'membership_admin']);
    expect((await api.firebase.db.collection('role_assignments').doc(`${accountId}_system_admin`).get()).exists).toBe(false);

    await api.call('POST', '/v1/admin/roles', sa2, { accountId, role: 'election_admin', change: 'revoke', reason: 'test' });
    await api.call('POST', '/v1/accounts', verified);
    expect((await api.call('GET', '/v1/me', verified)).body.roles).toEqual(['membership_admin', 'system_admin']);
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
    // The web app reads the same switches without signing in, to decide which buttons to show.
    expect((await api.call('GET', '/v1/sign-in-methods')).body).toEqual(off.body);

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
