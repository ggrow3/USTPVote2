/**
 * What search engines are told about the site (design §15, "Search engines"). Only production, at its own origin, is
 * open to them: dev and staging hold test data, and the site's other addresses (`<project>.firebaseapp.com`, say)
 * would only list the same pages twice. The api serves robots.txt and sitemap.xml from these; the web app marks each
 * page with its description, canonical address and, for pages behind sign-in, `noindex`.
 */

/** The web app's pages that are the same for everyone, as the sitemap lists them. */
export const SITEMAP_PAGES = [
  '/',
  '/vote',
  '/register',
  '/courses',
  '/course/transhumanism',
  '/bylaws',
  '/offices',
  '/verify',
  '/events',
  '/partners',
  '/legislation',
  '/scorecard',
] as const;

/**
 * Paths no search engine needs: the reporting MCP server and Firebase's reserved paths. `/v1/**` stays open, since a
 * search engine renders the pages and needs their data; every api response says `noindex` instead.
 */
export const CRAWL_DISALLOWED = ['/mcp', '/__/'] as const;

/** Where a deployment runs: its environment, and the origin its web app is served at, when configured. */
export interface SearchSite {
  readonly environment: 'dev' | 'staging' | 'prod' | null;
  readonly webOrigin: string | null;
}

/** Whether search engines may crawl the site at `origin`: production only, and only at its configured origin. */
export function crawlAllowed(site: SearchSite, origin: string): boolean {
  return site.environment === 'prod' && (site.webOrigin === null || site.webOrigin === origin);
}

/** robots.txt for the site at `origin`. */
export function robotsTxt(origin: string, allowed: boolean): string {
  if (!allowed) {
    return ['# Not the public USTP Vote site (a test deployment, or another address for it): search engines stay out.', 'User-agent: *', 'Disallow: /', ''].join('\n');
  }
  return [
    '# USTP Vote. Pages behind sign-in say noindex.',
    'User-agent: *',
    ...CRAWL_DISALLOWED.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

export interface SitemapEntry {
  readonly path: string;
  /** When the page last changed, ISO 8601; absent when unknown. */
  readonly lastModified?: string;
}

/**
 * The sitemap's pages: the pages for everyone, each published bylaws version, each election's certified results,
 * which stay public for good, and each bill on the public Legislation page. The bylaws page shows the newest version,
 * so it changed when that was published.
 */
export function sitemapEntries(
  bylaws: readonly { readonly version: string; readonly publishedAt: string }[],
  results: readonly { readonly electionId: string; readonly certifiedAt: string | null }[],
  bills: readonly { readonly billId: string; readonly lastModified: string }[] = [],
): SitemapEntry[] {
  const newest = bylaws.reduce<string | undefined>((latest, b) => (!latest || b.publishedAt > latest ? b.publishedAt : latest), undefined);
  const dated = (path: string, at: string | null | undefined): SitemapEntry => (at ? { path, lastModified: at } : { path });
  return [
    ...SITEMAP_PAGES.map((path) => dated(path, path === '/bylaws' ? newest : undefined)),
    ...bylaws.map((b) => dated(`/bylaws/${encodeURIComponent(b.version)}`, b.publishedAt)),
    ...results.map((r) => dated(`/results/${encodeURIComponent(r.electionId)}`, r.certifiedAt)),
    // The bills on the public Legislation page (design §5.14), each last changed when it moved or the team edited it.
    ...bills.map((b) => dated(`/legislation/${encodeURIComponent(b.billId)}`, b.lastModified)),
  ];
}

const XML_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const xml = (text: string) => text.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);

/** sitemap.xml (sitemaps.org 0.9) for the site at `origin`. */
export function sitemapXml(origin: string, entries: readonly SitemapEntry[]): string {
  const urls = entries.map(
    (e) => `  <url><loc>${xml(origin + e.path)}</loc>${e.lastModified ? `<lastmod>${xml(e.lastModified)}</lastmod>` : ''}</url>`,
  );
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}
