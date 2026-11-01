import { ForbiddenException, type ExecutionContext, type HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { PROBLEM_TYPES, type Check, type Role } from 'ustp-domain';
import { describe, expect, it, vi } from 'vitest';
import { AuthGuard } from './auth/auth.guard.js';
import { CheckRevoked, MfaExempt, Roles } from './auth/decorators.js';
import type { DirectoryService } from './auth/directory.service.js';
import type { MfaPolicyService } from './auth/mfa-policy.js';
import { actorOf, principalFromToken } from './auth/principal.js';
import type { SignInMethodsService } from './auth/sign-in-methods.service.js';
import type { Firebase } from './infra/firebase.js';
import { assertCheck } from './common/validation.js';
import { loadConfig } from './config.js';

const emulators = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' };

/** The member two-step requirement (design §4), on or off. */
const policy = (membersRequired: boolean) =>
  ({ current: async () => ({ membersRequired, version: 0, updatedAt: null, updatedBy: null }) }) as unknown as MfaPolicyService;

describe('loadConfig', () => {
  it('allows testing mode only against the emulators or on a dev or staging deployment', () => {
    expect(loadConfig({}).testingMode).toBe(false);
    expect(loadConfig({ TESTING_MODE: 'true', DEPLOYMENT_ENVIRONMENT: 'dev' }).testingMode).toBe(true);
    expect(loadConfig({ TESTING_MODE: 'true', DEPLOYMENT_ENVIRONMENT: 'staging' }).testingMode).toBe(true);
    expect(loadConfig({ ...emulators, TESTING_MODE: 'true' }).testingMode).toBe(true);
    expect(() => loadConfig({ TESTING_MODE: 'true', DEPLOYMENT_ENVIRONMENT: 'prod' })).toThrow(/TESTING_MODE/);
    expect(() => loadConfig({ TESTING_MODE: 'true' })).toThrow(/TESTING_MODE/);
    expect(() => loadConfig({ DEPLOYMENT_ENVIRONMENT: 'production' })).toThrow(/DEPLOYMENT_ENVIRONMENT/);
  });

  it('enforces App Check and admin MFA by default', () => {
    expect(loadConfig({})).toMatchObject({ appCheckEnforced: true, adminMfaRequired: true, usingEmulators: false });
  });

  it('refuses to relax either safety switch outside the emulators', () => {
    expect(() => loadConfig({ APP_CHECK_ENFORCED: 'false' })).toThrow(/only allowed with the Firebase emulators/);
    expect(() => loadConfig({ ADMIN_MFA_REQUIRED: 'false', FIRESTORE_EMULATOR_HOST: 'x' })).toThrow();
    expect(loadConfig({ ...emulators, APP_CHECK_ENFORCED: 'false', ADMIN_MFA_REQUIRED: 'false' })).toMatchObject({
      appCheckEnforced: false,
      adminMfaRequired: false,
    });
  });

  it('normalizes bootstrap admin emails', () => {
    expect(loadConfig({ BOOTSTRAP_SYSTEM_ADMIN_EMAILS: ' A@Example.org, ,b@example.org' }).bootstrapSystemAdmins).toEqual([
      'a@example.org',
      'b@example.org',
    ]);
  });
});

describe('assertCheck', () => {
  it('passes a rule code through as the problem type', () => {
    const run = (check: Check) => {
      try {
        assertCheck(check, ForbiddenException);
        return null;
      } catch (e) {
        return (e as HttpException).getResponse();
      }
    };
    expect(run({ ok: true })).toBeNull();
    expect(run({ ok: false, reason: 'nope' })).toEqual({ message: 'nope' });
    expect(run({ ok: false, reason: 'sign in again', code: 'reauthRequired' })).toEqual({
      message: 'sign in again',
      type: PROBLEM_TYPES.reauthRequired,
    });
  });
});

describe('principal', () => {
  const token = (firebase: Partial<DecodedIdToken['firebase']>, extra: Partial<DecodedIdToken> = {}) =>
    ({
      uid: 'u1',
      email: 'Pat@Example.org',
      email_verified: true,
      auth_time: 1_000,
      firebase: { sign_in_provider: 'google.com', identities: {}, ...firebase },
      ...extra,
    }) as unknown as DecodedIdToken;

  it('reads provider, second factor and auth time from the ID token', () => {
    expect(principalFromToken(token({ sign_in_second_factor: 'totp' }))).toEqual({
      uid: 'u1',
      email: 'pat@example.org',
      emailVerified: true,
      name: null,
      provider: 'google.com',
      mfa: true,
      authTime: 1_000,
    });
    expect(principalFromToken(token({})).mfa).toBe(false);
  });

  it('computes the actor the two-person rule sees', () => {
    const principal = principalFromToken(token({}));
    const ctx = { principal, accountId: 'a1', roles: ['auditor' as const], operator: null };
    expect(actorOf(ctx, true, 1_600_000)).toEqual({ accountId: 'a1', roles: ['auditor'], mfa: false, authAgeSeconds: 600 });
    expect(actorOf(ctx, false, 1_600_000).mfa).toBe(true);
  });
});

describe('AuthGuard', () => {
  class Routes {
    read() {}
    @CheckRevoked()
    cast() {}
  }

  async function verifiedWith(handler: 'read' | 'cast'): Promise<boolean> {
    const verifyIdToken = vi.fn(
      async (_token: string, _checkRevoked?: boolean) => ({ uid: 'u1', firebase: { sign_in_provider: 'password' } }) as unknown as DecodedIdToken,
    );
    const guard = new AuthGuard(
      new Reflector(),
      { auth: { verifyIdToken } } as unknown as Firebase,
      loadConfig({ ...emulators, APP_CHECK_ENFORCED: 'false', ADMIN_MFA_REQUIRED: 'false' }),
      { isEnabled: async () => true } as unknown as SignInMethodsService,
      { accountIdForUid: async () => 'a1', activeRoles: async () => [] } as unknown as DirectoryService,
      policy(false),
    );
    const context = {
      getHandler: () => Routes.prototype[handler],
      getClass: () => Routes,
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer t' } }) }),
    } as unknown as ExecutionContext;
    await guard.canActivate(context);
    return verifyIdToken.mock.calls[0]![1]!;
  }

  it('checks token revocation on routes marked @CheckRevoked (casting) only', async () => {
    expect(await verifiedWith('cast')).toBe(true);
    expect(await verifiedWith('read')).toBe(false);
  });
});

describe('AuthGuard acting as a test persona', () => {
  const PERSONA = '01a16700-0000-7000-8000-000000000001';
  class Routes {
    read() {}
  }

  async function actAs(
    persona: unknown,
    { testing = true, mfa = true, roles = ['system_admin'], isPersona = true }: Partial<{ testing: boolean; mfa: boolean; roles: string[]; isPersona: boolean }> = {},
  ) {
    const verifyIdToken = vi.fn(
      async () =>
        ({ uid: 'u1', firebase: { sign_in_provider: 'password', ...(mfa && { sign_in_second_factor: 'totp' }) } }) as unknown as DecodedIdToken,
    );
    const guard = new AuthGuard(
      new Reflector(),
      { auth: { verifyIdToken } } as unknown as Firebase,
      loadConfig({ ...emulators, APP_CHECK_ENFORCED: 'false', ...(testing && { TESTING_MODE: 'true' }) }),
      { isEnabled: async () => true } as unknown as SignInMethodsService,
      {
        accountIdForUid: async () => 'admin',
        activeRoles: async (id: string) => (id === 'admin' ? roles : ['auditor']),
        isPersona: async () => isPersona,
      } as unknown as DirectoryService,
      policy(false),
    );
    const request: { headers: Record<string, unknown>; method: string; url: string; ctx?: unknown } = {
      headers: { authorization: 'Bearer t', 'x-act-as': persona },
      method: 'GET',
      url: '/v1/me',
    };
    const context = {
      getHandler: () => Routes.prototype.read,
      getClass: () => Routes,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await guard.canActivate(context);
    return { ctx: request.ctx, checkRevoked: verifyIdToken.mock.calls[0] as unknown[] };
  }

  it('lets a System Admin signed in with MFA act as a persona, recording them as the operator', async () => {
    const { ctx, checkRevoked } = await actAs(PERSONA);
    expect(ctx).toMatchObject({ accountId: PERSONA, operator: 'admin' });
    expect(checkRevoked[1]).toBe(true);
  });

  it('refuses when testing mode is off, without MFA, for anyone but a System Admin, or for a real account', async () => {
    await expect(actAs(PERSONA, { testing: false })).rejects.toThrow(/testing mode is off/);
    await expect(actAs(PERSONA, { mfa: false })).rejects.toThrow(/multi-factor/);
    await expect(actAs(PERSONA, { roles: ['membership_admin'] })).rejects.toThrow(/only System Admins/);
    await expect(actAs(PERSONA, { isPersona: false })).rejects.toThrow(/not a test persona/);
    await expect(actAs('../accounts/x')).rejects.toThrow(/must be a test persona/);
  });
});

describe('AuthGuard two-step requirement', () => {
  class Routes {
    read() {}
    @MfaExempt()
    me() {}
    @Roles('election_admin')
    admin() {}
  }

  /** What the guard does with a sign-in: true, or the refusal's body. */
  async function admit(
    handler: 'read' | 'me' | 'admin',
    { roles = [] as Role[], mfa = false, membersRequired = false, mfaSwitch = true, accountId = 'a1' as string | null } = {},
  ): Promise<unknown> {
    const token = { uid: 'u1', firebase: { sign_in_provider: 'password', ...(mfa && { sign_in_second_factor: 'totp' }) } };
    const activeRoles = vi.fn(async () => roles);
    const guard = new AuthGuard(
      new Reflector(),
      { auth: { verifyIdToken: async () => token as unknown as DecodedIdToken } } as unknown as Firebase,
      loadConfig({ ...emulators, APP_CHECK_ENFORCED: 'false', ADMIN_MFA_REQUIRED: String(mfaSwitch) }),
      { isEnabled: async () => true } as unknown as SignInMethodsService,
      { accountIdForUid: async () => accountId, activeRoles } as unknown as DirectoryService,
      policy(membersRequired),
    );
    const context = {
      getHandler: () => Routes.prototype[handler],
      getClass: () => Routes,
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer t' } }) }),
    } as unknown as ExecutionContext;
    try {
      return await guard.canActivate(context);
    } catch (e) {
      return (e as HttpException).getResponse();
    }
  }
  const refused = { type: PROBLEM_TYPES.mfaRequired };

  it('lets members without a role in with one factor while the requirement is off', async () => {
    expect(await admit('read')).toBe(true);
    expect(await admit('read', { accountId: null })).toBe(true);
  });

  it('keeps System Admins to a second factor on every route while the requirement is off', async () => {
    expect(await admit('read', { roles: ['system_admin'] })).toMatchObject({
      ...refused,
      message: 'System Admins must sign in with two-step verification',
    });
    expect(await admit('read', { roles: ['system_admin'], mfa: true })).toBe(true);
    // They can still see where they stand and set one up.
    expect(await admit('me', { roles: ['system_admin'] })).toBe(true);
  });

  it('keeps every other admin role to a second factor on admin routes only while the requirement is off', async () => {
    expect(await admit('read', { roles: ['election_admin'] })).toBe(true);
    expect(await admit('admin', { roles: ['election_admin'] })).toMatchObject(refused);
    expect(await admit('admin', { roles: ['election_admin'], mfa: true })).toBe(true);
  });

  it('requires a second factor of everyone while the requirement is on, except to see their own account', async () => {
    for (const roles of [[], ['election_admin'], ['system_admin']] as Role[][]) {
      expect(await admit('read', { roles, membersRequired: true })).toMatchObject({
        ...refused,
        message: 'this site requires two-step verification; set it up on your account page',
      });
      expect(await admit('read', { roles, membersRequired: true, mfa: true })).toBe(true);
      expect(await admit('me', { roles, membersRequired: true })).toBe(true);
    }
    // A login with no account yet too: it creates one (exempt) and sets up its second factor first.
    expect(await admit('read', { accountId: null, membersRequired: true })).toMatchObject(refused);
  });

  it('asks nobody for a second factor where the deployment switches MFA off (emulators only)', async () => {
    expect(await admit('read', { roles: ['system_admin'], mfaSwitch: false })).toBe(true);
    expect(await admit('read', { membersRequired: true, mfaSwitch: false })).toBe(true);
  });
});
