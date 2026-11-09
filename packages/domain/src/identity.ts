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

// --- Two-step verification (design §4) -------------------------------------------------------------------------------

/** A site setting System Admins switch: whether everyone, not only admins, must sign in with a second factor. */
export interface MfaPolicy {
  /** Off by default: members without an admin role may sign in with one factor. */
  readonly membersRequired: boolean;
}

/** `mfa_policy/current`; version 0 (never saved) is the default, the requirement off. */
export interface MfaPolicyRecord extends MfaPolicy {
  readonly version: number;
  readonly updatedAt: string | null;
  /** The System Admin's accountId; null until someone saves. */
  readonly updatedBy: string | null;
}

export const DEFAULT_MFA_POLICY: MfaPolicy = { membersRequired: false };

/** `PUT /v1/admin/mfa-policy`: the new setting, and the version it was edited from. */
export const mfaPolicySchema = z.object({
  basedOn: z.number().int().min(0),
  membersRequired: z.boolean(),
});
export type MfaPolicyInput = z.infer<typeof mfaPolicySchema>;

/** `mfa_policy.changed`: the setting's new version and value. */
export interface MfaPolicyChangedPayload {
  readonly version: number;
  readonly membersRequired: boolean;
}

/**
 * Where someone needs a sign-in with a second factor (design §4):
 * - `everywhere`: every signed-in route but seeing and creating their own account, which they need to set one up.
 *   System Admins and Site Admins always, whatever the setting says; everyone else while the member requirement is on.
 * - `admin`: the admin routes only, as for every other admin role.
 * - `none`: nowhere, for members without a role while the requirement is off.
 */
export type SecondFactorScope = 'everywhere' | 'admin' | 'none';

export function secondFactorScope(roles: readonly Role[], policy: MfaPolicy): SecondFactorScope {
  if (administersSite(roles) || policy.membersRequired) return 'everywhere';
  return roles.length > 0 ? 'admin' : 'none';
}
