import type { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { PROBLEM_TYPES, type AccountRecord, type Role } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { AccountsAdminController } from './accounts/accounts.controller.js';
import { compareAccounts, pageOf } from './accounts/accounts.service.js';
import { AuthGuard } from './auth/auth.guard.js';
import type { DirectoryService } from './auth/directory.service.js';
import type { SignInMethodsService } from './auth/sign-in-methods.service.js';
import { loadConfig } from './config.js';
import type { Firebase } from './infra/firebase.js';

const emulators = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' };

describe('People list route (GET /v1/admin/accounts)', () => {
  /** What the AuthGuard does with the real route's metadata: true, or the refusal's body. */
  async function admit(roles: Role[], { mfa = true } = {}): Promise<unknown> {
    const token = { uid: 'u1', firebase: { sign_in_provider: 'password', ...(mfa && { sign_in_second_factor: 'totp' }) } };
    const guard = new AuthGuard(
      new Reflector(),
      { auth: { verifyIdToken: async () => token as unknown as DecodedIdToken } } as unknown as Firebase,
      loadConfig({ ...emulators, APP_CHECK_ENFORCED: 'false', ADMIN_MFA_REQUIRED: 'true' }),
      { isEnabled: async () => true } as unknown as SignInMethodsService,
      { accountIdForUid: async () => 'a1', activeRoles: async () => roles } as unknown as DirectoryService,
    );
    const context = {
      getHandler: () => AccountsAdminController.prototype.list,
      getClass: () => AccountsAdminController,
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer t' } }) }),
    } as unknown as ExecutionContext;
    try {
      return await guard.canActivate(context);
    } catch (e) {
      return (e as HttpException).getResponse();
    }
  }

  it('admits System Admins signed in with a second factor, and nobody else', async () => {
    expect(await admit(['system_admin'])).toBe(true);
    for (const roles of [[], ['membership_admin', 'election_admin'], ['auditor']] as Role[][]) {
      expect(await admit(roles)).toMatchObject({ message: 'requires role system_admin' });
    }
    expect(await admit(['system_admin'], { mfa: false })).toMatchObject({ type: PROBLEM_TYPES.mfaRequired });
  });
});

describe('People list paging', () => {
  const account = (accountId: string, primaryEmail: string | null): AccountRecord => ({
    accountId,
    primaryEmail,
    displayName: null,
    emailVerified: true,
    createdAt: '2026-10-22T00:00:00.000Z',
  });
  const ids = (accounts: AccountRecord[]) => accounts.map((a) => a.accountId);
  const all = [account('c', 'pat@x.test'), account('b', 'sam@x.test'), account('e', null), account('a', 'pat@x.test'), account('d', 'kim@x.test')];

  it('orders as Firestore does: no email first, then by email, ties by accountId', () => {
    expect(ids([...all].sort(compareAccounts))).toEqual(['e', 'd', 'a', 'c', 'b']);
  });

  it('applies the email prefix, the cursor and the limit', () => {
    expect(ids(pageOf(all, undefined, null, 2))).toEqual(['e', 'd']);
    expect(ids(pageOf(all, undefined, account('d', 'kim@x.test'), 2))).toEqual(['a', 'c']);
    expect(ids(pageOf(all, 'pat', null, 10))).toEqual(['a', 'c']);
    expect(ids(pageOf(all, 'pat', account('a', 'pat@x.test'), 10))).toEqual(['c']);
    // A cursor that is not in the list itself (no longer holds the role) still marks a place in the order.
    expect(ids(pageOf(all, undefined, account('zz', 'lee@x.test'), 10))).toEqual(['a', 'c', 'b']);
    expect(all.map((a) => a.accountId)).toEqual(['c', 'b', 'e', 'a', 'd']);
  });
});
