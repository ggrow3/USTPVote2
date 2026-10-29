import { escapeHtml, newsHtml, newsText } from './news-body.js';
import type { NewsKind, NewsPostRecord } from './news.js';

/**
 * The news feeds (design §10.9): the published posts as RSS 2.0 and JSON Feed 1.1, so the party's bots, feed readers
 * and services such as IFTTT can pick up each post as it is published, without the app holding any site's keys.
 */

export const NEWS_KIND_NAMES: Readonly<Record<NewsKind, string>> = {
  press_release: 'Press release',
  statement: 'Statement',
  news: 'News',
};

export interface FeedSite {
  /** Where the web app is served, `https://…` with no trailing slash. */
  readonly origin: string;
  /** The party's name, from the hub. */
  readonly name: string;
  readonly description: string;
}

const postUrl = (origin: string, slug: string) => `${origin}/news/${slug}`;

/** XML 1.0 has no place for most control characters; they are dropped rather than make the feed unreadable. */
const xml = (value: string) => escapeHtml(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, ''));

/** `GET /v1/news/feed.xml`: posts newest first, each with its summary as the description and its text as HTML. */
export function rssFeed(site: FeedSite, posts: readonly NewsPostRecord[]): string {
  const latest = posts[0]?.editedAt ?? posts[0]?.publishedAt ?? null;
  const items = posts.map((p) =>
    [
      '    <item>',
      `      <title>${xml(p.title)}</title>`,
      `      <link>${xml(postUrl(site.origin, p.slug))}</link>`,
      `      <guid isPermaLink="true">${xml(postUrl(site.origin, p.slug))}</guid>`,
      `      <pubDate>${new Date(p.publishedAt!).toUTCString()}</pubDate>`,
      `      <category>${xml(NEWS_KIND_NAMES[p.kind])}</category>`,
      ...p.hashtags.map((t) => `      <category>${xml(t)}</category>`),
      `      <description>${xml(p.summary)}</description>`,
      `      <content:encoded>${xml(newsHtml(p.body))}</content:encoded>`,
      '    </item>',
    ].join('\n'),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '  <channel>',
    `    <title>${xml(`${site.name}: News`)}</title>`,
    `    <link>${xml(`${site.origin}/news`)}</link>`,
    `    <atom:link href="${xml(`${site.origin}/v1/news/feed.xml`)}" rel="self" type="application/rss+xml"/>`,
    `    <description>${xml(site.description)}</description>`,
    '    <language>en-us</language>',
    ...(latest ? [`    <lastBuildDate>${new Date(latest).toUTCString()}</lastBuildDate>`] : []),
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

/** JSON Feed 1.1 (https://jsonfeed.org/version/1.1). */
export interface JsonFeed {
  readonly version: 'https://jsonfeed.org/version/1.1';
  readonly title: string;
  readonly home_page_url: string;
  readonly feed_url: string;
  readonly description: string;
  readonly language: 'en-US';
  readonly items: readonly {
    readonly id: string;
    readonly url: string;
    readonly title: string;
    readonly summary: string;
    readonly content_html: string;
    readonly content_text: string;
    readonly date_published: string;
    readonly date_modified?: string;
    readonly tags: readonly string[];
  }[];
}

/** `GET /v1/news/feed.json`: the same posts as the RSS feed. */
export function jsonFeed(site: FeedSite, posts: readonly NewsPostRecord[]): JsonFeed {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: `${site.name}: News`,
    home_page_url: `${site.origin}/news`,
    feed_url: `${site.origin}/v1/news/feed.json`,
    description: site.description,
    language: 'en-US',
    items: posts.map((p) => ({
      id: postUrl(site.origin, p.slug),
      url: postUrl(site.origin, p.slug),
      title: p.title,
      summary: p.summary,
      content_html: newsHtml(p.body),
      content_text: newsText(p.body),
      date_published: p.publishedAt!,
      ...(p.editedAt && { date_modified: p.editedAt }),
      tags: [NEWS_KIND_NAMES[p.kind], ...p.hashtags],
    })),
  };
}
