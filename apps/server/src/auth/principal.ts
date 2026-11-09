import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Actor, Role } from 'ustp-domain';

/** Who is calling, as proven by their verified Identity Platform ID token. */
export interface Principal {
  readonly uid: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly name: string | null;
  /** `firebase.sign_in_provider`, e.g. `google.com` or `password`. */
  readonly provider: string;
  /** The token was issued after a second factor. */
  readonly mfa: boolean;
  /** `auth_time`: when the user last actually signed in, Unix seconds. */
  readonly authTime: number;
}

export function principalFromToken(token: DecodedIdToken): Principal {
  return {
    uid: token.uid,
    email: token.email?.toLowerCase() ?? null,
    emailVerified: token.email_verified === true,
    name: typeof token.name === 'string' ? token.name : null,
    provider: token.firebase.sign_in_provider,
    mfa: Boolean(token.firebase.sign_in_second_factor),
    authTime: token.auth_time,
  };
}

/** Attached to every authenticated request by the AuthGuard. */
export interface RequestContext {
  readonly principal: Principal;
  /** The caller's USTP account, or null before `POST /v1/accounts`. */
  readonly accountId: string | null;
  /** Active roles; loaded only for routes that require a role. */
  readonly roles: readonly Role[];
  /**
   * In testing mode, the System Admin's own accountId when they act as a test persona (design §10.4); `accountId`
   * and `roles` are then the persona's. Null otherwise.
   */
  readonly operator: string | null;
  /**
   * An admin route let a sign-in without a second factor through, because the caller is a Site Admin whose role asks for
   * none (the Site Admins' setting off, design §4); the checks that ask for a multi-factor sign-in treat it as one.
   */
  readonly secondFactorWaived?: boolean;
}

/** The caller as the two-person rule sees them (ustp-domain). */
export function actorOf(ctx: RequestContext, adminMfaRequired: boolean, nowMs: number = Date.now()): Actor {
  return {
    accountId: ctx.accountId ?? '',
    roles: ctx.roles,
    // With the MFA requirement switched off (emulators only), or waived for this Site Admin, treat the sign-in as multi-factor.
    mfa: ctx.principal.mfa || !adminMfaRequired || ctx.secondFactorWaived === true,
    authAgeSeconds: Math.max(0, Math.floor(nowMs / 1000) - ctx.principal.authTime),
  };
}
