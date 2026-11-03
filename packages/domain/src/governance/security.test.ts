import { describe, expect, it } from 'vitest';
import { analyticsAllowed, clientAddress, describeUserAgent, siteAnalyticsSchema } from './security.js';

describe('clientAddress (design §10.7)', () => {
  it('takes the entry just before the trusted proxies', () => {
    expect(clientAddress('198.51.100.7, 35.191.0.1', undefined, 1)).toEqual({ ip: '198.51.100.7', chain: ['198.51.100.7', '35.191.0.1'] });
  });

  it('ignores addresses the client put in front of the chain', () => {
    expect(clientAddress('10.0.0.1, 6.6.6.6, 198.51.100.7, 35.191.0.1', undefined, 1).ip).toBe('198.51.100.7');
  });

  it('counts the hops it is told to trust', () => {
    expect(clientAddress('198.51.100.7, 35.191.0.1', undefined, 0).ip).toBe('35.191.0.1');
    expect(clientAddress('203.0.113.9, 198.51.100.7, 35.191.0.1, 35.191.0.2', undefined, 2).ip).toBe('198.51.100.7');
  });

  it('takes the first entry when the chain is shorter than the trusted hops', () => {
    expect(clientAddress('198.51.100.7', undefined, 1)).toEqual({ ip: '198.51.100.7', chain: ['198.51.100.7'] });
  });

  it('joins repeated headers and falls back to the socket peer', () => {
    expect(clientAddress(['203.0.113.9', '198.51.100.7, 35.191.0.1'], undefined, 1).ip).toBe('198.51.100.7');
    expect(clientAddress(undefined, '::ffff:127.0.0.1', 1)).toEqual({ ip: '127.0.0.1', chain: [] });
    expect(clientAddress('', undefined, 1)).toEqual({ ip: null, chain: [] });
  });

  it('keeps IPv6 addresses and at most ten entries', () => {
    expect(clientAddress('2001:db8::1, 35.191.0.1', undefined, 1).ip).toBe('2001:db8::1');
    const long = Array.from({ length: 15 }, (_, i) => `10.0.0.${i}`).join(',');
    expect(clientAddress(long, undefined, 1).chain).toHaveLength(10);
  });
});

describe('describeUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Chrome on Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0', 'Edge on Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari on iOS'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on macOS'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['curl/8.4.0', 'Other'],
  ])('%s', (ua, expected) => {
    expect(describeUserAgent(ua)).toBe(expected);
  });

  it('says Unknown with no user agent', () => {
    expect(describeUserAgent(null)).toBe('Unknown');
  });
});

describe('site analytics', () => {
  it('accepts a measurement ID, tidied, or null to switch analytics off', () => {
    expect(siteAnalyticsSchema.parse({ basedOn: 0, measurementId: ' g-abc123xyz9 ' })).toEqual({ basedOn: 0, measurementId: 'G-ABC123XYZ9' });
    expect(siteAnalyticsSchema.parse({ basedOn: 2, measurementId: null })).toEqual({ basedOn: 2, measurementId: null });
  });

  it('refuses anything else', () => {
    for (const id of ['UA-12345-1', 'G-', 'GTM-ABC123', 'G-ABC 123', '<script>']) {
      expect(siteAnalyticsSchema.safeParse({ basedOn: 0, measurementId: id }).success).toBe(false);
    }
  });

  it('never counts the ballot, receipts, sign-in, account email links, the account page or the admin console', () => {
    for (const path of ['/ballot', '/ballot/01a17d23', '/verify', '/signin', '/email-action', '/account', '/admin', '/admin/elections/x']) {
      expect(analyticsAllowed(path)).toBe(false);
    }
    for (const path of ['/', '/vote', '/register', '/offices', '/results/01a17d23', '/course', '/ballots-explained']) {
      expect(analyticsAllowed(path)).toBe(true);
    }
  });
});
