import { PROBLEM_TYPES } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MfaPolicyService } from './auth/mfa-policy.js';
import { resetEmulators, SA1_EMAIL, SA2_EMAIL, TestApi, type User } from './testing/emulator.js';

// The other suites run with ADMIN_MFA_REQUIRED=false; this one turns the production policy back on.
let api: TestApi;
beforeAll(async () => {
  process.env.ADMIN_MFA_REQUIRED = 'true';
  try {
    api = await TestApi.start();
  } finally {
    process.env.ADMIN_MFA_REQUIRED = 'false';
  }
});
afterAll(() => api.close());
beforeEach(async () => {
  await resetEmulators();
  api.app.get(MfaPolicyService).invalidate();
});

const ledger = async () => (await api.firebase.db.collection('audit_events').orderBy('seq').get()).docs.map((d) => d.data());

describe('admin multi-factor policy (real second-factor ID tokens)', () => {
  it('refuses admin routes after a password-only sign-in, with a machine-readable problem type', async () => {
    const sa = await api.member(SA1_EMAIL);
    const res = await api.call('GET', '/v1/admin/approvals', sa);
    expect(res).toMatchObject({
      status: 403,
      body: { type: PROBLEM_TYPES.mfaRequired, detail: 'admin actions require multi-factor sign-in' },
    });
    // Read-only admin routes too: the People list shows who holds which role.
    expect((await api.call('GET', '/v1/admin/accounts', sa)).body.type).toBe(PROBLEM_TYPES.mfaRequired);
    // And a role change, which one System Admin makes alone.
    const pat = await api.member('pat@example.test');
    const change = await api.call('POST', '/v1/admin/roles', sa, { accountId: pat.accountId, role: 'auditor', change: 'grant', reason: 'x' });
    expect(change).toMatchObject({ status: 403, body: { type: PROBLEM_TYPES.mfaRequired } });
    expect((await api.call('GET', '/v1/me', pat)).body.roles).toEqual([]);
    // Their own account still answers, and tells the client what is missing.
    expect((await api.call('GET', '/v1/me', sa)).body.mfa).toEqual({ required: true, everywhere: true, signedInWithMfa: false });
  });

  it('admits admins who signed in with a second factor, through a role change', async () => {
    const sa1 = await api.member(SA1_EMAIL, { mfa: true });
    const pat = await api.member('pat@example.test');

    expect((await api.call('GET', '/v1/me', sa1)).body.mfa).toEqual({ required: true, everywhere: true, signedInWithMfa: true });
    expect((await api.call('GET', '/v1/admin/accounts', sa1)).status).toBe(200);
    await api.grant(pat.accountId, 'auditor', sa1);
    expect((await api.call('GET', '/v1/me', pat)).body).toMatchObject({
      roles: ['auditor'],
      mfa: { required: true, everywhere: false, signedInWithMfa: false },
    });
    // The new Auditor signed in without a second factor, so the role alone does not open admin routes.
    expect((await api.call('GET', '/v1/admin/audit/verify', pat)).body.type).toBe(PROBLEM_TYPES.mfaRequired);
  });

  it('does not ask members without a role for a second factor', async () => {
    const member = await api.member('member@example.test');
    expect((await api.call('GET', '/v1/me', member)).body.mfa).toEqual({ required: false, everywhere: false, signedInWithMfa: false });
  });
});

