import { z } from 'zod';
import { deny, OK, type Check } from '../check.js';
import { contrast, DEFAULT_ACCENT, isHexColour, TEXT_CONTRAST } from './accent.js';
import { videoSchema, type Video } from '../video.js';
import { HUB_IMAGE_NAMES, isHubImageId } from './hub-images.js';

/**
 * The home page hub (design §10.6): the party's profile, a row of social icons, a Discord card and sections of link
 * cards, which System Admins manage, and how often each is followed (counts only, nothing about who followed it).
 */

/** Networks with a mark of their own, in the order the icon row lists them. */
export const SOCIAL_NETWORKS = [
  'discord',
  'x',
  'reddit',
  'facebook',
  'telegram',
  'instagram',
  'youtube',
  'tiktok',
  'linkedin',
  'threads',
  'bluesky',
  'mastodon',
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/** Each network's name as the network writes it. */
export const NETWORK_NAMES: Readonly<Record<SocialNetwork, string>> = {
  discord: 'Discord',
  x: 'X',
  reddit: 'Reddit',
  facebook: 'Facebook',
  telegram: 'Telegram',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
};

/** Icons for links that are not a network: the party's own apps and pages. */
export const LINK_SYMBOLS = ['vote', 'register', 'course', 'events', 'donate', 'forum', 'chat', 'news', 'website', 'email', 'video', 'link'] as const;
export type LinkSymbol = (typeof LINK_SYMBOLS)[number];

/** A link's icon: a network's mark (monochrome) or a symbol. */
export const HUB_ICONS = [...SOCIAL_NETWORKS, ...LINK_SYMBOLS] as const;
export type HubIcon = (typeof HUB_ICONS)[number];

/** The theme visitors get until they pick one: dark (the look the hub is drawn for), light, or the device's setting. */
export const HUB_THEMES = ['dark', 'light', 'device'] as const;
export type HubTheme = (typeof HUB_THEMES)[number];

/** The most each part may hold once tidied, and how many sections and links a hub may have. */
export const HUB_LIMITS = {
  name: 80,
  tagline: 160,
  bio: 280,
  sectionTitle: 40,
  linkTitle: 60,
  subtitle: 80,
  url: 500,
  sections: 12,
  linksPerSection: 40,
} as const;

export interface HubProfile {
  readonly name: string;
  /** One line under the name. */
  readonly tagline: string;
  /** A short line on what the page is for. */
  readonly bio: string;
  /** The uploaded logo's ID (the SHA-256 of its stored bytes), or null for the name's initials on a tile. */
  readonly logo: string | null;
  /** The uploaded cover banner's ID, shown across the top of the hub above the logo, or null for none. */
  readonly cover: string | null;
  /**
   * The theme accent, `#rrggbb`, or empty for the party's orange: it fills buttons under white text, so it needs 4.5:1
   * with white (`accent.ts`).
   */
  readonly accent: string;
  readonly theme: HubTheme;
  /** The uploaded photo behind every page but the hub, under a scrim, or null for the sunrise drawn for the project. */
  readonly background: string | null;
}

/** The Discord card, shown while it has an invite; its live line, while switched on with the server's ID. */
export interface HubDiscord {
  /** `https://discord.gg/…` or `https://discord.com/invite/…`. */
  readonly invite: string;
  /** The server's ID (its "guild ID"), for the live count; empty for none. */
  readonly guildId: string;
  /** Whether the card shows how many are online. */
  readonly widget: boolean;
}

export interface HubLink {
  /** Stays with the link when it is edited or moved, so its click count does. */
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  /** A page of this app (`/ballot`), an `https://` address, or `mailto:`; may be empty for a link with a video. */
  readonly url: string;
  /**
   * A video the hub plays when the link is chosen, instead of opening its address (design §10.10): a YouTube video or an
   * upload. Null for an ordinary link; links saved before videos have none.
   */
  readonly video: Video | null;
  readonly icon: HubIcon;
  readonly shown: boolean;
  /** Its icon is also in the row under the profile (networks first, in their order). */
  readonly iconRow: boolean;
  /** Starred: drawn in the accent, to stand out from the other cards. */
  readonly featured: boolean;
}

export interface HubSection {
  readonly id: string;
  readonly title: string;
  readonly shown: boolean;
  /** In the order the page lists them. */
  readonly links: readonly HubLink[];
}

export interface Hub {
  readonly profile: HubProfile;
  readonly discord: HubDiscord;
  /** In the order the page lists them. */
  readonly sections: readonly HubSection[];
}

/** `hub/current`; version 0 (never saved) is the default. */
export interface HubRecord extends Hub {
  /** Counts saves, so an edit made from an older copy is refused instead of undoing someone else's. */
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

export type PublicHubLink = Omit<HubLink, 'shown' | 'iconRow'>;

/** `GET /v1/hub`: only what the page shows (no hidden or unfinished links), without who changed it. */
export interface PublicHub {
  readonly version: number;
  readonly profile: HubProfile;
  /** The icon row: shown links marked for it, networks first in their order, then the rest in page order. */
  readonly icons: readonly Pick<HubLink, 'id' | 'title' | 'url' | 'video' | 'icon'>[];
  /** Null without an invite. `live`: the card shows the online count from `GET /v1/hub/discord`. */
  readonly discord: { readonly invite: string; readonly live: boolean } | null;
  readonly sections: readonly { readonly id: string; readonly title: string; readonly links: readonly PublicHubLink[] }[];
}

/** `GET /v1/hub/discord`: how many are online in the party's Discord server, when Discord says. */
export interface DiscordLive {
  readonly online: number | null;
}

type LinkOptions = Partial<Pick<HubLink, 'iconRow' | 'featured'>>;

const link = (id: string, icon: HubIcon, title: string, subtitle: string, url = '', options: LinkOptions = {}): HubLink => ({
  id,
  title,
  subtitle,
  url,
  video: null,
  icon,
  shown: url !== '',
  iconRow: options.iconRow ?? false,
  featured: options.featured ?? false,
});
const social = (id: string, icon: SocialNetwork, title: string, subtitle: string, url = '') => link(id, icon, title, subtitle, url, { iconRow: true });

/**
 * Addresses checked on the party's own site (transhumanist-party.org, its header and footer, 2026-10-27): the site
 * itself, Facebook, X and the LinkedIn group. The other networks, the Discord invite and the future apps are left
 * empty for System Admins to fill in, never guessed; until then they are hidden drafts.
 */
const VERIFIED = {
  website: 'https://transhumanist-party.org/',
  x: 'https://twitter.com/USTranshumanist',
  facebook: 'https://www.facebook.com/USTranshumanistParty/',
  linkedin: 'https://www.linkedin.com/groups/13502241',
} as const;

/** The tagline is the one in the party site's header. */
export const DEFAULT_HUB: Hub = {
  profile: {
    name: 'U.S. Transhumanist Party',
    tagline: 'Putting science, health & technology at the forefront of American politics',
    bio: 'Vote on proposals, join the conversation on Discord, and follow USTP everywhere.',
    logo: null,
    cover: null,
    accent: '',
    theme: 'dark',
    background: null,
  },
  discord: { invite: '', guildId: '', widget: false },
  sections: [
    {
      id: 'apps',
      title: 'Apps',
      shown: true,
      links: [
        link('vote', 'vote', 'USTP Vote', 'Sign in to vote on proposals and in party elections', '/vote', { featured: true }),
        link('register', 'register', 'Become a member', 'Apply to join the USTP', '/register'),
        link('course', 'course', 'Courses', 'Free lessons, quizzes and certificates', '/courses'),
        link('website', 'website', 'Official website', 'transhumanist-party.org', VERIFIED.website),
        link('events', 'events', 'Events', 'Meetings and gatherings'),
        link('donate', 'donate', 'Donate', 'Support the party'),
        link('forum', 'forum', 'Discussion board', 'Threads on policy and the platform'),
        link('chat', 'chat', 'Chat', 'Talk with members'),
      ],
    },
    {
      id: 'community',
      title: 'Community',
      shown: true,
      links: [
        social('discord-server', 'discord', 'Discord server', 'Live chat with members'),
        social('subreddit', 'reddit', 'Subreddit', 'Long-form discussion'),
        social('telegram-channel', 'telegram', 'Telegram channel', 'Announcements'),
      ],
    },
    {
      id: 'follow',
      title: 'Follow us',
      shown: true,
      links: [
        social('x', 'x', 'X / Twitter', '', VERIFIED.x),
        social('facebook', 'facebook', 'Facebook', '', VERIFIED.facebook),
        social('instagram', 'instagram', 'Instagram', ''),
        social('youtube', 'youtube', 'YouTube', ''),
        social('tiktok', 'tiktok', 'TikTok', ''),
        social('linkedin', 'linkedin', 'LinkedIn', 'Our LinkedIn group', VERIFIED.linkedin),
        social('threads', 'threads', 'Threads', ''),
        social('bluesky', 'bluesky', 'Bluesky', ''),
        social('mastodon', 'mastodon', 'Mastodon', ''),
      ],
    },
  ],
};

/** A section's or link's ID: lower-case letters, digits and dashes, as made by `newHubId` or chosen for the defaults. */
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const GUILD_ID = /^\d{17,20}$/;
const DISCORD_HOSTS = ['discord.gg', 'discord.com', 'www.discord.com', 'discordapp.com', 'www.discordapp.com'];

export function isHubId(id: string): boolean {
  return ID.test(id);
}

/** A fresh ID for a section or link someone adds. */
export function newHubId(random: () => number = Math.random): string {
  return Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]).join('');
}

