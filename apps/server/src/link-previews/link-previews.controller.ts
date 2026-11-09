import { Controller, Get, Inject, NotFoundException, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { cardAlt, crawlAllowed, headWithPreview, LINK_CARD_ROUTE, PREVIEW_PAGES, PREVIEW_PARTY, siteNameOf } from 'ustp-domain';
import { Public } from '../auth/decorators.js';
import { requestOrigin } from '../common/request-origin.js';
import { CONFIG, type ServerConfig } from '../config.js';
import type { CardSite } from './card-image.js';
import { INDEX_HTML, LinkCardImages, LinkPreviewService, type IndexHtmlSource } from './link-previews.js';

/**
 * The headers Firebase Hosting gives every page it serves (`firebase.json`, `**`), given here too to the pages the api
 * serves in its place; a test keeps the two the same.
 */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
};

/** The site's name when index.html gives none. */
const FALLBACK_SITE_NAME = 'USTP Vote';

/** A page's path as asked for: no query, no trailing slash. */
const pagePath = (req: FastifyRequest) => req.url.split('?')[0]!.replace(/\/+$/, '') || '/';

/**
 * The web app's pages whose link previews the api writes (design §15, "Link previews"), which Firebase Hosting rewrites
 * here: `index.html` as built, with the page's own title, description, canonical link and Open Graph and X tags. A page
 * with nothing public (no such post, say) gets index.html as Hosting would serve it, and the web app says so.
 */
@Controller()
@Public()
export class LinkPreviewPagesController {
  constructor(
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(INDEX_HTML) private readonly index: IndexHtmlSource,
    private readonly previews: LinkPreviewService,
  ) {}

  @Get(PREVIEW_PAGES.map((page) => page.slice(1)))
  async page(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const path = pagePath(req);
    const [html, found] = await Promise.all([this.index.get(), this.previews.find(path)]);
    // Never kept by Hosting's CDN or a browser: a release changes the scripts index.html names.
    void reply.headers({ ...PAGE_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    const listed = (found?.preview.listed ?? true) && crawlAllowed({ environment: this.config.deploymentEnvironment, webOrigin: this.config.webOrigin }, requestOrigin(req));
    // Every api response says noindex (create-app.ts); a page search engines may list must not.
    if (listed) void reply.removeHeader('X-Robots-Tag');
    if (!found) return html;
    const origin = this.config.webOrigin ?? requestOrigin(req);
    const siteName = siteNameOf(html) ?? FALLBACK_SITE_NAME;
    const { preview, version } = found;
    return headWithPreview(html, {
      documentTitle: `${preview.title} · ${siteName}`,
      title: preview.title,
      description: preview.description,
      url: origin + path,
      siteName,
      type: preview.type ?? 'website',
      image: { url: `${origin}${LINK_CARD_ROUTE}?path=${encodeURIComponent(path)}&v=${version}`, alt: cardAlt(preview.card) },
      listed: preview.listed ?? true,
    });
  }
}

/** A preview page's card image, 1200 × 630 PNG, for anyone: what it shows is on the public page it is for. */
@Controller(LINK_CARD_ROUTE.slice(1))
@Public()
export class LinkCardsController {
  constructor(
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(INDEX_HTML) private readonly index: IndexHtmlSource,
    private readonly previews: LinkPreviewService,
    private readonly images: LinkCardImages,
  ) {}

  @Get()
  async card(@Query('path') path: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<Buffer> {
    const found = typeof path === 'string' && path.length <= 512 ? await this.previews.find(path) : null;
    if (!found) throw new NotFoundException('no card for that page');
    const origin = this.config.webOrigin ?? requestOrigin(req);
    const site: CardSite = { name: siteNameOf(await this.index.get().catch(() => '')) ?? FALLBACK_SITE_NAME, party: PREVIEW_PARTY, host: new URL(origin).host };
    const png = await this.images.image(found.preview.card, site);
    // The address carries the card's hash, so a changed card is a new address; an hour in browsers, a day at the CDN.
    void reply.headers({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, s-maxage=86400' });
    return png;
  }
}
