import type { BylawsRecord } from './records.js';

/**
 * The bylaws applicants are shown and agree to (design §5.2): the current version, unless none has been published or
 * its text is blank, which a Membership Admin publishes by clearing the bylaws field under Admin › Registration form.
 * Then the Register page shows no bylaws, an application agrees to none (its `bylawsVersion` is null), and so does a
 * member added by a Membership Admin or a test voter.
 */
export function bylawsInForce<T extends Pick<BylawsRecord, 'text'>>(current: T | null | undefined): T | null {
  return current && current.text.trim() ? current : null;
}

/** The text as published: whitespace alone is blank (`''`), anything else is kept exactly as written. */
export function publishedBylawsText(text: string): string {
  return text.trim() ? text : '';
}

/**
 * The version a new one is published as when the bylaws field is saved: the last number in the current version's name
 * one higher ("2" → "3", "2026.1" → "2026.2"), ".1" appended to a name without one, and "1" for the first.
 */
export function nextBylawsVersion(current: string | null | undefined): string {
  if (!current) return '1';
  const m = /^(.*?)(\d+)$/.exec(current);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${current}.1`;
}
