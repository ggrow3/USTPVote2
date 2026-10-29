import { fabWhatsapp } from '@quasar/extras/fontawesome-v7';
import {
  absoluteUrl,
  NETWORK_NAMES,
  NEWS_KIND_NAMES,
  type BotSite,
  type BotStatus,
  type CalendarStatus,
  type NewsKind,
  type NewsStatus,
  type Shareable,
  type SharePostStatus,
  type ShareTarget,
  type SuggestionStatus,
  type SuggestionTopic,
} from 'ustp-domain';
import { hubIcon } from '../governance/hub-icons.js';

/** Wording, icons and dates for the communications pages (design §10.7). */

export { NEWS_KIND_NAMES };

export const NEWS_STATUS_LABELS: Readonly<Record<NewsStatus, string>> = { draft: 'Draft', published: 'Published', withdrawn: 'Withdrawn' };
export const SHARE_STATUS_LABELS: Readonly<Record<SharePostStatus, string>> = { draft: 'Draft', published: 'In the share kit', archived: 'Archived' };
export const CALENDAR_STATUS_LABELS: Readonly<Record<CalendarStatus, string>> = { planned: 'Planned', posted: 'Posted', skipped: 'Skipped' };
export const BOT_STATUS_LABELS: Readonly<Record<BotStatus, string>> = { active: 'Active', paused: 'Paused', retired: 'Retired' };

export const SUGGESTION_TOPIC_LABELS: Readonly<Record<SuggestionTopic, string>> = {
  policy: 'A policy idea',
  campaigns: 'Campaigns and candidates',
  events: 'Events and outreach',
  media: 'Media and press',
  website: 'This website',
  membership: 'Membership',
  other: 'Something else',
};

export const SUGGESTION_STATUS_LABELS: Readonly<Record<SuggestionStatus, string>> = {
  new: 'New',
  read: 'Read',
  answered: 'Answered',
  archived: 'Archived',
  spam: 'Spam',
};

export const BOT_SITE_NAMES: Readonly<Record<BotSite, string>> = { ...NETWORK_NAMES, other: 'Another site' };

/** Badge colours: what needs someone, what is out, what is done with. */
export const NEWS_STATUS_COLORS: Readonly<Record<NewsStatus, string>> = { draft: 'orange-9', published: 'positive', withdrawn: 'grey-7' };
export const SHARE_STATUS_COLORS: Readonly<Record<SharePostStatus, string>> = { draft: 'orange-9', published: 'positive', archived: 'grey-7' };

/** A share button's icon: a network's mark, WhatsApp's, or a mail symbol. */
export function targetIcon(target: ShareTarget): string {
  if (target === 'whatsapp') return fabWhatsapp;
  if (target === 'email') return 'mail';
  return hubIcon(target);
}

/** A network's or site's icon, for the calendar and the bots; a robot for anywhere else. */
export function siteIcon(site: BotSite): string {
  return site === 'other' ? 'smart_toy' : hubIcon(site);
}

/** "28 October 2026". */
export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "Wed 30 Oct, 18:00", in the viewer's time zone. */
export function shortTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** A local `YYYY-MM-DDTHH:mm` for a datetime input, from ISO, and back. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(local: string): string {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** A file's size in words: "640 KB", "1.2 MB". */
export function fileSize(bytes: number): string {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** What a news post's share buttons share: its summary, hashtags and its page here. */
export function newsShareable(
  post: { slug: string; title: string; summary: string; hashtags: readonly string[] },
  origin = location.origin,
): Shareable {
  return { text: post.summary || post.title, url: absoluteUrl(`/news/${post.slug}`, origin), hashtags: post.hashtags, title: post.title };
}

/** What a share kit post shares: its text and hashtags, and its link made absolute. */
export function kitShareable(
  post: { title: string; text: string; url: string; hashtags: readonly string[] },
  origin = location.origin,
): Shareable {
  return { text: post.text, url: post.url ? absoluteUrl(post.url, origin) : null, hashtags: post.hashtags, title: post.title };
}

/** Hashtags as typed in one field ("#USTP, Future 2028"): words split on spaces and commas, the schema strips the #. */
export function parseHashtags(typed: string): string[] {
  return typed
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function formatHashtags(tags: readonly string[]): string {
  return tags.map((t) => `#${t}`).join(' ');
}

/** Today in the viewer's time zone, `YYYY-MM-DD`, for date inputs. */
export function localDay(at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
