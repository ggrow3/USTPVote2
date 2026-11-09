import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PREVIEW_PAGES, SITEMAP_PAGES } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { canonicalUrl, DESCRIBED_ROUTES, pageSeo, servedDescription, SITE_DESCRIPTION } from './seo.js';

const route = (path: string, meta: Record<string, unknown> = {}) => ({ matched: [{ path: '/' }, { path }], meta });

describe('pageSeo', () => {
  it('describes public pages and lets search engines list them', () => {
    expect(pageSeo(route('/register'))).toEqual({ description: 'Apply to become a member of the U.S. Transhumanist Party.', listed: true });
    expect(pageSeo(route('/results/:id')).listed).toBe(true);
  });

  it('keeps pages behind sign-in out of search results', () => {
    expect(pageSeo(route('/account', { requiresAuth: true })).listed).toBe(false);
    expect(pageSeo(route('/admin/elections/:id', { requiresAuth: true, roles: ['election_admin'] })).listed).toBe(false);
  });

  it('keeps signing in, account email links and certificates out too, though anyone may open them', () => {
    expect(pageSeo(route('/signin')).listed).toBe(false);
    expect(pageSeo(route('/email-action')).listed).toBe(false);
    expect(pageSeo(route('/course/certificates/:id')).listed).toBe(false);
  });

  it('falls back to the site description', () => {
    expect(pageSeo(route('/teams', { requiresAuth: true })).description).toBe(SITE_DESCRIPTION);
  });
});

describe('canonicalUrl', () => {
  it('drops a trailing slash but keeps the root', () => {
    expect(canonicalUrl('https://vote.example.org', '/vote/')).toBe('https://vote.example.org/vote');
    expect(canonicalUrl('https://vote.example.org', '/')).toBe('https://vote.example.org/');
  });
});

describe('servedDescription', () => {
  it("keeps the description the api wrote for the page opened, and only for that page", () => {
    expect(servedDescription('https://vote.example.org/news/hello', 'A post', '/news/hello')).toBe('A post');
    expect(servedDescription('https://vote.example.org/news/hello', 'A post', '/news/hello/')).toBe('A post');
    expect(servedDescription('https://vote.example.org/news/hello', 'A post', '/news/other')).toBeNull();
    expect(servedDescription(undefined, SITE_DESCRIPTION, '/news/hello')).toBeNull();
    expect(servedDescription('not a url', 'A post', '/news/hello')).toBeNull();
  });
});

describe('index.html', () => {
  it('describes the site as the pages do, for link previews too', () => {
    const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');
    expect(html.split(`content="${SITE_DESCRIPTION}"`)).toHaveLength(3);
  });
});

describe('the routes', () => {
  const router = readFileSync(join(import.meta.dirname, 'router.ts'), 'utf8');
  /** A route path as a regular expression for the addresses it matches. */
  const matcher = (path: string) =>
    new RegExp(`^${path.replace(/\/:\w+\?/g, '(?:/[^/]+)?').replace(/:\w+/g, '[^/]+')}$`);

  it('are in router.ts as this module names them', () => {
    for (const path of DESCRIBED_ROUTES) expect(router, path).toContain(`path: '${path.slice(1)}'`);
  });

  it('include every sitemap page, described and listed', () => {
    for (const page of SITEMAP_PAGES) {
      const path = DESCRIBED_ROUTES.find((p) => matcher(p).test(page));
      expect(path, page).toBeDefined();
      expect(pageSeo(route(path!)).listed, page).toBe(true);
    }
  });
});

describe('link previews', () => {
  it('are written by the api for public pages of the router (design §15, "Link previews")', () => {
    const router = readFileSync(join(import.meta.dirname, 'router.ts'), 'utf8');
    for (const page of PREVIEW_PAGES) {
      const line = router.split('\n').find((l) => l.includes(`path: '${page.slice(1)}'`));
      expect(line, page).toBeDefined();
      expect(line, page).not.toMatch(/requiresAuth|roles/);
    }
  });
});
