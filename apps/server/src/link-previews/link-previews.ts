import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { clippedPreview, matchPreviewPage, PREVIEW_PAGES, type LinkCard, type LinkPreview, type PreviewMatch, type PreviewPage } from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { renderCard, type CardSite } from './card-image.js';

/**
 * Link previews (design §15, "Link previews"): for each page in `PREVIEW_PAGES`, a source in the context that owns the
 * page's data says what its preview shows, from what the public may already read there; this service finds a path's
 * source and holds the result to the domain's limits.
 */

/** One page's previews, from the context that owns its data. */
export interface LinkPreviewSource {
  readonly page: PreviewPage;
  /** The page's preview, or null when there is nothing public there (no such post, a draft, a withdrawn candidacy). */
  preview(params: Readonly<Record<string, string>>): Promise<LinkPreview | null>;
}

/** Every context's `LinkPreviewSource`, gathered in `providers.ts`. */
export const LINK_PREVIEW_SOURCES = Symbol('LINK_PREVIEW_SOURCES');

/** A source's answer to a path: the page it is, and its preview held to the limits. */
export interface FoundPreview {
  readonly match: PreviewMatch;
  readonly preview: LinkPreview;
  /** A short hash of the card, which its image's address carries so that a changed card gets a new one. */
  readonly version: string;
}

/** Turns a source's 404 (it read through a public service that throws one) into "no preview". */
export async function orNone<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof NotFoundException) return null;
    throw error;
  }
}

export function cardVersion(card: LinkCard): string {
  return createHash('sha256').update(JSON.stringify(card)).digest('base64url').slice(0, 12);
}

@Injectable()
export class LinkPreviewService {
  private readonly logger = new Logger(LinkPreviewService.name);
  private readonly sources: ReadonlyMap<PreviewPage, LinkPreviewSource>;

  constructor(@Inject(LINK_PREVIEW_SOURCES) sources: readonly LinkPreviewSource[]) {
    const byPage = new Map<PreviewPage, LinkPreviewSource>();
    for (const source of sources) {
      if (byPage.has(source.page)) throw new Error(`two link preview sources for ${source.page}`);
      byPage.set(source.page, source);
    }
    const missing = PREVIEW_PAGES.filter((page) => !byPage.has(page));
    if (missing.length) throw new Error(`no link preview source for ${missing.join(', ')}`);
    this.sources = byPage;
  }

  /**
   * The preview of the page at `path`, or null when it is no preview page or has nothing public. A source that fails
   * is logged and treated as having nothing, so the page itself is still served.
   */
  async find(path: string): Promise<FoundPreview | null> {
    const match = matchPreviewPage(path);
    if (!match) return null;
    let preview: LinkPreview | null;
    try {
      preview = await this.sources.get(match.page)!.preview(match.params);
    } catch (error) {
      this.logger.warn(`link preview for ${match.page} failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    if (!preview) return null;
    const clipped = clippedPreview(preview);
    return { match, preview: clipped, version: cardVersion(clipped.card) };
  }
}

/** How long fetching index.html may take before the copy already held is used. */
const INDEX_TIMEOUT_MS = 5_000;
/** index.html is a few kilobytes; anything much larger is not it. */
const INDEX_MAX_BYTES = 256 * 1024;

/** The web app's built `index.html`, which preview pages are served from. */
export const INDEX_HTML = Symbol('INDEX_HTML');
export interface IndexHtmlSource {
  get(): Promise<string>;
}

/**
 * index.html as Firebase Hosting serves it at `WEB_ORIGIN` (a static file there, so never rewritten back here). It is
 * asked for again on every page, with the ETag of the copy held, so a release's new index.html (naming the new
 * build's scripts, the old ones being gone) is served from the first page after it; Hosting answers 304 when nothing
 * changed. Only `WEB_ORIGIN` is ever fetched, never an address taken from a request. When Hosting cannot be reached,
 * the copy held is served; with none, 503.
 */
@Injectable()
export class HostedIndexHtml implements IndexHtmlSource {
  private readonly logger = new Logger(HostedIndexHtml.name);
  private held: { readonly html: string; readonly etag: string | null } | null = null;
  private pending: Promise<string> | null = null;

  constructor(@Inject(CONFIG) private readonly config: ServerConfig) {}

  get(): Promise<string> {
    this.pending ??= this.fetch().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async fetch(): Promise<string> {
    const origin = this.config.webOrigin;
    if (!origin) throw new ServiceUnavailableException('the web app is not configured (WEB_ORIGIN)');
    try {
      const res = await fetch(`${origin}/index.html`, {
        headers: this.held?.etag ? { 'If-None-Match': this.held.etag } : {},
        redirect: 'error',
        signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
      });
      if (res.status === 304 && this.held) return this.held.html;
      if (!res.ok) throw new Error(`index.html answered ${res.status}`);
      const html = await res.text();
      if (html.length > INDEX_MAX_BYTES || !html.includes('</head>')) throw new Error('index.html is not the web app');
      this.held = { html, etag: res.headers.get('etag') };
      return html;
    } catch (error) {
      this.logger.warn(`could not fetch index.html: ${error instanceof Error ? error.message : String(error)}`);
      if (this.held) return this.held.html;
      throw new ServiceUnavailableException('the web app could not be reached; try again in a moment');
    }
  }
}

/** Card images drawn lately, by card: drawing one takes tens of milliseconds, and a shared link is fetched in bursts. */
const CARD_CACHE_SIZE = 64;

@Injectable()
export class LinkCardImages {
  private readonly drawn = new Map<string, Promise<Buffer>>();

  /** The card as a PNG, drawn once while it stays among the latest few. */
  image(card: LinkCard, site: CardSite): Promise<Buffer> {
    const key = `${cardVersion(card)}:${site.name}:${site.host}`;
    let png = this.drawn.get(key);
    if (png) {
      this.drawn.delete(key);
    } else {
      png = renderCard(card, site);
      png.catch(() => this.drawn.delete(key));
    }
    this.drawn.set(key, png);
    while (this.drawn.size > CARD_CACHE_SIZE) this.drawn.delete(this.drawn.keys().next().value!);
    return png;
  }
}
