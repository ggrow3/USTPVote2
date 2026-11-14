import { z } from 'zod';
import { administersSite, type Role } from './roles.js';

/**
 * Identity Platform providers the system accepts, by the ID token's `firebase.sign_in_provider` claim
 * (design §4). Passwordless email link and email/password both report `password`, so switching between
 * those two is done in Identity Platform's own configuration; the API switch covers both.
 */
export const SIGN_IN_PROVIDERS = ['google.com', 'microsoft.com', 'apple.com', 'password'] as const;
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];

export function isSignInProvider(value: unknown): value is SignInProvider {
  return typeof value === 'string' && (SIGN_IN_PROVIDERS as readonly string[]).includes(value);
}

/** The providers someone signs in with instead of a password, in the order the site offers them. */
export const FEDERATED_PROVIDERS = ['google.com', 'microsoft.com', 'apple.com'] as const;
export type FederatedProvider = (typeof FEDERATED_PROVIDERS)[number];

export const FEDERATED_PROVIDER_NAMES: Readonly<Record<FederatedProvider, string>> = {
  'google.com': 'Google',
  'microsoft.com': 'Microsoft',
  'apple.com': 'Apple',
};

/** The federated providers System Admins have switched on (design §4), in the site's order. */
export function enabledFederatedProviders(enabled: Readonly<Partial<Record<SignInProvider, boolean>>>): FederatedProvider[] {
  return FEDERATED_PROVIDERS.filter((p) => enabled[p] === true);
}

/** "Google", "Google or Microsoft", "Google, Microsoft or Apple". */
export function providerNames(providers: readonly FederatedProvider[]): string {
  const names = providers.map((p) => FEDERATED_PROVIDER_NAMES[p]);
  return names.length <= 2 ? names.join(' or ') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

// --- Two-step verification (design §4) -------------------------------------------------------------------------------

/**
 * Site settings System Admins switch: whether everyone, not only admins, must sign in with a second factor, and whether
 * Site Admins must (design §4).
 */
export interface MfaPolicy {
  /** Off by default: members without an admin role may sign in with one factor. */
  readonly membersRequired: boolean;
  /**
   * On by default: Site Admins use a second factor on every page, as System Admins do. Off: the Site Admin role asks for
   * none, so a Site Admin with no other admin role needs one only while `membersRequired` is on.
   */
  readonly siteAdminsRequired: boolean;
}

/** `mfa_policy/current`; version 0 (never saved) is the default: the member requirement off, the Site Admins' on. */
export interface MfaPolicyRecord extends MfaPolicy {
  readonly version: number;
  readonly updatedAt: string | null;
  /** The System Admin's accountId; null until someone saves. */
  readonly updatedBy: string | null;
}

export const DEFAULT_MFA_POLICY: MfaPolicy = { membersRequired: false, siteAdminsRequired: true };

/**
 * `PUT /v1/admin/mfa-policy`: the new settings, and the version they were edited from. Without `siteAdminsRequired` (a
 * page opened before it existed) the Site Admins' setting stays as it is.
 */
export const mfaPolicySchema = z.object({
  basedOn: z.number().int().min(0),
  membersRequired: z.boolean(),
  siteAdminsRequired: z.boolean().optional(),
});
export type MfaPolicyInput = z.infer<typeof mfaPolicySchema>;

/** `mfa_policy.changed`: the settings' new version and values. */
export interface MfaPolicyChangedPayload {
  readonly version: number;
  readonly membersRequired: boolean;
  readonly siteAdminsRequired: boolean;
}

/**
 * Where someone needs a sign-in with a second factor (design §4):
 * - `everywhere`: every signed-in route but seeing and creating their own account, which they need to set one up.
 *   System Admins always, whatever the settings say; Site Admins unless their setting is off; everyone else while the
 *   member requirement is on.
 * - `admin`: the admin routes only, as for every other admin role.
 * - `none`: nowhere, for members without a role while the requirement is off, and for a Site Admin with no other admin
 *   role while theirs is off.
 */
export type SecondFactorScope = 'everywhere' | 'admin' | 'none';

export function secondFactorScope(roles: readonly Role[], policy: MfaPolicy): SecondFactorScope {
  const held = policy.siteAdminsRequired ? roles : roles.filter((r) => r !== 'site_admin');
  if (administersSite(held) || policy.membersRequired) return 'everywhere';
  return held.length > 0 ? 'admin' : 'none';
}
