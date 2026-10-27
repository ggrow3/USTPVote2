import { describe, expect, it } from 'vitest';
import {
  checkHomeQuote,
  DEFAULT_HOME_QUOTE,
  HOME_QUOTE_LIMITS,
  homeQuoteChanges,
  homeQuoteSchema,
  resolveHomeQuote,
  tidyAttribution,
  tidyQuoteText,
  type HomeQuote,
} from './home-quote.js';

const quote = (change: Partial<HomeQuote>): HomeQuote => ({ ...DEFAULT_HOME_QUOTE, ...change });

describe('the default', () => {
  it("is FDR's at Marietta, Ohio, word for word, with its source, and shown", () => {
    expect(DEFAULT_HOME_QUOTE).toEqual({
      shown: true,
      text: 'The ultimate rulers of our democracy are not a President and Senators and Congressmen and Government officials but the voters of this country.',
      attribution: 'Franklin D. Roosevelt',
      source: 'Address at Marietta, Ohio, July 8, 1938',
    });
    expect(checkHomeQuote(DEFAULT_HOME_QUOTE)).toEqual({ ok: true });
  });

  it('is already tidy', () => {
    expect(resolveHomeQuote(DEFAULT_HOME_QUOTE)).toEqual(DEFAULT_HOME_QUOTE);
  });
});

describe('tidying', () => {
  it('puts the words on one line and drops quotation marks around them, which the page adds', () => {
    expect(tidyQuoteText('  The vote is\n  the most powerful   instrument ')).toBe('The vote is the most powerful instrument');
    expect(tidyQuoteText('“Vote early.”')).toBe('Vote early.');
    expect(tidyQuoteText('"Vote early."')).toBe('Vote early.');
    expect(tidyQuoteText('„Wählen gehen.“')).toBe('Wählen gehen.');
    expect(tidyQuoteText('« Votez. »')).toBe('Votez.');
  });

  it('keeps quotation marks that do not enclose the whole quote', () => {
    expect(tidyQuoteText('He said “vote” twice')).toBe('He said “vote” twice');
    expect(tidyQuoteText('“Vote,” he said')).toBe('“Vote,” he said');
    expect(tidyQuoteText('"')).toBe('"');
  });

  it('drops a dash before who said it, which the page sets', () => {
    expect(tidyAttribution('— Lyndon B. Johnson')).toBe('Lyndon B. Johnson');
    expect(tidyAttribution('--  Lyndon B.\nJohnson ')).toBe('Lyndon B. Johnson');
    expect(tidyAttribution('Jean-Jacques Rousseau')).toBe('Jean-Jacques Rousseau');
  });

  it('puts the source on one line', () => {
    expect(resolveHomeQuote({ source: ' Remarks,\n  August 6, 1965 ' }).source).toBe('Remarks, August 6, 1965');
  });
});

describe('resolveHomeQuote', () => {
  it('is the default when nothing was saved', () => {
    expect(resolveHomeQuote(null)).toEqual(DEFAULT_HOME_QUOTE);
    expect(resolveHomeQuote(undefined)).toEqual(DEFAULT_HOME_QUOTE);
    expect(resolveHomeQuote({})).toEqual(DEFAULT_HOME_QUOTE);
  });

  it('keeps what was saved, an empty source and a hidden quote included', () => {
    const saved = { shown: false, text: 'Words', attribution: 'Someone', source: '' };
    expect(resolveHomeQuote(saved)).toEqual(saved);
  });

  it('takes the default for a part that is missing or not of its type', () => {
    expect(resolveHomeQuote({ shown: 'no', text: 42, attribution: null, source: undefined })).toEqual(DEFAULT_HOME_QUOTE);
    expect(resolveHomeQuote({ shown: false })).toEqual({ ...DEFAULT_HOME_QUOTE, shown: false });
  });
});

describe('checkHomeQuote', () => {
  it('needs the words and who said them while the quote is shown', () => {
    expect(checkHomeQuote(quote({ text: '' }))).toMatchObject({ ok: false, reason: expect.stringMatching(/needs its words/) });
    expect(checkHomeQuote(quote({ attribution: '' }))).toMatchObject({ ok: false, reason: expect.stringMatching(/needs who said it/) });
  });

  it('lets a hidden quote be incomplete, and any quote go without a source', () => {
    expect(checkHomeQuote(quote({ shown: false, text: '', attribution: '' }))).toEqual({ ok: true });
    expect(checkHomeQuote(quote({ source: '' }))).toEqual({ ok: true });
  });

  it('keeps each part within its limit, shown or not', () => {
    for (const part of ['text', 'attribution', 'source'] as const) {
      const limit = HOME_QUOTE_LIMITS[part];
      expect(checkHomeQuote(quote({ [part]: 'x'.repeat(limit) }))).toEqual({ ok: true });
      expect(checkHomeQuote(quote({ shown: false, [part]: 'x'.repeat(limit + 1) }))).toMatchObject({
        ok: false,
        reason: `the quote's ${part} can be at most ${limit} characters`,
      });
    }
  });

  it('counts the tidied length, so stray spaces and quotation marks do not count against it', () => {
    const padded = `“${'word '.repeat(HOME_QUOTE_LIMITS.text / 5)}   ”`;
    expect(padded.length).toBeGreaterThan(HOME_QUOTE_LIMITS.text);
    expect(checkHomeQuote(resolveHomeQuote({ ...DEFAULT_HOME_QUOTE, text: padded }))).toEqual({ ok: true });
  });
});

describe('homeQuoteChanges', () => {
  it('is nothing when nothing changed', () => {
    expect(homeQuoteChanges(DEFAULT_HOME_QUOTE, resolveHomeQuote(DEFAULT_HOME_QUOTE))).toEqual([]);
  });

  it('lists each changed part with its new value, in the form’s order', () => {
    const after = quote({
      source: 'Remarks in the Capitol Rotunda, August 6, 1965',
      attribution: 'Lyndon B. Johnson',
      text: 'The vote is the most powerful instrument ever devised by man for breaking down injustice',
    });
    expect(homeQuoteChanges(DEFAULT_HOME_QUOTE, after)).toEqual([
      { part: 'text', to: after.text },
      { part: 'attribution', to: 'Lyndon B. Johnson' },
      { part: 'source', to: 'Remarks in the Capitol Rotunda, August 6, 1965' },
    ]);
  });

  it('records switching it off without touching the words', () => {
    expect(homeQuoteChanges(DEFAULT_HOME_QUOTE, quote({ shown: false }))).toEqual([{ part: 'shown', to: false }]);
  });
});

describe('homeQuoteSchema', () => {
  const body = { basedOn: 0, ...DEFAULT_HOME_QUOTE };

  it('takes the whole quote and the version it was edited from', () => {
    expect(homeQuoteSchema.parse(body)).toEqual(body);
  });

  it('refuses a missing part, an unknown one, a missing or negative version, and a runaway length', () => {
    const { source: _, ...noSource } = body;
    expect(homeQuoteSchema.safeParse(noSource).success).toBe(false);
    expect(homeQuoteSchema.safeParse({ ...body, url: 'https://example.test' }).success).toBe(false);
    expect(homeQuoteSchema.safeParse({ ...DEFAULT_HOME_QUOTE }).success).toBe(false);
    expect(homeQuoteSchema.safeParse({ ...body, basedOn: -1 }).success).toBe(false);
    expect(homeQuoteSchema.safeParse({ ...body, text: 'x'.repeat(1001) }).success).toBe(false);
  });
});
