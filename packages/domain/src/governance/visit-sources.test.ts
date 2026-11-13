import { describe, expect, it } from 'vitest';
import { pageVisitSchema } from './page-visits.js';
import {
  campaignTag,
  isDirect,
  landingFrom,
  referrerHost,
  VISIT_TAG_MAX,
  visitSource,
  visitSourceId,
  visitSourcesReport,
  withoutLandingParams,
  type VisitSourceRecord,
} from './visit-sources.js';

describe('where an arrival came from', () => {
  it('keeps a referring site as its host alone, tidied', () => {
    expect(referrerHost('WWW.Facebook.com.')).toBe('facebook.com');
    expect(referrerHost('news.ycombinator.com')).toBe('news.ycombinator.com');
    for (const bad of ['', 'localhost', 'https://x.org/path', 'a b.org', '-x.org', null, undefined]) expect(referrerHost(bad)).toBeNull();
  });

  it('keeps tags in lower case with safe characters, cut short', () => {
    expect(campaignTag('  Spring Sale  2026 ')).toBe('spring sale 2026');
    expect(campaignTag('a<script>')).toBe('a_script_');
    expect(campaignTag('x'.repeat(100))).toHaveLength(VISIT_TAG_MAX);
    expect(campaignTag('')).toBeNull();
  });

  it('is never this site itself, and is direct with nothing', () => {
    const own = visitSource({ referrer: 'www.vote.example', source: 'Mastodon' }, 'vote.example');
    expect(own).toEqual({ referrer: null, source: 'mastodon', medium: null, campaign: null, referral: false });
    expect(isDirect(visitSource({}, 'vote.example'))).toBe(true);
    expect(isDirect(visitSource({ referral: true }, 'vote.example'))).toBe(false);
  });

  it('reads the landing address and the referrer, never the rest of the query', () => {
    const from = landingFrom('?utm_source=mastodon&utm_medium=social&utm_campaign=spring&ref=abcdefgh&token=secret', 'https://social.example/@party/123?q=x', 'vote.example');
    expect(from).toEqual({ referrer: 'social.example', source: 'mastodon', medium: 'social', campaign: 'spring', referral: true });
    expect(JSON.stringify(from)).not.toContain('secret');
    expect(landingFrom('', 'https://vote.example/news', 'vote.example')).toEqual({});
    expect(landingFrom('', 'not a url', 'vote.example')).toEqual({});
  });

  it('takes the tags off the address and leaves the rest', () => {
    expect(withoutLandingParams({ redirect: '/x' })).toBeNull();
    expect(withoutLandingParams({ ref: 'abcdefgh', utm_source: 'a', utm_content: 'b', tab: 'email' })).toEqual({ tab: 'email' });
  });

  it('goes with the visit as fields of its own, loosely, so a strange tag never loses the visit', () => {
    expect(pageVisitSchema.parse({ path: '/news', from: { source: 'x'.repeat(400), referral: true } }).from?.referral).toBe(true);
    expect(pageVisitSchema.safeParse({ path: '/news', from: { source: 'x'.repeat(600) } }).success).toBe(false);
  });
});

describe('the report of where visitors came from', () => {
  const source = (over: Partial<VisitSourceRecord>): VisitSourceRecord => ({
    day: '2026-11-11',
    page: 'hub',
    referrer: null,
    source: null,
    medium: null,
    campaign: null,
    referral: false,
    count: 1,
    ...over,
  });

  it('counts the same arrival on the same record', () => {
    const s = visitSource({ referrer: 'facebook.com' }, null);
    expect(visitSourceId('2026-11-11', 'hub', s)).toBe(visitSourceId('2026-11-11', 'hub', { ...s }));
    expect(visitSourceId('2026-11-11', 'hub', s)).not.toBe(visitSourceId('2026-11-12', 'hub', s));
    expect(visitSourceId('2026-11-11', 'hub', s)).not.toBe(visitSourceId('2026-11-11', 'news', s));
  });

  it('adds up sites, campaigns, referral links, landings and days in the period', () => {
    const report = visitSourcesReport({
      dayList: ['2026-11-10', '2026-11-11'],
      truncated: false,
      records: [
        source({ referrer: 'facebook.com', count: 3 }),
        source({ referrer: 'facebook.com', source: 'facebook', medium: 'social', campaign: 'spring', page: 'news', count: 2 }),
        source({ source: 'newsletter', day: '2026-11-10', count: 4 }),
        source({ referral: true, page: 'register', count: 5 }),
        source({ count: 6 }),
        source({ day: '2026-11-01', referrer: 'old.example', count: 100 }),
      ],
    });
    expect(report).toMatchObject({ arrivals: 20, daily: [4, 16], fromSites: 5, withCampaign: 6, byReferralLink: 5, direct: 6, truncated: false });
    expect(report.sites).toEqual([{ host: 'facebook.com', arrivals: 5 }]);
    expect(report.campaigns).toEqual([
      { source: 'newsletter', medium: null, campaign: null, arrivals: 4 },
      { source: 'facebook', medium: 'social', campaign: 'spring', arrivals: 2 },
    ]);
    expect(report.landings.map((l) => [l.page, l.label, l.arrivals])).toEqual([
      ['hub', 'Link hub', 13],
      ['register', 'Register', 5],
      ['news', 'News', 2],
    ]);
  });
});
