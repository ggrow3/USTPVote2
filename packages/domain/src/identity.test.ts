import { describe, expect, it } from 'vitest';
import { DEFAULT_MFA_POLICY, isSignInProvider, mfaPolicySchema, secondFactorScope } from './identity.js';
import { ROLES, type Role } from './roles.js';

describe('sign-in providers', () => {
  it('accepts only the providers the site offers', () => {
    expect(isSignInProvider('google.com')).toBe(true);
    expect(isSignInProvider('password')).toBe(true);
    for (const other of ['phone', 'anonymous', 'custom', '', null]) expect(isSignInProvider(other)).toBe(false);
  });
});

describe('two-step verification policy', () => {
  const off = DEFAULT_MFA_POLICY;
  const on = { membersRequired: true };

  it('is off for members by default', () => {
    expect(DEFAULT_MFA_POLICY).toEqual({ membersRequired: false });
    expect(secondFactorScope([], off)).toBe('none');
  });

  it('always requires System Admins to use a second factor everywhere, whatever the setting says', () => {
    for (const policy of [off, on]) {
      expect(secondFactorScope(['system_admin'], policy)).toBe('everywhere');
      expect(secondFactorScope(['membership_admin', 'system_admin'], policy)).toBe('everywhere');
    }
  });

  it('keeps every other admin role to a second factor for the admin tools while the setting is off', () => {
    for (const role of ROLES.filter((r) => r !== 'system_admin')) {
      expect(secondFactorScope([role], off)).toBe('admin');
    }
    expect(secondFactorScope(['membership_admin', 'election_admin'], off)).toBe('admin');
  });

  it('requires everyone to use a second factor everywhere while the setting is on', () => {
    const everyone: Role[][] = [[], ...ROLES.map((r) => [r])];
    for (const roles of everyone) expect(secondFactorScope(roles, on)).toBe('everywhere');
  });

  it('saves the setting only with the version it was edited from', () => {
    expect(mfaPolicySchema.parse({ basedOn: 0, membersRequired: true })).toEqual({ basedOn: 0, membersRequired: true });
    expect(mfaPolicySchema.safeParse({ membersRequired: true }).success).toBe(false);
    expect(mfaPolicySchema.safeParse({ basedOn: -1, membersRequired: true }).success).toBe(false);
    expect(mfaPolicySchema.safeParse({ basedOn: 0, membersRequired: 'yes' }).success).toBe(false);
  });
});
