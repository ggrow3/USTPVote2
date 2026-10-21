/** Outcome of a domain rule check. Rules return reasons instead of throwing so callers can map them to API errors. */
export type Check = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export const OK: Check = { ok: true };

export function deny(reason: string): Check {
  return { ok: false, reason };
}
