import { NETWORK_NAMES } from '../governance/hub.js';

/**
 * Share buttons (design §10.7): each opens a site's own composer, or the device's email, with the text filled in, and
 * the person sharing presses Post. The site gets no script, button or tracker of theirs; nothing is posted for anyone.
 */

export const SHARE_TARGETS = ['x', 'facebook', 'linkedin', 'bluesky', 'threads', 'mastodon', 'reddit', 'telegram', 'whatsapp', 'email'] as const;
export type ShareTarget = (typeof SHARE_TARGETS)[number];

export const SHARE_TARGET_NAMES: Readonly<Record<ShareTarget, string>> = {
  x: NETWORK_NAMES.x,
  facebook: NETWORK_NAMES.facebook,
  linkedin: NETWORK_NAMES.linkedin,
  bluesky: NETWORK_NAMES.bluesky,
  threads: NETWORK_NAMES.threads,
  mastodon: NETWORK_NAMES.mastodon,
  reddit: NETWORK_NAMES.reddit,
  telegram: NETWORK_NAMES.telegram,
  whatsapp: 'WhatsApp',
  email: 'Email',
};

/**
 * The longest post each composer takes, as it counts: X and Mastodon count every address as 23 characters. Null where
 * the limit is far beyond any post here. Reddit's is its title's.
 */
export const SHARE_LIMITS: Readonly<Record<ShareTarget, number | null>> = {
  x: 280,
  facebook: null,
  linkedin: 3000,
  bluesky: 300,
  threads: 500,
  mastodon: 500,
  reddit: 300,
  telegram: 4096,
  whatsapp: null,
  email: null,
};

/** Composers that take the address apart from the text (and show it as a card); the rest get it at the end of the text. */
const SEPARATE_URL: readonly ShareTarget[] = ['x', 'facebook', 'linkedin', 'reddit', 'telegram'];

/** Sites that can only share an address, not text. */
export const URL_ONLY: readonly ShareTarget[] = ['facebook'];

/** What is shared: the words, an absolute address (or none), hashtags without their #, and a title for email and Reddit. */
export interface Shareable {
  readonly text: string;
  readonly url: string | null;
  readonly hashtags: readonly string[];
  readonly title: string;
}

/** The words with the hashtags after them, and the address too where the composer has no place of its own for it. */
export function shareText(target: ShareTarget, item: Shareable): string {
  const tags = item.hashtags.map((t) => `#${t}`).join(' ');
  const parts = [item.text.trim(), tags];
  if (item.url && !SEPARATE_URL.includes(target)) parts.push(item.url);
  return parts.filter(Boolean).join(target === 'email' ? '\n\n' : ' ');
}

const ADDRESS = /https?:\/\/\S+/g;

/** How long the composer counts the post: the text it gets, with X and Mastodon's 23 per address, and X's card. */
export function shareLength(target: ShareTarget, item: Shareable): number {
  const words = shareText(target, item);
  const chars = (s: string) => [...s].length;
  if (target === 'x' || target === 'mastodon') {
    const addresses = words.match(ADDRESS) ?? [];
    const counted = chars(words.replace(ADDRESS, '')) + 23 * addresses.length;
    return target === 'x' && item.url ? counted + 24 : counted;
  }
  if (target === 'reddit') return chars(item.title);
  return chars(words);
}

/** Why a target cannot take the item as it is, if it cannot: too long, or a site that shares only an address. */
export function shareProblem(target: ShareTarget, item: Shareable): string | null {
  if (URL_ONLY.includes(target) && !item.url) return `${SHARE_TARGET_NAMES[target]} shares only a link, and this has none`;
  const limit = SHARE_LIMITS[target];
  const length = shareLength(target, item);
  if (limit !== null && length > limit) {
    return `${length} of ${limit} characters on ${SHARE_TARGET_NAMES[target]}: shorten it there before posting`;
  }
  return null;
}

/** A Mastodon server's host, as typed ("mastodon.social", "@me@mastodon.social" or its address), or null if it is not one. */
export function mastodonHost(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^@?[^@\s]+@/, '');
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : null;
}

const q = (params: Record<string, string | null | undefined>) =>
  Object.entries(params)
    .filter((e): e is [string, string] => !!e[1])
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

/**
 * The address that opens a target's composer with the item filled in. Mastodon has no one site, so it needs the
 * sharer's own server (`mastodonHost`); without one, null.
 */
export function shareUrl(target: ShareTarget, item: Shareable, mastodon?: string | null): string | null {
  const body = shareText(target, item);
  const url = item.url ?? undefined;
  switch (target) {
    case 'x':
      return `https://x.com/intent/tweet?${q({ text: body, url })}`;
    case 'facebook':
      return url ? `https://www.facebook.com/sharer/sharer.php?${q({ u: url })}` : null;
    case 'linkedin':
      return url
        ? `https://www.linkedin.com/sharing/share-offsite/?${q({ url })}`
        : `https://www.linkedin.com/feed/?${q({ shareActive: 'true', text: body })}`;
    case 'bluesky':
      return `https://bsky.app/intent/compose?${q({ text: body })}`;
    case 'threads':
      return `https://www.threads.net/intent/post?${q({ text: body })}`;
    case 'mastodon': {
      const host = mastodon ? mastodonHost(mastodon) : null;
      return host ? `https://${host}/share?${q({ text: body })}` : null;
    }
    case 'reddit':
      return url ? `https://www.reddit.com/submit?${q({ url, title: item.title })}` : `https://www.reddit.com/submit?${q({ title: item.title, text: body })}`;
    case 'telegram':
      return `https://t.me/share/url?${q({ url: url ?? body, text: url ? body : undefined })}`;
    case 'whatsapp':
      return `https://wa.me/?${q({ text: body })}`;
    case 'email':
      return `mailto:?${q({ subject: item.title, body })}`;
  }
}
