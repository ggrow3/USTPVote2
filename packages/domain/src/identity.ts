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
   * On by default: Site Admins use a second factor on every page, as System Admins do. Off: a Site Admin needs none,
   * whatever other admin role they hold and whether or not `membersRequired` is on.
   */
  readonly siteAdminsRequired: boolean;
  /**
   * Off by default (and on records saved before it existed): while on, System and Site Admins use the admin tools only
   * signed in with Google (`adminSignInRefused`), and those roles are granted only to an account with a Google sign-in.
   */
  readonly adminsGoogleRequired?: boolean;
}

/** The sign-in System and Site Admins must use while `adminsGoogleRequired` is on (design §4). */
export const ADMIN_SIGN_IN_PROVIDER: SignInProvider = 'google.com';

/** Whether these roles are refused the admin tools with this sign-in: a System or Site Admin not signed in with Google, while it is required. */
export function adminSignInRefused(roles: readonly Role[], provider: string, policy: Pick<MfaPolicy, 'adminsGoogleRequired'>): boolean {
  return !!policy.adminsGoogleRequired && administersSite(roles) && provider !== ADMIN_SIGN_IN_PROVIDER;
}

/** `mfa_policy/current`; version 0 (never saved) is the default: the member requirement off, the Site Admins' on. */
export interface MfaPolicyRecord extends MfaPolicy {
  readonly version: number;
  readonly updatedAt: string | null;
  /** The System Admin's accountId; null until someone saves. */
  readonly updatedBy: string | null;
}

export const DEFAULT_MFA_POLICY: MfaPolicy = { membersRequired: false, siteAdminsRequired: true, adminsGoogleRequired: false };

/**
 * `PUT /v1/admin/mfa-policy`: the new settings, and the version they were edited from. Without `siteAdminsRequired` (a
 * page opened before it existed) the Site Admins' setting stays as it is, and so with `adminsGoogleRequired`.
 */
export const mfaPolicySchema = z.object({
  basedOn: z.number().int().min(0),
  membersRequired: z.boolean(),
  siteAdminsRequired: z.boolean().optional(),
  adminsGoogleRequired: z.boolean().optional(),
});
export type MfaPolicyInput = z.infer<typeof mfaPolicySchema>;

/** `mfa_policy.changed`: the settings' new version and values. */
export interface MfaPolicyChangedPayload {
  readonly version: number;
  readonly membersRequired: boolean;
  readonly siteAdminsRequired: boolean;
  /** Absent on entries made before the setting existed. */
  readonly adminsGoogleRequired?: boolean;
}

/**
 * Where someone needs a sign-in with a second factor (design §4):
 * - `everywhere`: every signed-in route but seeing and creating their own account, which they need to set one up.
 *   System Admins always, whatever the settings say; Site Admins unless their setting is off; everyone else while the
 *   member requirement is on.
 * - `admin`: the admin routes only, as for every other admin role.
 * - `none`: nowhere, for members without a role while the requirement is off, and for a Site Admin while theirs is
 *   off, whatever other admin role they hold and whether or not the member requirement is on (the user's decision,
 *   2026-11-14).
 */
export type SecondFactorScope = 'everywhere' | 'admin' | 'none';

export function secondFactorScope(roles: readonly Role[], policy: MfaPolicy): SecondFactorScope {
  if (roles.includes('system_admin')) return 'everywhere';
  if (roles.includes('site_admin')) return policy.siteAdminsRequired ? 'everywhere' : 'none';
  if (policy.membersRequired) return 'everywhere';
  return roles.length > 0 ? 'admin' : 'none';
}
