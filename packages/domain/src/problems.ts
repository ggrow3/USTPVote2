/**
 * Machine-readable RFC 9457 problem types the web app reacts to. Values are relative URI references, as RFC 9457
 * allows; everything else uses `about:blank`.
 */
export const PROBLEM_TYPES = {
  /** The route needs an ID token issued after a second factor: set one up, then sign in again. */
  mfaRequired: '/problems/mfa-required',
  /** The sign-in is too old for this action: re-authenticate, then retry. */
  reauthRequired: '/problems/reauth-required',
} as const;

export type ProblemCode = keyof typeof PROBLEM_TYPES;
