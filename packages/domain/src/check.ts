import type { ProblemCode } from './problems.js';

/**
 * What kind of refusal a failed rule is, so the API answers with the status it always has: who you are (`forbidden`),
 * something missing (`not_found`), the state things are in (`conflict`, also the default), or too many attempts
 * (`rate_limited`).
 */
export type Refusal = 'forbidden' | 'not_found' | 'conflict' | 'rate_limited';

/** Outcome of a domain rule check. Rules return reasons instead of throwing so callers can map them to API errors. */
export type Check =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly code?: ProblemCode; readonly refusal?: Refusal };

export type Refused = Extract<Check, { readonly ok: false }>;

/** What a command on an aggregate gives: the records it produces, or why it was refused. */
export type Outcome<T> = { readonly ok: true; readonly value: T } | Refused;

export const OK: Check = { ok: true };

/** `code` marks failures the caller can fix by acting (e.g. signing in again), so clients can react to them. */
export function deny(reason: string, code?: ProblemCode): Check {
  return code ? { ok: false, reason, code } : { ok: false, reason };
}

export function refuse(refusal: Refusal, reason: string): Refused {
  return { ok: false, reason, refusal };
}
