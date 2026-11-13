/**
 * Link previews (design §15, "Link previews"). The sites people share links on (LinkedIn, X, Facebook, Bluesky,
 * Slack, Discord, iMessage…) read a page's `<head>` as served and run no script, so a page rendered in the browser
 * would share only the site's one description and card. For the pages listed here Firebase Hosting asks the api,
 * which serves the web app's own `index.html` with that page's title, description and card image in place of the
 * site's; every other page is served by Hosting as before. The card image itself is drawn by the api.
 */

/**
 * The pages whose link previews the api writes, as their route paths in the web app's router (`router.ts`). Each also
 * needs a rewrite in `firebase.json` (before the catch-all) and a preview source in the api; tests check both.
 */
export const PREVIEW_PAGES = ['/news/:slug', '/candidates/:id', '/course/:courseId', '/course/certificates/:id', '/results/:id'] as const;
export type PreviewPage = (typeof PREVIEW_PAGES)[number];

/**
 * Preview pages search engines never list, whatever is there (none found included), as the web app keeps them out:
 * one person's course certificate (design §10.8). Their previews still show where links are shared.
 */
export const UNLISTED_PREVIEW_PAGES: readonly PreviewPage[] = ['/course/certificates/:id'];

/** A bar on a card: a choice and its share, for results and polls. */
export interface CardBar {
  readonly label: string;
  /** What is written at the bar's end ("62%", "1,204 votes"). */
  readonly value: string;
  /** How full the bar is, 0 to 1. */
  readonly share: number;
  /** Drawn solid, the others paler: the winner, or the choice that passed. */
  readonly highlight?: boolean;
}

/** What a card image shows. Everything is plain text: the image is drawn from it, nothing is markup. */
export interface LinkCard {
  /** A line above the title saying what the page is: "News · Press release", "Candidate · U.S. House". */
  readonly kicker: string;
  readonly title: string;
  /** Up to three short lines under the title. */
  readonly lines?: readonly string[];
  /** Up to four bars under the title, in place of lines. */
  readonly bars?: readonly CardBar[];
}

/** A page's preview, as a preview source finds it. */
export interface LinkPreview {
  /** The page's own title, as its page writes it, without the site's name. */
  readonly title: string;
  readonly description: string;
  readonly card: LinkCard;
  /** Open Graph's kind of page; `website` unless given. */
  readonly type?: 'website' | 'article' | 'profile';
  /** False keeps search engines from listing the page, as the web app does for one person's certificate. */
  readonly listed?: boolean;
}

/** At most this much of each text reaches a card or a tag: longer is cut at a word, with an ellipsis. */
export const PREVIEW_LIMITS = { title: 120, description: 300, kicker: 60, line: 120, lines: 3, bars: 4, barLabel: 60, barValue: 20 } as const;

/** The party's name, in each card's footer. */
export const PREVIEW_PARTY = 'U.S. Transhumanist Party';

/** Card images are this size, Open Graph's and X's large image (1.91:1). */
export const CARD_SIZE = { width: 1200, height: 630 } as const;

/** Where the api serves a page's card image: `?path=` the page's path, `&v=` a hash of the card, so a changed card gets a new address. */
export const LINK_CARD_ROUTE = '/v1/public/link-cards';

/** The page, and its parameters, that a path is: `/news/hello` is `/news/:slug` with `{ slug: 'hello' }`. */
export interface PreviewMatch {
  readonly page: PreviewPage;
  readonly params: Readonly<Record<string, string>>;
}

/** The preview pages with the most fixed segments first, so `/course/certificates/:id` is tried before a `/course/:x/:y`. */
const BY_FIXED_SEGMENTS = [...PREVIEW_PAGES].sort((a, b) => fixedSegments(b) - fixedSegments(a));

function fixedSegments(page: string): number {
  return page.split('/').filter((part) => part && !part.startsWith(':')).length;
}

/**
 * The preview page a path is, if any. A page's path is any number of fixed segments and parameters, matched segment by
 * segment, so `/course/certificates/abc` is the certificate page and `/course/abc` the course's; where two pages could
 * match, the one with more fixed segments wins. A parameter is one path segment, decoded; a segment that does not
 * decode, or decodes to one holding a slash, a backslash or a control character, matches nothing (design §14: `%2F`
 * in IDs).
 */
export function matchPreviewPage(path: string): PreviewMatch | null {
  const segments = path.replace(/\/+$/, '').split('/');
  for (const page of BY_FIXED_SEGMENTS) {
    const parts = page.split('/');
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < parts.length && matched; i++) {
      const part = parts[i]!;
      const segment = segments[i]!;
      if (part.startsWith(':')) {
        const value = decodeSegment(segment);
        if (value === null || value === '') matched = false;
        else params[part.slice(1)] = value;
      } else if (part !== segment) {
        matched = false;
      }
    }
    if (matched) return { page, params };
  }
  return null;
}

function decodeSegment(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment);
    // eslint-disable-next-line no-control-regex
    return /[/\\\u0000-\u001f\u007f]/.test(value) ? null : value;
  } catch {
    return null;
  }
}

