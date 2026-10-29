import { z } from 'zod';
import type { LedgerEvent, LedgerEventType } from '../ledger-events.js';

/**
 * What the parts of the communications context (design §10.9) share: how a text is tidied and capped, addresses,
 * hashtags and the ledger entries its public and member-facing changes make.
 */

/** Blank is none; otherwise trimmed and capped. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `at most ${max} characters`)
    .nullable()
    .default(null)
    .transform((v) => v || null);

/** Trimmed and capped; may be empty. */
export const text = (max: number) => z.string().trim().max(max, `at most ${max} characters`).default('');

/** Trimmed, required and capped. */
export const required = (max: number, missing: string) => z.string().trim().min(1, missing).max(max, `at most ${max} characters`);

/** One line: runs of whitespace (newlines too) become one space. */
export const oneLine = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max, `at most ${max} characters`));

/** A page's address: 2–80 lowercase letters, digits and dashes, starting with a letter or digit. */
export const SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;
export const slugSchema = z.string().regex(SLUG, 'use 2–80 lowercase letters, digits and dashes');

/** A slug from a title: lowercase ASCII words joined by dashes, cut at a word within 60 characters. */
export function slugFrom(title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let slug = '';
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > 60) break;
    slug = next;
  }
  return slug || words[0]?.slice(0, 60) || '';
}

/** The most hashtags a post carries, and how long each may be (without its #). */
export const HASHTAG_LIMITS = { count: 5, length: 40 } as const;

/** A hashtag as stored: letters, digits and underscores, starting with a letter or digit, without the #. */
const HASHTAG = /^[\p{L}\p{N}][\p{L}\p{N}_]*$/u;

/** Hashtags as typed (with or without #), each checked, duplicates (ignoring case) dropped. */
export const hashtagsSchema = z
  .array(
    z
      .string()
      .trim()
      .transform((v) => v.replace(/^#+/, ''))
      .pipe(
        z
          .string()
          .min(1, 'a hashtag needs a word after the #')
          .max(HASHTAG_LIMITS.length, `a hashtag can be at most ${HASHTAG_LIMITS.length} characters`)
          .regex(HASHTAG, 'a hashtag is letters, digits and underscores, with no spaces'),
      ),
  )
  .max(HASHTAG_LIMITS.count, `at most ${HASHTAG_LIMITS.count} hashtags`)
  .default([])
  .transform((tags) => tags.filter((t, i) => tags.findIndex((u) => u.toLowerCase() === t.toLowerCase()) === i));

/** The longest address kept. */
export const URL_LIMIT = 500;

/** Why an address cannot be used, if it cannot: an `https://` address (or, with `pages`, a page of this site). */
export function addressProblem(address: string, pages: boolean): string | null {
  if (address.length > URL_LIMIT) return `an address can be at most ${URL_LIMIT} characters`;
  if (/\s/.test(address)) return 'an address cannot contain spaces';
  if (pages && address.startsWith('/') && !address.startsWith('//')) return null;
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return pages ? 'use a page of this site (/news/…) or an https:// address' : 'use an https:// address';
  }
  if (parsed.protocol === 'https:') return null;
  return parsed.protocol === 'http:' ? 'use the https:// address' : 'use an https:// address';
}

/** An address, or empty for none, checked as `addressProblem` does. */
export const addressSchema = (pages: boolean) =>
  z
    .string()
    .trim()
    .default('')
    .superRefine((v, ctx) => {
      const problem = v && addressProblem(v, pages);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    });

/** An address made absolute: a page of this site gets the site's origin; anything else is kept. */
export function absoluteUrl(address: string, origin: string): string {
  return address.startsWith('/') ? `${origin.replace(/\/$/, '')}${address}` : address;
}

/** `basedOn` for an edit of something already saved. */
export const basedOnSchema = z.number().int().min(1);

/** The fields of `keys` whose values differ between two versions (arrays and objects compared as JSON). */
export function changedFields<K extends string>(keys: readonly K[], before: Readonly<Record<K, unknown>>, after: Readonly<Record<K, unknown>>): K[] {
  return keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

/** A ledger entry about a communications item: Auditors only, like every internal setting (design §8.2). */
export const communicationsEvent = (type: LedgerEventType, actor: string, subject: string | null, payload: object): LedgerEvent => ({
  type,
  actor,
  subject,
  payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
});

/** "someone changed it since you opened it" for an edit made from an older version. */
export const stale = (what: string) => `someone changed the ${what} since you opened it; reload to see their change`;
