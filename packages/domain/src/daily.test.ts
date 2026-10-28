import { describe, expect, it } from 'vitest';
import { accountPreferencesSchema, DAILY_JOKES, DAILY_QUOTES, dailyPick, dayNumber, preferencesOf } from './daily.js';

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

describe('daily quote and joke', () => {
  it('gives everyone the same pair on the same calendar day, and a new pair the next day', () => {
    const morning = new Date(2026, 9, 28, 7, 30);
    const evening = new Date(2026, 9, 28, 23, 59);
    const tomorrow = new Date(2026, 9, 29, 0, 1);
    expect(dailyPick(evening)).toEqual(dailyPick(morning));
    expect(dailyPick(tomorrow).quote).not.toEqual(dailyPick(morning).quote);
    expect(dailyPick(tomorrow).joke).not.toEqual(dailyPick(morning).joke);
  });

  it('turns over at local midnight and counts days from 1970', () => {
    expect(dayNumber(new Date(1970, 0, 1, 12))).toBe(0);
    expect(dayNumber(new Date(2026, 9, 29, 0, 0)) - dayNumber(new Date(2026, 9, 28, 23, 59))).toBe(1);
  });

  it('reaches every quote and joke, and repeats a pair only after the two list lengths multiplied', () => {
    expect(gcd(DAILY_QUOTES.length, DAILY_JOKES.length)).toBe(1);
    const start = new Date(2026, 0, 1);
    const days = DAILY_QUOTES.length * DAILY_JOKES.length;
    const pairs = new Set<string>();
    for (let i = 0; i < days; i++) {
      const { quote, joke } = dailyPick(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
      pairs.add(`${quote.text}|${joke.setup}`);
    }
    expect(pairs.size).toBe(days);
  });

  it('attributes every quote and has no blank or duplicate entries', () => {
    for (const q of DAILY_QUOTES) {
      expect(q.text.trim() && q.author.trim() && q.source.trim()).toBeTruthy();
    }
    for (const j of DAILY_JOKES) expect(j.setup.trim() && j.punchline.trim()).toBeTruthy();
    expect(new Set(DAILY_QUOTES.map((q) => q.text)).size).toBe(DAILY_QUOTES.length);
    expect(new Set(DAILY_JOKES.map((j) => j.setup)).size).toBe(DAILY_JOKES.length);
  });
});

describe('account preferences', () => {
  it('are off until the person turns the daily quote on', () => {
    expect(preferencesOf(null)).toEqual({ dailyQuote: false });
    expect(preferencesOf({})).toEqual({ dailyQuote: false });
    expect(preferencesOf({ preferences: { dailyQuote: true } })).toEqual({ dailyQuote: true });
  });

  it('accept exactly the known choices', () => {
    expect(accountPreferencesSchema.safeParse({ dailyQuote: true }).success).toBe(true);
    expect(accountPreferencesSchema.safeParse({}).success).toBe(false);
    expect(accountPreferencesSchema.safeParse({ dailyQuote: 'yes' }).success).toBe(false);
    expect(accountPreferencesSchema.safeParse({ dailyQuote: true, theme: 'dark' }).success).toBe(false);
  });
});