/** "UT" for "U.S. Transhumanist Party": the first letter of the first two words, for the tile when there is no logo. */
export function hubInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word.match(/\p{L}|\p{N}/u)?.[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** The accent in force: the one chosen, or the party's orange when it is left empty. */
export function effectiveAccent(profile: Pick<HubProfile, 'accent'>): string {
  return profile.accent || DEFAULT_ACCENT;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const text = (value: unknown, fallback = '') => oneLine(typeof value === 'string' ? value : fallback);
const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : [];
const isIn = <T extends string>(values: readonly T[], value: unknown): value is T => values.includes(value as T);
const image = (value: unknown) => (typeof value === 'string' ? value : null);

function resolveProfile(stored: Record<string, unknown> | undefined): HubProfile {
  const d = DEFAULT_HUB.profile;
  return {
    name: text(stored?.name, d.name),
    tagline: text(stored?.tagline, d.tagline),
    bio: text(stored?.bio, d.bio),
    logo: image(stored?.logo),
    cover: image(stored?.cover),
    accent: text(stored?.accent, d.accent).toLowerCase(),
    theme: isIn(HUB_THEMES, stored?.theme) ? stored.theme : d.theme,
    background: image(stored?.background),
  };
}

function resolveLink(stored: Record<string, unknown>): HubLink {
  return {
    id: text(stored.id),
    title: text(stored.title),
    subtitle: text(stored.subtitle),
    url: text(stored.url),
    video: videoSchema.safeParse(stored.video).data ?? null,
    icon: isIn(HUB_ICONS, stored.icon) ? stored.icon : 'link',
    shown: flag(stored.shown, false),
    iconRow: flag(stored.iconRow, false),
    featured: flag(stored.featured, false),
  };
}

function resolveSections(stored: unknown): HubSection[] {
  if (!Array.isArray(stored)) return DEFAULT_HUB.sections.map((s) => ({ ...s, links: s.links.map((l) => ({ ...l })) }));
  return list(stored).map((s) => ({
    id: text(s.id),
    title: text(s.title),
    shown: flag(s.shown, false),
    links: list(s.links).map(resolveLink),
  }));
}

type Stored = { readonly [K in keyof Hub]?: unknown };

/** The hub in force from what was saved, tidied (each text on one line), with the default for anything missing. */
export function resolveHub(stored: Stored | null | undefined): Hub {
  const discord = stored?.discord as Record<string, unknown> | undefined;
  return {
    profile: resolveProfile(stored?.profile as Record<string, unknown> | undefined),
    discord: { invite: text(discord?.invite), guildId: text(discord?.guildId), widget: flag(discord?.widget, false) },
    sections: resolveSections(stored?.sections),
  };
}

/** Why an address cannot be used, if it cannot: a page of this app, `https://`, or `mailto:` (the invite: Discord's). */
export function urlProblem(url: string, kind: 'link' | 'discord'): string | null {
  if (url.length > HUB_LIMITS.url) return `an address can be at most ${HUB_LIMITS.url} characters`;
  if (/\s/.test(url)) return 'an address cannot contain spaces';
  if (kind === 'link' && url.startsWith('/') && !url.startsWith('//')) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return kind === 'link' ? 'use a page of this site (/ballot), an https:// address or mailto:' : 'use a Discord invite (https://discord.gg/…)';
  }
  if (kind === 'link' && parsed.protocol === 'mailto:') return parsed.pathname.includes('@') ? null : 'a mailto: address needs an email address';
  if (parsed.protocol !== 'https:') return parsed.protocol === 'http:' ? 'use the https:// address' : 'use an https:// address';
  if (kind === 'discord' && !DISCORD_HOSTS.includes(parsed.hostname)) return 'use a Discord invite (https://discord.gg/…)';
  return null;
}

/** Why the accent cannot be used, if it cannot. Empty is the party's orange. */
export function accentProblem(accent: string): string | null {
  if (!accent) return null;
  if (!isHexColour(accent)) return 'the accent is a colour as #rrggbb, or empty for the party orange';
  if (contrast(accent, '#ffffff') < TEXT_CONTRAST) {
    return `white text on the accent needs ${TEXT_CONTRAST}:1 contrast; this colour gives ${contrast(accent, '#ffffff').toFixed(2)}:1, so choose a darker one`;
  }
  return null;
}

/** Why the server ID cannot be used, if it cannot. */
export function guildIdProblem(guildId: string): string | null {
  return guildId && !GUILD_ID.test(guildId) ? 'a Discord server ID is 17 to 20 digits (Server Settings › Widget)' : null;
}

/** Why a link cannot be shown as it is, if it cannot: it needs its title, and an address or a video. */
export function linkProblem(l: Pick<HubLink, 'title' | 'url'> & { readonly video?: Video | null }): string | null {
  if (!l.title) return 'needs a title before it can be shown';
  if (!l.url && !l.video) return 'needs an address or a video before it can be shown';
  return null;
}

const tooLong = (what: string, value: string, limit: number): Check | null =>
  value.length > limit ? deny(`${what} can be at most ${limit} characters`) : null;

/**
 * Whether a tidied hub can be saved: within the limits, with valid addresses and a readable accent; everything shown
 * has what it needs (a section its title, a link its title and address, the live line the server's ID). A hidden link
 * may be left unfinished, as a draft.
 */
export function checkHub(hub: Hub): Check {
  const { profile, discord } = hub;
  if (!profile.name) return deny('the hub needs a name');
  const long =
    tooLong('the name', profile.name, HUB_LIMITS.name) ??
    tooLong('the tagline', profile.tagline, HUB_LIMITS.tagline) ??
    tooLong('the bio', profile.bio, HUB_LIMITS.bio);
  if (long) return long;
  const accent = accentProblem(profile.accent);
  if (accent) return deny(accent);
  for (const kind of ['logo', 'cover', 'background'] as const) {
    const id = profile[kind];
    if (id !== null && !isHubImageId(id)) return deny(`that ${HUB_IMAGE_NAMES[kind]} is not one uploaded here`);
  }

  const invite = discord.invite && urlProblem(discord.invite, 'discord');
  if (invite) return deny(`the Discord invite: ${invite}`);
  const guild = guildIdProblem(discord.guildId);
  if (guild) return deny(guild);
  if (discord.widget && !discord.guildId) return deny("the live widget needs the Discord server's ID");

  if (hub.sections.length > HUB_LIMITS.sections) return deny(`the hub can have at most ${HUB_LIMITS.sections} sections`);
  const sectionIds = new Set<string>();
  const linkIds = new Set<string>();
  for (const section of hub.sections) {
    if (!isHubId(section.id) || sectionIds.has(section.id)) return deny('each section needs an ID of its own');
    sectionIds.add(section.id);
    const name = section.title || 'a section';
    if (section.shown && !section.title) return deny('a section needs a title before it can be shown');
    const long = tooLong(`a section's title`, section.title, HUB_LIMITS.sectionTitle);
    if (long) return long;
    if (section.links.length > HUB_LIMITS.linksPerSection) {
      return deny(`${name} can have at most ${HUB_LIMITS.linksPerSection} links`);
    }
    for (const l of section.links) {
      if (!isHubId(l.id) || linkIds.has(l.id)) return deny('each link needs an ID of its own');
      linkIds.add(l.id);
      const label = l.title || `a link in ${name}`;
      const unfinished = l.shown && linkProblem(l);
      if (unfinished) return deny(`${label} ${unfinished}`);
      const long = tooLong(`a link's title`, l.title, HUB_LIMITS.linkTitle) ?? tooLong(`a link's subtitle`, l.subtitle, HUB_LIMITS.subtitle);
      if (long) return long;
      const problem = l.url && urlProblem(l.url, 'link');
      if (problem) return deny(`${label}: ${problem}`);
    }
  }
  return OK;
}

/** Networks first, in the row's order; any other icon after them, in page order. */
function rowOrder(icon: HubIcon): number {
  const i = (SOCIAL_NETWORKS as readonly string[]).indexOf(icon);
  return i === -1 ? SOCIAL_NETWORKS.length : i;
}

/**
 * What visitors see: shown sections with their shown links, the icon row (every shown link marked for it, whether or
 * not its section is shown, so a section can be hidden and its icons kept), and the Discord card if it has an invite.
 */
export function publicHub(hub: Hub, version: number): PublicHub {
  const ready = (l: HubLink) => l.shown && !linkProblem(l);
  const links = hub.sections.flatMap((s) => s.links);
  return {
    version,
    profile: hub.profile,
    icons: links
      .filter((l) => ready(l) && l.iconRow)
      .map((l, i) => ({ l, i }))
      .sort((a, b) => rowOrder(a.l.icon) - rowOrder(b.l.icon) || a.i - b.i)
      .map(({ l }) => ({ id: l.id, title: l.title, url: l.url, video: l.video, icon: l.icon })),
    discord: hub.discord.invite ? { invite: hub.discord.invite, live: hub.discord.widget && !!hub.discord.guildId } : null,
    sections: hub.sections
      .filter((s) => s.shown && s.title)
      .map((s) => ({ id: s.id, title: s.title, links: s.links.filter(ready).map(({ shown: _, iconRow: __, ...l }) => l) }))
      .filter((s) => s.links.length > 0),
  };
}

// --- Clicks ------------------------------------------------------------------------------------------------------

/**
 * What a click is counted against: a link, as a card or in the icon row (`link-<id>`), or the Discord card's button
 * (`discord`). Each is a document of `hub_clicks`.
 */
export type ClickTarget = 'discord' | `link-${string}`;

export const linkTarget = (id: string): ClickTarget => `link-${id}`;

/** The targets a visitor can click now: anything else is not counted (404), so no one can add arbitrary counters. */
export function clickTargets(hub: PublicHub): ClickTarget[] {
  const ids = new Set([...hub.icons.map((l) => l.id), ...hub.sections.flatMap((s) => s.links.map((l) => l.id))]);
  return [...(hub.discord ? ['discord' as const] : []), ...[...ids].map(linkTarget)];
}

/** How many days the admin view sums for "recent" clicks. */
export const RECENT_DAYS = 30;

/** A UTC day, `YYYY-MM-DD`: clicks are counted per day, so recent ones can be told from old ones. */
export function clickDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** `hub_clicks/{target}`: a total and a count per UTC day. Nothing about who clicked. */
export interface HubClicksRecord {
  readonly total: number;
  readonly days: Readonly<Record<string, number>>;
}

/** `GET /v1/admin/hub/clicks`: each target's total, its last 30 days, and the first day it was clicked. */
export interface HubClickCount {
  readonly target: string;
  readonly total: number;
  readonly recent: number;
  readonly since: string | null;
}

/** A target's counts as the admin view shows them, `today` being the current UTC day. */
export function clickCount(target: string, record: Partial<HubClicksRecord> | undefined, today: string): HubClickCount {
  const days = Object.entries(record?.days ?? {}).filter(([, n]) => typeof n === 'number');
  const from = new Date(Date.parse(today) - (RECENT_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  return {
    target,
    total: typeof record?.total === 'number' ? record.total : 0,
    recent: days.filter(([day]) => day >= from && day <= today).reduce((sum, [, n]) => sum + n, 0),
    since: days.map(([day]) => day).sort()[0] ?? null,
  };
}

// --- Changes -----------------------------------------------------------------------------------------------------

/** A link's change that is not an edit of its words, address or icon. */
export type LinkChangeKind =
  | 'added'
  | 'removed'
  | 'moved'
  | 'shown'
  | 'hidden'
  | 'starred'
  | 'unstarred'
  | 'into_icon_row'
  | 'out_of_icon_row';

/** One difference between two hubs, as the ledger records it (`hub.changed`) and the admin page lists it. */
export type HubChange =
  | { readonly part: 'profile'; readonly field: keyof HubProfile; readonly to: string | null }
  | { readonly part: 'discord'; readonly field: keyof HubDiscord; readonly to: string | boolean }
  | {
      readonly part: 'section';
      readonly id: string;
      readonly title: string;
      readonly change: 'added' | 'removed' | 'renamed' | 'shown' | 'hidden';
    }
  | { readonly part: 'section_order'; readonly to: readonly string[] }
  | {
      readonly part: 'link';
      readonly id: string;
      readonly title: string;
      /** The section it is in after the change (before it, when removed). */
      readonly section: string;
      readonly change: LinkChangeKind;
    }
  | {
      readonly part: 'link';
      readonly id: string;
      readonly title: string;
      readonly section: string;
      readonly change: 'edited';
      readonly fields: readonly ('title' | 'subtitle' | 'url' | 'video' | 'icon')[];
    }
  | { readonly part: 'link_order'; readonly section: string; readonly to: readonly string[] };

/** `hub.changed`: the hub's new version and every change in it. */
export interface HubChangedPayload {
  readonly version: number;
  readonly changes: readonly HubChange[];
}

/** Whether the items both lists hold are in a different order in `after`. */
function reordered(before: readonly string[], after: readonly string[]): boolean {
  const a = before.filter((id) => after.includes(id));
  const b = after.filter((id) => before.includes(id));
  return a.some((id, i) => id !== b[i]);
}

/** Every difference between two hubs: profile, the Discord card, then sections and links, in page order. */
export function hubChanges(before: Hub, after: Hub): HubChange[] {
  const changes: HubChange[] = [];
  for (const field of ['name', 'tagline', 'bio', 'logo', 'cover', 'accent', 'theme', 'background'] as const) {
    if (before.profile[field] !== after.profile[field]) changes.push({ part: 'profile', field, to: after.profile[field] });
  }
  for (const field of ['invite', 'guildId', 'widget'] as const) {
    if (before.discord[field] !== after.discord[field]) changes.push({ part: 'discord', field, to: after.discord[field] });
  }

  const sectionIds = (hub: Hub) => hub.sections.map((s) => s.id);
  for (const s of before.sections) {
    if (!after.sections.some((a) => a.id === s.id)) changes.push({ part: 'section', id: s.id, title: s.title, change: 'removed' });
  }
  for (const s of after.sections) {
    const was = before.sections.find((b) => b.id === s.id);
    if (!was) changes.push({ part: 'section', id: s.id, title: s.title, change: 'added' });
    else {
      if (was.title !== s.title) changes.push({ part: 'section', id: s.id, title: s.title, change: 'renamed' });
      if (was.shown !== s.shown) changes.push({ part: 'section', id: s.id, title: s.title, change: s.shown ? 'shown' : 'hidden' });
    }
  }
  if (reordered(sectionIds(before), sectionIds(after))) changes.push({ part: 'section_order', to: sectionIds(after) });

  const links = (hub: Hub) => new Map(hub.sections.flatMap((s) => s.links.map((l) => [l.id, { link: l, section: s.id }] as const)));
  const was = links(before);
  const now = links(after);
  for (const [id, { link: l, section }] of was) {
    if (!now.has(id)) changes.push({ part: 'link', id, title: l.title, section, change: 'removed' });
  }
  for (const section of after.sections) {
    for (const l of section.links) {
      const old = was.get(l.id);
      const base = { part: 'link', id: l.id, title: l.title, section: section.id } as const;
      if (!old) {
        changes.push({ ...base, change: 'added' });
        continue;
      }
      if (old.section !== section.id) changes.push({ ...base, change: 'moved' });
      const fields = (['title', 'subtitle', 'url', 'video', 'icon'] as const).filter((f) => JSON.stringify(old.link[f]) !== JSON.stringify(l[f]));
      if (fields.length) changes.push({ ...base, change: 'edited', fields });
      if (old.link.shown !== l.shown) changes.push({ ...base, change: l.shown ? 'shown' : 'hidden' });
      if (old.link.featured !== l.featured) changes.push({ ...base, change: l.featured ? 'starred' : 'unstarred' });
      if (old.link.iconRow !== l.iconRow) changes.push({ ...base, change: l.iconRow ? 'into_icon_row' : 'out_of_icon_row' });
    }
    const previous = before.sections.find((b) => b.id === section.id);
    const ids = section.links.map((l) => l.id);
    if (previous && reordered(previous.links.map((l) => l.id), ids)) changes.push({ part: 'link_order', section: section.id, to: ids });
  }
  return changes;
}

// --- Input -------------------------------------------------------------------------------------------------------

/** Raw text is capped well above the limits, which apply once the whitespace is tidied. */
const part = z.string().max(1000);

const linkSchema = z.strictObject({
  id: part,
  title: part,
  subtitle: part,
  url: part,
  video: videoSchema.nullable().default(null),
  icon: z.enum(HUB_ICONS),
  shown: z.boolean(),
  iconRow: z.boolean(),
  featured: z.boolean(),
});

/** `PUT /v1/admin/hub`: the whole hub, and the version it was edited from. */
export const hubSchema = z.strictObject({
  basedOn: z.number().int().min(0),
  profile: z.strictObject({
    name: part,
    tagline: part,
    bio: part,
    logo: z.string().max(64).nullable(),
    cover: z.string().max(64).nullable(),
    accent: part,
    theme: z.enum(HUB_THEMES),
    background: z.string().max(64).nullable(),
  }),
  discord: z.strictObject({ invite: part, guildId: part, widget: z.boolean() }),
  sections: z
    .array(z.strictObject({ id: part, title: part, shown: z.boolean(), links: z.array(linkSchema).max(HUB_LIMITS.linksPerSection) }))
    .max(HUB_LIMITS.sections),
});
export type HubInput = z.infer<typeof hubSchema>;
