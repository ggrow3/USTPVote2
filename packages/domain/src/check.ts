import type { ProblemCode } from './problems.js';

/** Outcome of a domain rule check. Rules return reasons instead of throwing so callers can map them to API errors. */
export type Check =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly code?: ProblemCode };

export const OK: Check = { ok: true };

/** `code` marks failures the caller can fix by acting (e.g. signing in again), so clients can react to them. */
export function deny(reason: string, code?: ProblemCode): Check {
  return code ? { ok: false, reason, code } : { ok: false, reason };
}
