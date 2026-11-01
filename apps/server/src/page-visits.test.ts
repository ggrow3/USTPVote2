import { describe, expect, it } from 'vitest';
import { VisitRateLimiter } from './security/page-visits.js';

describe('VisitRateLimiter (design §10.7)', () => {
  it('lets each key have its share of a minute, then refuses it until the next minute', () => {
    const limiter = new VisitRateLimiter({ visits: 2, windowMs: 60_000 });
    const t = 1_800_000_000_000;
    expect([limiter.take('a', t), limiter.take('a', t + 1), limiter.take('a', t + 2)]).toEqual([true, true, false]);
    expect(limiter.take('b', t + 3)).toBe(true);
    expect(limiter.take('a', t + 60_000)).toBe(true);
  });

  it('starts afresh when told to forget', () => {
    const limiter = new VisitRateLimiter({ visits: 1, windowMs: 60_000 });
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 1)).toBe(false);
    limiter.forget();
    expect(limiter.take('a', 2)).toBe(true);
  });
});
