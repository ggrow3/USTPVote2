import { PROBLEM_TYPES } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, SA1_EMAIL, SA2_EMAIL, TestApi } from './testing/emulator.js';

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
beforeEach(() => resetEmulators());

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
    // Non-admin routes still work, and tell the client what is missing.
    expect((await api.call('GET', '/v1/me', sa)).body.mfa).toEqual({ required: true, signedInWithMfa: false });
  });

  it('admits admins who signed in with a second factor, through a full two-person approval', async () => {
    const sa1 = await api.member(SA1_EMAIL, { mfa: true });
    const sa2 = await api.member(SA2_EMAIL, { mfa: true });
    const pat = await api.member('pat@example.test');

    expect((await api.call('GET', '/v1/me', sa1)).body.mfa).toEqual({ required: true, signedInWithMfa: true });
    expect((await api.call('GET', '/v1/admin/accounts', sa1)).status).toBe(200);
    await api.grant(pat.accountId, 'auditor', sa1, sa2);
    expect((await api.call('GET', '/v1/me', pat)).body).toMatchObject({
      roles: ['auditor'],
      mfa: { required: true, signedInWithMfa: false },
    });
    // The new Auditor signed in without a second factor, so the role alone does not open admin routes.
    expect((await api.call('GET', '/v1/admin/audit/verify', pat)).body.type).toBe(PROBLEM_TYPES.mfaRequired);
  });

  it('does not ask members without a role for a second factor', async () => {
    const member = await api.member('member@example.test');
    expect((await api.call('GET', '/v1/me', member)).body.mfa).toEqual({ required: false, signedInWithMfa: false });
  });
});
