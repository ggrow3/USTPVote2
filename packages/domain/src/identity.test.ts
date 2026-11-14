import { describe, expect, it } from 'vitest';
import { DEFAULT_MFA_POLICY, enabledFederatedProviders, isSignInProvider, mfaPolicySchema, providerNames, secondFactorScope } from './identity.js';
import { isPublicLedgerEvent } from './ledger.js';
import { LEDGER_EVENT_TYPES } from './ledger-events.js';
import { ROLES, type Role } from './roles.js';

describe('sign-in providers', () => {
  it('accepts only the providers the site offers', () => {
    expect(isSignInProvider('google.com')).toBe(true);
    expect(isSignInProvider('password')).toBe(true);
    for (const other of ['phone', 'anonymous', 'custom', '', null]) expect(isSignInProvider(other)).toBe(false);
  });
});

describe('providers instead of a password (design §5.13)', () => {
  it('are the federated ones switched on, in the site order', () => {
    expect(enabledFederatedProviders({ 'google.com': true, 'microsoft.com': false, 'apple.com': true, password: true })).toEqual(['google.com', 'apple.com']);
    expect(enabledFederatedProviders({ password: true })).toEqual([]);
  });

  it('are named as a sentence names them', () => {
    expect(providerNames(['google.com'])).toBe('Google');
    expect(providerNames(['google.com', 'microsoft.com'])).toBe('Google or Microsoft');
    expect(providerNames(['google.com', 'microsoft.com', 'apple.com'])).toBe('Google, Microsoft or Apple');
  });
});

describe('two-step verification policy', () => {
  const off = DEFAULT_MFA_POLICY;
  const on = { ...DEFAULT_MFA_POLICY, membersRequired: true };

  it('is off for members and on for Site Admins by default', () => {
    expect(DEFAULT_MFA_POLICY).toEqual({ membersRequired: false, siteAdminsRequired: true });
    expect(secondFactorScope([], off)).toBe('none');
  });

  it('always requires System Admins to use a second factor everywhere, and Site Admins while their setting is on', () => {
    for (const policy of [off, on]) {
      expect(secondFactorScope(['system_admin'], policy)).toBe('everywhere');
      expect(secondFactorScope(['membership_admin', 'system_admin'], policy)).toBe('everywhere');
      expect(secondFactorScope(['site_admin'], policy)).toBe('everywhere');
      expect(secondFactorScope(['site_admin', 'course_admin'], policy)).toBe('everywhere');
    }
  });

  it('asks a Site Admin for nothing with their setting off, but for what their other roles and the member setting ask', () => {
    const relaxed = { ...off, siteAdminsRequired: false };
    expect(secondFactorScope(['site_admin'], relaxed)).toBe('none');
    expect(secondFactorScope(['site_admin', 'membership_admin'], relaxed)).toBe('admin');
    expect(secondFactorScope(['site_admin'], { ...relaxed, membersRequired: true })).toBe('everywhere');
    expect(secondFactorScope(['system_admin'], relaxed)).toBe('everywhere');
    expect(secondFactorScope(['election_admin'], relaxed)).toBe('admin');
  });

  it('keeps every other admin role to a second factor for the admin tools while the setting is off', () => {
    for (const role of ROLES.filter((r) => r !== 'system_admin' && r !== 'site_admin')) {
      expect(secondFactorScope([role], off)).toBe('admin');
    }
    expect(secondFactorScope(['membership_admin', 'election_admin'], off)).toBe('admin');
  });

  it('requires everyone to use a second factor everywhere while the setting is on', () => {
    const everyone: Role[][] = [[], ...ROLES.map((r) => [r])];
    for (const roles of everyone) expect(secondFactorScope(roles, on)).toBe('everywhere');
  });

  it('saves the settings only with the version they were edited from, the Site Admins’ left out by an older page', () => {
    expect(mfaPolicySchema.parse({ basedOn: 0, membersRequired: true })).toEqual({ basedOn: 0, membersRequired: true });
    expect(mfaPolicySchema.parse({ basedOn: 2, membersRequired: false, siteAdminsRequired: false })).toEqual({
      basedOn: 2,
      membersRequired: false,
      siteAdminsRequired: false,
    });
    expect(mfaPolicySchema.safeParse({ basedOn: 0, membersRequired: true, siteAdminsRequired: 'no' }).success).toBe(false);
    expect(mfaPolicySchema.safeParse({ membersRequired: true }).success).toBe(false);
    expect(mfaPolicySchema.safeParse({ basedOn: -1, membersRequired: true }).success).toBe(false);
    expect(mfaPolicySchema.safeParse({ basedOn: 0, membersRequired: 'yes' }).success).toBe(false);
  });
});

describe('account deletion entries', () => {
  it('are a known ledger type that Auditors read, like the unlinked logins and revoked roles beside them', () => {
    expect(LEDGER_EVENT_TYPES).toContain('account.deleted');
    for (const type of ['account.deleted', 'identity.unlinked', 'role.revoked'] as const) {
      expect(isPublicLedgerEvent(type)).toBe(false);
    }
  });
});