describe('the two-step requirement for members (design §4)', () => {
  const put = (by: User | undefined, membersRequired: unknown, basedOn: number) =>
    api.call('PUT', '/v1/admin/mfa-policy', by, { basedOn, membersRequired });
  /** A route every signed-in person with an account may use: their own display choices. */
  const useSite = (user: User) => api.call('PUT', '/v1/me/preferences', user, { dailyQuote: true });
  const MEMBER_REFUSAL = {
    status: 403,
    body: { type: PROBLEM_TYPES.mfaRequired, detail: 'this site requires two-step verification; set it up on your account page' },
  };
  const SYSTEM_ADMIN_REFUSAL = {
    status: 403,
    body: { type: PROBLEM_TYPES.mfaRequired, detail: 'System Admins must sign in with two-step verification' },
  };

  it('is off by default: members and other admins use the site with one factor, System Admins never do', async () => {
    const sa1 = await api.member(SA1_EMAIL, { mfa: true });
    const sa2 = await api.member(SA2_EMAIL);
    const member = await api.member('member@example.test');
    const ea = await api.member('ea@example.test');
    await api.grant(ea.accountId, 'election_admin', sa1);

    expect((await useSite(member)).status).toBe(200);
    expect((await useSite(ea)).status).toBe(200);
    expect((await useSite(sa1)).status).toBe(200);
    expect(await useSite(sa2)).toMatchObject(SYSTEM_ADMIN_REFUSAL);
    // The Election Admin still needs one for the admin tools.
    expect((await api.call('GET', '/v1/admin/approvals', ea)).body.type).toBe(PROBLEM_TYPES.mfaRequired);
    expect((await api.call('GET', '/v1/me', member)).body.mfa).toEqual({ required: false, everywhere: false, signedInWithMfa: false });
    expect((await api.call('GET', '/v1/me', ea)).body.mfa).toEqual({ required: true, everywhere: false, signedInWithMfa: false });
    expect((await api.call('GET', '/v1/me', sa2)).body.mfa).toEqual({ required: true, everywhere: true, signedInWithMfa: false });
  });

  it('is switched on and off by a System Admin, ledgered, and holds System Admins to it either way', async () => {
    const sa1 = await api.member(SA1_EMAIL, { mfa: true });
    const sa2 = await api.member(SA2_EMAIL);
    const member = await api.member('member@example.test');
    const secured = await api.member('secured@example.test', { mfa: true });
    expect((await api.call('GET', '/v1/admin/mfa-policy', sa1)).body).toEqual({
      membersRequired: false,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    });

    const on = await put(sa1, true, 0);
    expect(on).toMatchObject({ status: 200, body: { membersRequired: true, version: 1, updatedBy: sa1.accountId } });
    expect(Date.parse(on.body.updatedAt)).toBeGreaterThan(Date.now() - 60_000);
    // On: members without a second factor see where they stand, and nothing else.
    expect(await useSite(member)).toMatchObject(MEMBER_REFUSAL);
    expect((await api.call('GET', '/v1/me', member)).body.mfa).toEqual({ required: true, everywhere: true, signedInWithMfa: false });
    expect((await api.call('POST', '/v1/accounts', member)).status).toBe(200);
    // Pages they open meanwhile still count (design §10.7): the visit records only their own.
    expect((await api.call('POST', '/v1/page-visits', member, { path: '/account' })).status).toBe(204);
    expect((await useSite(secured)).status).toBe(200);
    expect(await useSite(sa2)).toMatchObject(MEMBER_REFUSAL);
    // Someone signing up creates their account, then sets up a second factor before anything else.
    const newcomer = await api.user('new@example.test');
    expect((await api.call('POST', '/v1/accounts', newcomer)).status).toBe(201);
    expect(await useSite(newcomer)).toMatchObject(MEMBER_REFUSAL);

    const off = await put(sa1, false, 1);
    expect(off).toMatchObject({ status: 200, body: { membersRequired: false, version: 2, updatedBy: sa1.accountId } });
    // Off: members are let in again, and a System Admin without a second factor still is not.
    expect((await useSite(member)).status).toBe(200);
    expect((await useSite(newcomer)).status).toBe(200);
    expect(await useSite(sa2)).toMatchObject(SYSTEM_ADMIN_REFUSAL);
    expect((await api.call('GET', '/v1/me', sa2)).body.mfa).toEqual({ required: true, everywhere: true, signedInWithMfa: false });

    expect((await ledger()).filter((e) => e.type === 'mfa_policy.changed')).toMatchObject([
      { actor: sa1.accountId, subject: null, payload: { version: 1, membersRequired: true } },
      { actor: sa1.accountId, subject: null, payload: { version: 2, membersRequired: false } },
    ]);
  });

  it('holds someone made System Admin to it at once', async () => {
    const sa1 = await api.member(SA1_EMAIL, { mfa: true });
    const pat = await api.member('pat@example.test');
    expect((await useSite(pat)).status).toBe(200);
    await api.grant(pat.accountId, 'system_admin', sa1);
    expect(await useSite(pat)).toMatchObject(SYSTEM_ADMIN_REFUSAL);
  });

  it('holds Site Admins to it on every page, as System Admins', async () => {
    const sa1 = await api.member(SA1_EMAIL, { mfa: true });
    const site = await api.member('site@example.test');
    const secured = await api.member('secured@example.test', { mfa: true });
    await api.grant(site.accountId, 'site_admin', sa1);
    await api.grant(secured.accountId, 'site_admin', sa1);
    expect(await useSite(site)).toMatchObject({
      status: 403,
      body: { type: PROBLEM_TYPES.mfaRequired, detail: 'Site Admins must sign in with two-step verification' },
    });
    expect((await api.call('GET', '/v1/me', site)).body.mfa).toEqual({ required: true, everywhere: true, signedInWithMfa: false });
    expect((await useSite(secured)).status).toBe(200);
    expect((await api.call('GET', '/v1/admin/accounts', secured)).status).toBe(200);
  });

  it('is changed only by a System Admin signed in with a second factor, from the version they saw', async () => {
    const sa1 = await api.member(SA1_EMAIL, { mfa: true });
    const sa2 = await api.member(SA2_EMAIL);
    const ea = await api.member('ea@example.test', { mfa: true });
    await api.grant(ea.accountId, 'election_admin', sa1);

    expect((await put(sa2, true, 0)).body.type).toBe(PROBLEM_TYPES.mfaRequired);
    expect((await put(ea, true, 0)).status).toBe(403);
    expect((await put(undefined, true, 0)).status).toBe(401);
    expect((await put(sa1, 'yes', 0)).status).toBe(400);
    expect((await put(sa1, true, 1)).status).toBe(409);
    // Saving what is already there writes nothing.
    expect((await put(sa1, false, 0)).body).toMatchObject({ membersRequired: false, version: 0 });
    expect((await ledger()).filter((e) => e.type === 'mfa_policy.changed')).toEqual([]);
  });
});

describe('with the deployment switch off (emulators only)', () => {
  it('asks nobody for a second factor, even with the requirement on', async () => {
    const relaxed = await TestApi.start();
    try {
      const sa = await relaxed.member(SA1_EMAIL);
      expect((await relaxed.call('PUT', '/v1/admin/mfa-policy', sa, { basedOn: 0, membersRequired: true })).status).toBe(200);
      const member = await relaxed.member('member@example.test');
      expect((await relaxed.call('PUT', '/v1/me/preferences', member, { dailyQuote: true })).status).toBe(200);
      expect((await relaxed.call('PUT', '/v1/me/preferences', sa, { dailyQuote: true })).status).toBe(200);
      expect((await relaxed.call('GET', '/v1/me', member)).body.mfa).toEqual({ required: false, everywhere: false, signedInWithMfa: false });
    } finally {
      await relaxed.close();
    }
  });
});
