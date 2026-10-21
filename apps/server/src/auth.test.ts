import { ForbiddenException, type HttpException } from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { PROBLEM_TYPES, type Check } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { actorOf, principalFromToken } from './auth/principal.js';
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
