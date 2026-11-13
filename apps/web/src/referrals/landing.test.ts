import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REFERRAL_KEPT_DAYS } from 'ustp-domain';
import { forgetReferral, keepReferral, keptReferral, takeLanding } from './landing.js';

/** A browser's storage, enough for these tests (they run in Node). */
class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

const g = globalThis as unknown as { window?: unknown };

describe('what the web app takes from the landing address (design §5.18, §10.7)', () => {
  beforeEach(() => {
    g.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() };
  });
  afterEach(() => {
    delete g.window;
  });

  it('keeps a referral code for 30 days, the newest link winning, and forgets it after the application', () => {
    const now = new Date('2026-11-12T00:00:00.000Z');
    keepReferral('not a code', now);
    expect(keptReferral(now)).toBeNull();
    keepReferral('abcdefgh', now);
    keepReferral('hgfedcba', now);
    expect(keptReferral(now)).toBe('hgfedcba');
    expect(keptReferral(new Date(now.getTime() + (REFERRAL_KEPT_DAYS - 1) * 86_400_000))).toBe('hgfedcba');
    expect(keptReferral(new Date(now.getTime() + REFERRAL_KEPT_DAYS * 86_400_000))).toBeNull();
    keepReferral('abcdefgh', now);
    forgetReferral();
    expect(keptReferral(now)).toBeNull();
  });

  it('says where a tab came from once, so a reload is not counted again', () => {
    expect(takeLanding('?utm_source=x', 'https://facebook.com/', 'vote.example')).toEqual({ referrer: 'facebook.com', source: 'x' });
    expect(takeLanding('?utm_source=x', 'https://facebook.com/', 'vote.example')).toBeNull();
  });

  it('counts nothing where storage is blocked', () => {
    g.window = {
      get localStorage(): never {
        throw new Error('blocked');
      },
      get sessionStorage(): never {
        throw new Error('blocked');
      },
    };
    keepReferral('abcdefgh');
    expect(keptReferral()).toBeNull();
    expect(takeLanding('?utm_source=x', '', 'vote.example')).toBeNull();
  });
});
