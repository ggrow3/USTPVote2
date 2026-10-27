import { z } from 'zod';
import { deny, OK, type Check } from '../check.js';

/**
 * The quote on the home page (design §10.5): a line about voting, set large beside the sign-in card, with who said it
 * and where, so a reader can check it. System Admins change it or switch it off.
 */

/** The most each part may hold once tidied: a quote that still reads as a headline on a phone, and one-line credits. */
export const HOME_QUOTE_LIMITS = { text: 300, attribution: 80, source: 160 } as const;

export interface HomeQuote {
  readonly shown: boolean;
  /** The words, without quotation marks: the page sets them. */
  readonly text: string;
  /** Who said or wrote them. */
  readonly attribution: string;
  /** Where and when (a speech, its place and date), so a reader can check it; may be empty. */
  readonly source: string;
}

/** `home_quote/current`; version 0 (never saved) is the default. */
export interface HomeQuoteRecord extends HomeQuote {
  /** Counts saves, so an edit made from an older copy is refused instead of undoing someone else's. */
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

/** `GET /v1/home-quote`: what the home page shows, without who changed it. */
export type PublicHomeQuote = HomeQuote & { readonly version: number };

/**
 * Franklin D. Roosevelt's Address at Marietta, Ohio, on July 8, 1938, word for word as The American Presidency Project
 * prints it (https://www.presidency.ucsb.edu/documents/address-marietta-ohio). Many popular voting quotes are
 * misattributed; this one is in the published text of the speech.
 */
export const DEFAULT_HOME_QUOTE: HomeQuote = {
  shown: true,
  text: 'The ultimate rulers of our democracy are not a President and Senators and Congressmen and Government officials but the voters of this country.',
  attribution: 'Franklin D. Roosevelt',
  source: 'Address at Marietta, Ohio, July 8, 1938',
};

const OPENING_MARKS = '"“„«';
const CLOSING_MARKS = '"”“»';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The words on one line, without a pair of quotation marks around them (the page adds its own). */
export function tidyQuoteText(text: string): string {
  const line = oneLine(text);
  if (line.length >= 2 && OPENING_MARKS.includes(line[0]!) && CLOSING_MARKS.includes(line.at(-1)!)) {
    return line.slice(1, -1).trim();
  }
  return line;
}

/** Who said it, on one line, without a leading dash (the page sets one). */
export function tidyAttribution(attribution: string): string {
  return oneLine(attribution).replace(/^[-–—―]+\s*/, '');
}

type Stored = { readonly [K in keyof HomeQuote]?: unknown };

/** The quote in force from what was saved, tidied, with the default for anything missing. */
export function resolveHomeQuote(stored: Stored | null | undefined): HomeQuote {
  const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
  return {
    shown: typeof stored?.shown === 'boolean' ? stored.shown : DEFAULT_HOME_QUOTE.shown,
    text: tidyQuoteText(text(stored?.text, DEFAULT_HOME_QUOTE.text)),
    attribution: tidyAttribution(text(stored?.attribution, DEFAULT_HOME_QUOTE.attribution)),
    source: oneLine(text(stored?.source, DEFAULT_HOME_QUOTE.source)),
  };
}

/**
 * Whether a tidied quote can be saved: each part within its limit, and a quote that is shown has its words and who said
 * them. A hidden one may be left incomplete, and keeps its words for when it is shown again.
 */
export function checkHomeQuote(quote: HomeQuote): Check {
  for (const part of ['text', 'attribution', 'source'] as const) {
    if (quote[part].length > HOME_QUOTE_LIMITS[part]) {
      return deny(`the quote's ${part} can be at most ${HOME_QUOTE_LIMITS[part]} characters`);
    }
  }
  if (quote.shown && !quote.text) return deny('a quote needs its words before it can be shown');
  if (quote.shown && !quote.attribution) return deny('a quote needs who said it before it can be shown');
  return OK;
}

/** One part that changed, with its new value, as the ledger records it (`home_quote.changed`). */
export type HomeQuoteChange = { readonly [K in keyof HomeQuote]: { readonly part: K; readonly to: HomeQuote[K] } }[keyof HomeQuote];

/** `home_quote.changed`: the quote's new version and every part that changed in it. */
export interface HomeQuoteChangedPayload {
  readonly version: number;
  readonly changes: readonly HomeQuoteChange[];
}

/** Every part that differs between two quotes, in the form's order. */
export function homeQuoteChanges(before: HomeQuote, after: HomeQuote): HomeQuoteChange[] {
  return (['shown', 'text', 'attribution', 'source'] as const)
    .filter((part) => before[part] !== after[part])
    .map((part) => ({ part, to: after[part] }) as HomeQuoteChange);
}

/** Raw parts are capped well above the limits, which apply once the whitespace and quotation marks are tidied. */
const part = z.string().max(1000);

/** `PUT /v1/admin/home-quote`: the whole quote, and the version it was edited from. */
export const homeQuoteSchema = z.strictObject({
  basedOn: z.number().int().min(0),
  shown: z.boolean(),
  text: part,
  attribution: part,
  source: part,
});
export type HomeQuoteInput = z.infer<typeof homeQuoteSchema>;
