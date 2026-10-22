import { ForbiddenException, type ExecutionContext, type HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { PROBLEM_TYPES, type Check } from 'ustp-domain';
import { describe, expect, it, vi } from 'vitest';
import { AuthGuard } from './auth/auth.guard.js';
import { CheckRevoked } from './auth/decorators.js';
import type { DirectoryService } from './auth/directory.service.js';
import { actorOf, principalFromToken } from './auth/principal.js';
import type { SignInMethodsService } from './auth/sign-in-methods.service.js';
import type { Firebase } from './infra/firebase.js';
import { assertCheck } from './common/validation.js';
import { loadConfig } from './config.js';

const emulators = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' };

describe('loadConfig', () => {
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
    const ctx = { principal, accountId: 'a1', roles: ['auditor' as const] };
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
