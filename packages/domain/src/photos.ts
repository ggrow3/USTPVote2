/**
 * Profile photo quality checks (design §5.3). Signals come from Cloud Vision face detection and SafeSearch; no face
 * recognition or matching is ever performed. The machine only passes or flags: it never rejects. Flagged photos go
 * to a Membership Admin, and only a person can reject one.
 */

/** Cloud Vision's likelihood scale, least to most likely. */
export const LIKELIHOODS = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'] as const;
export type Likelihood = (typeof LIKELIHOODS)[number];

export interface PhotoSignals {
  readonly faceCount: number;
  /** Highest face detection confidence, 0–1 (0 when no face). */
  readonly faceConfidence: number;
  readonly blurred: Likelihood;
  readonly underExposed: Likelihood;
  readonly adult: Likelihood;
  readonly violence: Likelihood;
  readonly racy: Likelihood;
}

export interface PhotoVerdict {
  readonly verdict: 'pass' | 'flag';
  /** Why it was flagged, in words an admin and the member can act on. Empty when it passed. */
  readonly reasons: readonly string[];
}

export const MIN_FACE_CONFIDENCE = 0.6;

function atLeastLikely(value: Likelihood): boolean {
  return LIKELIHOODS.indexOf(value) >= LIKELIHOODS.indexOf('LIKELY');
}

export function photoVerdict(s: PhotoSignals): PhotoVerdict {
  const reasons: string[] = [];
  if (s.faceCount === 0) reasons.push('no face found');
  else if (s.faceCount > 1) reasons.push('more than one face');
  else if (s.faceConfidence < MIN_FACE_CONFIDENCE) reasons.push('face not clearly visible');
  if (atLeastLikely(s.blurred)) reasons.push('blurry');
  if (atLeastLikely(s.underExposed)) reasons.push('too dark');
  if (atLeastLikely(s.adult) || atLeastLikely(s.violence) || atLeastLikely(s.racy)) reasons.push('may be inappropriate');
  return { verdict: reasons.length ? 'flag' : 'pass', reasons };
}

export function isLikelihood(value: unknown): value is Likelihood {
  return typeof value === 'string' && (LIKELIHOODS as readonly string[]).includes(value);
}
