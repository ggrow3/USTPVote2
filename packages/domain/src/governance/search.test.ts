import { describe, expect, it } from 'vitest';
import { crawlAllowed, robotsTxt, SITEMAP_PAGES, sitemapEntries, sitemapXml } from './search.js';

const SITE = 'https://vote.example.org';

describe('crawlAllowed', () => {
  it('opens production at its own origin only', () => {
    expect(crawlAllowed({ environment: 'prod', webOrigin: SITE }, SITE)).toBe(true);
    expect(crawlAllowed({ environment: 'prod', webOrigin: SITE }, 'https://ustpvote2-prod.firebaseapp.com')).toBe(false);
  });

  it('opens production at any origin when none is configured', () => {
    expect(crawlAllowed({ environment: 'prod', webOrigin: null }, 'https://ustpvote2-prod.web.app')).toBe(true);
  });

  it('keeps every other deployment closed', () => {
    for (const environment of ['dev', 'staging', null] as const) {
      expect(crawlAllowed({ environment, webOrigin: SITE }, SITE)).toBe(false);
    }
  });
});

describe('robotsTxt', () => {
  it('points at the sitemap and keeps crawlers off the MCP server and Firebase paths, but not the api', () => {
    const text = robotsTxt(SITE, true);
    expect(text).toContain('User-agent: *\nDisallow: /mcp\nDisallow: /__/\n');
    expect(text).toContain(`Sitemap: ${SITE}/sitemap.xml\n`);
    expect(text).not.toMatch(/Disallow: \/v1|Disallow: \/$/m);
  });

  it('turns everyone away from a closed site', () => {
    const text = robotsTxt(SITE, false);
    expect(text).toMatch(/^User-agent: \*\nDisallow: \/$/m);
    expect(text).not.toContain('Sitemap');
  });
});

describe('sitemap', () => {
  const bylaws = [
    { version: '2.0', publishedAt: '2026-10-20T10:00:00.000Z' },
    { version: '1.0', publishedAt: '2026-01-05T10:00:00.000Z' },
  ];
  const results = [{ electionId: '01a17d23-ede7-7c0b-ac92-38c52a360a9b', certifiedAt: '2026-10-27T22:30:00.000Z' }];

  it('lists the public pages, each bylaws version and each certified result', () => {
    const entries = sitemapEntries(bylaws, results);
    expect(entries.map((e) => e.path)).toEqual([
      ...SITEMAP_PAGES,
      '/bylaws/2.0',
      '/bylaws/1.0',
      '/results/01a17d23-ede7-7c0b-ac92-38c52a360a9b',
    ]);
    expect(entries.find((e) => e.path === '/bylaws')?.lastModified).toBe('2026-10-20T10:00:00.000Z');
    expect(entries.find((e) => e.path === '/')).toEqual({ path: '/' });
    expect(entries.at(-1)?.lastModified).toBe('2026-10-27T22:30:00.000Z');
  });

  it('has no date for the bylaws page before any are published', () => {
    expect(sitemapEntries([], []).find((e) => e.path === '/bylaws')).toEqual({ path: '/bylaws' });
  });

  it('writes absolute, escaped addresses', () => {
    const text = sitemapXml(SITE, [{ path: '/' }, { path: '/a?b=1&c=<2>', lastModified: '2026-10-20T10:00:00.000Z' }]);
    expect(text).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        `  <url><loc>${SITE}/</loc></url>`,
        `  <url><loc>${SITE}/a?b=1&amp;c=&lt;2&gt;</loc><lastmod>2026-10-20T10:00:00.000Z</lastmod></url>`,
        '</urlset>',
        '',
      ].join('\n'),
    );
  });
});