/** Text cut to at most `max` characters, at a word where one ends near the cut, with an ellipsis; spaces squeezed. */
export function clipText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  if (chars.length <= max) return flat;
  const cut = chars.slice(0, max - 1).join('');
  // The cut ends a word when the next character is a space; otherwise go back to the last whole word, if one is near.
  const space = chars[max - 1] === ' ' ? cut.length : cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

/** A preview held to `PREVIEW_LIMITS`, as the tags and the card use it. */
export function clippedPreview(preview: LinkPreview): LinkPreview {
  const L = PREVIEW_LIMITS;
  const { card } = preview;
  return {
    ...preview,
    title: clipText(preview.title, L.title),
    description: clipText(preview.description, L.description),
    card: {
      kicker: clipText(card.kicker, L.kicker),
      title: clipText(card.title, L.title),
      ...(card.lines ? { lines: card.lines.slice(0, L.lines).map((line) => clipText(line, L.line)) } : {}),
      ...(card.bars
        ? {
            bars: card.bars.slice(0, L.bars).map((bar) => ({
              label: clipText(bar.label, L.barLabel),
              value: clipText(bar.value, L.barValue),
              share: Number.isFinite(bar.share) ? Math.min(1, Math.max(0, bar.share)) : 0,
              ...(bar.highlight ? { highlight: true } : {}),
            })),
          }
        : {}),
    },
  };
}

/** What a served page's `<head>` says about it. */
export interface PreviewHead {
  /** `<title>`, as the page sets it: the page's title, then the site's name. */
  readonly documentTitle: string;
  readonly title: string;
  readonly description: string;
  /** The page's own address, its canonical link and `og:url`. */
  readonly url: string;
  readonly siteName: string;
  readonly type: 'website' | 'article' | 'profile';
  readonly image: { readonly url: string; readonly alt: string };
  /** False adds `<meta name="robots" content="noindex">`, as the web app does for pages kept out of search results. */
  readonly listed: boolean;
}

/** The site's name as `index.html` gives it (`og:site_name`, which the build fills from `VITE_APP_NAME`). */
export function siteNameOf(html: string): string | null {
  const tag = html.match(/<meta\s[^>]*property="og:site_name"[^>]*>/);
  const content = tag?.[0].match(/content="([^"]*)"/)?.[1];
  return content ? unescapeHtml(content).trim() || null : null;
}

/** The tags `headWithPreview` replaces: the title, description, robots, canonical link, and every Open Graph and X tag. */
const REPLACED = [
  /<title>[\s\S]*?<\/title>\s*/g,
  /<meta\s[^>]*(?:name|property)="(?:description|robots|og:[^"]*|twitter:[^"]*)"[^>]*>\s*/g,
  /<link\s[^>]*rel="canonical"[^>]*>\s*/g,
];

/**
 * `index.html` with the page's own `<head>` tags in place of the site's. Only the tags above are touched; the rest
 * (scripts, styles, icons, the manifest, the feeds) stay as built. Every value is escaped.
 */
export function headWithPreview(html: string, head: PreviewHead): string {
  const end = html.indexOf('</head>');
  if (end < 0) throw new Error('index.html has no </head>');
  const attr = escapeHtml;
  const tags = [
    `<title>${escapeHtml(head.documentTitle)}</title>`,
    `<meta name="description" content="${attr(head.description)}" />`,
    ...(head.listed ? [] : ['<meta name="robots" content="noindex" />']),
    `<link rel="canonical" href="${attr(head.url)}" />`,
    `<meta property="og:type" content="${attr(head.type)}" />`,
    `<meta property="og:site_name" content="${attr(head.siteName)}" />`,
    `<meta property="og:title" content="${attr(head.title)}" />`,
    `<meta property="og:description" content="${attr(head.description)}" />`,
    `<meta property="og:url" content="${attr(head.url)}" />`,
    `<meta property="og:image" content="${attr(head.image.url)}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="${CARD_SIZE.width}" />`,
    `<meta property="og:image:height" content="${CARD_SIZE.height}" />`,
    `<meta property="og:image:alt" content="${attr(head.image.alt)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${attr(head.title)}" />`,
    `<meta name="twitter:description" content="${attr(head.description)}" />`,
    `<meta name="twitter:image" content="${attr(head.image.url)}" />`,
    `<meta name="twitter:image:alt" content="${attr(head.image.alt)}" />`,
  ];
  const rest = REPLACED.reduce((text, pattern) => text.replace(pattern, ''), html.slice(0, end));
  return `${rest.replace(/\s*$/, '\n')}    <!-- This page's own link preview, written by the api (design §15). -->\n${tags.map((tag) => `    ${tag}\n`).join('')}  ${html.slice(end)}`;
}

/** A card's image described for screen readers: what it is, then its title. */
export function cardAlt(card: LinkCard): string {
  return `${card.kicker}: ${card.title}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function unescapeHtml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]!);
}
