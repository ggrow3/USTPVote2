import { z } from 'zod';
import type { District } from './districts.js';

/**
 * A member's own area on the Candidates page (design §5.8): the state on their membership record and the districts its
 * ZIP code reaches into. The api works it out each time it is asked, from the record, so nothing new is stored and the
 * ZIP code is never sent back or put in an address.
 */

/**
 * How the api placed the member: `zip`, in the districts their ZIP code reaches into; otherwise by the state alone,
 * because the record has no ZIP code (`no_zip`), the Census has no area for it in that state (`unplaced`: a PO box's
 * ZIP code has none), or the Census did not answer (`unavailable`).
 */
export const AREA_BASES = ['zip', 'no_zip', 'unplaced', 'unavailable'] as const;
export type AreaBasis = (typeof AREA_BASES)[number];

/** `GET /v1/candidacies/area`: the caller's own area. */
export interface CandidateArea {
  /** The state on the member's record. */
  readonly state: string;
  /** The districts of the listed kinds that the ZIP code reaches into, in kind and name order; empty unless `zip`. */
  readonly districts: readonly District[];
  readonly basis: AreaBasis;
}

/**
 * Whether a candidacy's district is in the member's area: a nationwide office always is, and a statewide one in their
 * state. A district must be one their ZIP code reaches into, or anywhere in their state when the ZIP code could not be
 * placed, so that nobody misses a race on their ballot.
 */
export function inCandidateArea(district: Pick<District, 'kind' | 'geoid' | 'state'>, area: CandidateArea): boolean {
  if (district.kind === 'nation') return true;
  if (district.state !== area.state) return false;
  if (district.kind === 'state' || area.basis !== 'zip') return true;
  return area.districts.some((d) => d.kind === district.kind && d.geoid === district.geoid);
}

/**
 * `POST /v1/public/candidates/area`: a ZIP code anyone types on the Candidates page, to see who runs there. It goes in
 * the body, not the address, so it stays out of request logs; the api works the area out and keeps nothing.
 */
export const areaLookupSchema = z.strictObject({ zip: z.string().trim().regex(/^[0-9]{5}$/, 'enter a five-digit ZIP code') });
export type AreaLookupInput = z.infer<typeof areaLookupSchema>;
