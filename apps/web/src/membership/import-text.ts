import { SKIP_CAUSES, type SkipCause } from 'ustp-domain';

/** Wording for adding members from a file (design §5.13): how many rows were added and skipped, and why. */

/** Each cause as a skipped row is counted under it: "2 missing a needed field". */
export const SKIP_CAUSE_TEXT: Readonly<Record<SkipCause, string>> = {
  missing: 'missing a needed field',
  bad_email: 'with an email address that is not one',
  invalid: 'with another field that breaks the rules',
  duplicate: 'repeating an address from an earlier row',
  on_site: 'already on the site',
};

export const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/**
 * "6 rows skipped: 2 missing a needed field, 1 with an email address that is not one, …", the causes in a fixed
 * order and only those with rows; "no rows skipped" when there are none.
 */
export function skippedText(skippedBy: Readonly<Record<SkipCause, number>>): string {
  const total = SKIP_CAUSES.reduce((sum, c) => sum + skippedBy[c], 0);
  if (!total) return 'no rows skipped';
  const parts = SKIP_CAUSES.filter((c) => skippedBy[c] > 0).map((c) => `${skippedBy[c]} ${SKIP_CAUSE_TEXT[c]}`);
  return `${plural(total, 'row')} skipped: ${parts.join(', ')}`;
}

/** A phrase as a sentence of its own: capital first letter, full stop. */
export function sentence(phrase: string): string {
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
}
