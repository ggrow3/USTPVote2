import { z } from 'zod';
import { deny, OK, type Check } from '../check.js';
import type { LedgerEntry } from '../ledger-events.js';

/**
 * The party's Discord bot (design §10.18): the app posts what happens on the site (news, votes, events, bills, courses)
 * to the channels Communications Admins choose on the party's Discord server. Only what the public pages already show
 * goes there, with a link back: never who voted, a member's name, or anything said in the forum, the members' room or
 * a private message. The bot's token is kept in Secret Manager, written by the api and read only by the worker.
 */

/** The Secret Manager secret that holds the bot's token; Terraform creates it empty. */
export const DISCORD_BOT_TOKEN_SECRET = 'discord-bot-token';

/**
 * What the bot posts about, each to a channel of its own (or none). `community` is where its weekly posts and the
 * Start here message go ("Loops").
 */
export const DISCORD_FEED_KINDS = ['news', 'votes', 'events', 'legislation', 'courses', 'community'] as const;
export type DiscordFeedKind = (typeof DISCORD_FEED_KINDS)[number];

/** How this deployment reaches Discord (`DISCORD`): for real, the emulators' stand-in that records posts, or not at all. */
export type DiscordMode = 'live' | 'stub' | 'off';

export interface DiscordSettings {
  /** The bot as a whole; off until a Communications Admin switches it on. Off, nothing is posted, and nothing is posted later of what happened meanwhile. */
  readonly enabled: boolean;
  /** The channel each kind of post goes to, as Discord's channel ID; null posts nothing of that kind. */
  readonly channels: Readonly<Record<DiscordFeedKind, string | null>>;
  /** The party's server, as Discord's ID of it; with `memberRoleId`, what the bot needs to give linked members their role. */
  readonly guildId: string | null;
  /** The role linked Active members hold on the server; null gives no role. */
  readonly memberRoleId: string | null;
  /** The weekly posts, each with a switch of its own; all off until switched on. They go to the `community` channel. */
  readonly loops: Readonly<Record<DiscordLoop, boolean>>;
}

/** The bot's weekly posts: the week's digest, a question as a Discord poll, and what members did. */
export const DISCORD_LOOPS = ['digest', 'question', 'members'] as const;
export type DiscordLoop = (typeof DISCORD_LOOPS)[number];

export const DEFAULT_DISCORD_SETTINGS: DiscordSettings = {
  enabled: false,
  channels: { news: null, votes: null, events: null, legislation: null, courses: null, community: null },
  guildId: null,
  memberRoleId: null,
  loops: { digest: false, question: false, members: false },
};

/** `discord_settings/current`; version 0 (never saved) is the defaults. */
export interface DiscordSettingsRecord extends DiscordSettings {
  /** Counts saves, so an edit made from an older copy is refused instead of undoing someone else's. */
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

/** The stored settings with anything missing taken from the defaults (a kind added later has no channel yet). */
export function resolveDiscordSettings(
  stored:
    | (Partial<Omit<DiscordSettings, 'channels' | 'loops'>> & { readonly channels?: Partial<DiscordSettings['channels']>; readonly loops?: Partial<DiscordSettings['loops']> })
    | undefined
    | null,
): DiscordSettings {
  return {
    enabled: stored?.enabled ?? DEFAULT_DISCORD_SETTINGS.enabled,
    channels: { ...DEFAULT_DISCORD_SETTINGS.channels, ...stored?.channels },
    guildId: stored?.guildId ?? null,
    memberRoleId: stored?.memberRoleId ?? null,
    loops: { ...DEFAULT_DISCORD_SETTINGS.loops, ...stored?.loops },
  };
}

/** A Discord ID (a "snowflake"): 17 to 20 digits. Copied in Discord with Developer Mode on: right-click a channel, Copy Channel ID. */
export const DISCORD_ID = /^\d{17,20}$/;

const channel = z
  .string()
  .trim()
  .regex(DISCORD_ID, 'a channel ID is 17 to 20 digits: in Discord, switch on Developer Mode, right-click the channel and choose Copy Channel ID')
  .nullable();

const snowflake = (what: string, how: string) => z.string().trim().regex(DISCORD_ID, `a ${what} ID is 17 to 20 digits: in Discord, switch on Developer Mode, ${how}`).nullable();

/** `PUT /v1/admin/discord/settings`: the whole settings, and the version they were edited from. */
export const discordSettingsSchema = z.strictObject({
  basedOn: z.number().int().min(0),
  enabled: z.boolean(),
  channels: z.strictObject({
    news: channel,
    votes: channel,
    events: channel,
    legislation: channel,
    // A page opened before a kind existed saves without it, which keeps what was set.
    courses: channel.optional(),
    community: channel.optional(),
  }),
  // Likewise for what linking and the weekly posts added.
  guildId: snowflake('server', 'right-click the server and choose Copy Server ID').optional(),
  memberRoleId: snowflake('role', 'open Server Settings › Roles, right-click the role and choose Copy Role ID').optional(),
  loops: z.strictObject({ digest: z.boolean(), question: z.boolean(), members: z.boolean() }).optional(),
});
export type DiscordSettingsInput = z.infer<typeof discordSettingsSchema>;

/** One setting that changed: its path (`enabled`, `channels.news`) and its old and new value. */
export interface DiscordSettingsChange {
  readonly field: string;
  readonly from: string | boolean | null;
  readonly to: string | boolean | null;
}

/** `discord.settings_changed`: the settings' new version and every setting that changed in it. */
export interface DiscordSettingsChangedPayload {
  readonly version: number;
  readonly changes: readonly DiscordSettingsChange[];
}

export function discordSettingsChanges(before: DiscordSettings, after: DiscordSettings): DiscordSettingsChange[] {
  const changes: DiscordSettingsChange[] = [];
  if (before.enabled !== after.enabled) changes.push({ field: 'enabled', from: before.enabled, to: after.enabled });
  for (const kind of DISCORD_FEED_KINDS) {
    if (before.channels[kind] !== after.channels[kind]) {
      changes.push({ field: `channels.${kind}`, from: before.channels[kind], to: after.channels[kind] });
    }
  }
  if (before.guildId !== after.guildId) changes.push({ field: 'guildId', from: before.guildId, to: after.guildId });
  if (before.memberRoleId !== after.memberRoleId) changes.push({ field: 'memberRoleId', from: before.memberRoleId, to: after.memberRoleId });
  for (const loop of DISCORD_LOOPS) {
    if (before.loops[loop] !== after.loops[loop]) changes.push({ field: `loops.${loop}`, from: before.loops[loop], to: after.loops[loop] });
  }
  return changes;
}

// ---------------------------------------------------------------------------------------------------------------------
// The bot's token

/** `PUT /v1/admin/discord-token`. The token's shape is checked by `checkDiscordToken`, so no message repeats it. */
export const discordTokenSchema = z.strictObject({ token: z.string().trim().min(1).max(500) });
export type DiscordTokenInput = z.infer<typeof discordTokenSchema>;

/**
 * Whether a pasted text looks like a Discord bot token, before it is sent anywhere: three parts joined by dots. A
 * mistaken paste (the application's client secret or public key, which have no dots) is refused here. Discord itself
 * then says whether the token works.
 */
export function checkDiscordToken(token: string): Check {
  if (/\s/.test(token)) return deny('a bot token has no spaces or line breaks: paste only the token');
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
    return deny('a bot token is three parts joined by dots; this looks like something else (the client secret and the public key are not the token)');
  }
  if (token.length < 50) return deny('this is too short to be a bot token; copy all of it');
  return OK;
}

export const DISCORD_TOKEN_HINT_CHARACTERS = 4;
export const discordTokenHint = (token: string): string => token.slice(-DISCORD_TOKEN_HINT_CHARACTERS);

/** `discord_settings/token`: who added the token in use, and the bot it belongs to. Never the token. */
export interface DiscordTokenRecord {
  /** The Secret Manager version it was added as, to tell it from a token added another way since. */
  readonly version: string;
  readonly hint: string;
  /** The bot's name on Discord, as Discord gave it when the token was tried; null when it was not tried (the emulators). */
  readonly botName: string | null;
  readonly addedAt: string;
  readonly addedBy: string;
  readonly addedByName: string;
}

/** `GET /v1/admin/discord-token`: whether a token is set and whose, never the token. */
export interface DiscordTokenStatus {
  readonly set: boolean;
  readonly addedAt: string | null;
  /** Who added it in the app; null for a token added outside the app (with gcloud, say). */
  readonly addedBy: { readonly accountId: string; readonly name: string } | null;
  readonly hint: string | null;
  readonly botName: string | null;
  /** Whether a token is tried with Discord before it is kept (always, except with the emulators). */
  readonly tried: boolean;
  /** Why the server cannot tell (its Terraform is not applied yet); null when it can. */
  readonly unavailable: string | null;
}

/** `discord.token_changed`: a token was added (replacing any before it) or removed. Never the token or its hint. */
export interface DiscordTokenChangedPayload {
  readonly change: 'added' | 'removed';
}

// ---------------------------------------------------------------------------------------------------------------------
// What is posted

/** What happened on the site that the bot tells Discord about, with only what the public pages show of it. */
export type DiscordFeedItem =
  | { readonly what: 'news_published'; readonly postId: string; readonly slug: string; readonly title: string; readonly pressRelease: boolean }
  | {
      readonly what: 'voting_open' | 'voting_closing' | 'results_provisional' | 'results_certified';
      readonly electionId: string;
      readonly title: string;
      readonly closesAt: string;
    }
  | {
      readonly what: 'event_published' | 'event_cancelled' | 'event_tomorrow';
      readonly eventId: string;
      readonly slug: string;
      readonly title: string;
      readonly startsAt: string;
    }
  | { readonly what: 'bill_published'; readonly billId: string; readonly title: string }
  | { readonly what: 'course_published'; readonly courseId: string; readonly title: string };

export type DiscordFeedWhat = DiscordFeedItem['what'];

const KIND_OF: Readonly<Record<DiscordFeedWhat, DiscordFeedKind>> = {
  news_published: 'news',
  voting_open: 'votes',
  voting_closing: 'votes',
  results_provisional: 'votes',
  results_certified: 'votes',
  event_published: 'events',
  event_cancelled: 'events',
  event_tomorrow: 'events',
  bill_published: 'legislation',
  course_published: 'courses',
};

/** A post as the bot sends it: one card with a title that links to the site, and a line under it. */
export interface DiscordPost {
  readonly kind: DiscordFeedKind;
  /** What it is about (`voting_open:{electionId}`): one post is made per ref, ever. */
  readonly ref: string;
  readonly title: string;
  readonly text: string;
  readonly url: string;
}

/** Discord's own cap on a card's title. */
export const DISCORD_TITLE_LIMIT = 256;

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** A moment as Discord shows it in each reader's own time zone: in full (`F`) or as "in 3 hours" (`R`). */
export function discordTime(iso: string, style: 'F' | 'R'): string {
  return `<t:${Math.floor(Date.parse(iso) / 1000)}:${style}>`;
}

const subjectId = (item: DiscordFeedItem): string =>
  'postId' in item ? item.postId : 'electionId' in item ? item.electionId : 'eventId' in item ? item.eventId : 'billId' in item ? item.billId : item.courseId;

/** The post's ref: what happened and to what. Its record's ID, so the same thing is never posted twice. */
export const discordPostRef = (item: DiscordFeedItem): string => `${item.what}:${subjectId(item)}`;

/** `discord_posts/{id}` for a ref: Firestore IDs may not hold a slash, and bills' IDs are kept readable. */
export const discordPostId = (ref: string): string => ref.replace(/[^A-Za-z0-9_.:-]/g, '_');

/**
 * The post for something that happened, linking to its page on the site at `origin`. Links carry `utm_source=discord`,
 * so the site's own count of where visitors come from shows what Discord brings.
 */
export function discordPost(item: DiscordFeedItem, origin: string): DiscordPost {
  const page = (path: string) => `${origin}${path}?utm_source=discord`;
  const made = (title: string, text: string, url: string): DiscordPost => ({
    kind: KIND_OF[item.what],
    ref: discordPostRef(item),
    title: cut(title, DISCORD_TITLE_LIMIT),
    text,
    url,
  });
  switch (item.what) {
    case 'news_published':
      return made(item.title, item.pressRelease ? 'A new press release from the party.' : 'News from the party.', page(`/news/${item.slug}`));
    case 'voting_open':
      return made(
        `Voting is open: ${item.title}`,
        `Voting closes ${discordTime(item.closesAt, 'F')} (${discordTime(item.closesAt, 'R')}). Members on the voter roll vote on the site.`,
        page('/ballot'),
      );
    case 'voting_closing':
      return made(
        `Voting closes soon: ${item.title}`,
        `Voting closes ${discordTime(item.closesAt, 'R')}, at ${discordTime(item.closesAt, 'F')}. Members on the voter roll vote on the site.`,
        page('/ballot'),
      );
    case 'results_provisional':
      return made(
        `Results are in: ${item.title}`,
        'The ballots are counted and the results signed. They are provisional until two Election Admins certify them.',
        page(`/results/${item.electionId}`),
      );
    case 'results_certified':
      return made(`Results certified: ${item.title}`, 'Two Election Admins have certified the results. Anyone can check the count.', page(`/results/${item.electionId}`));
    case 'event_published':
      return made(`Event: ${item.title}`, `Starts ${discordTime(item.startsAt, 'F')} (${discordTime(item.startsAt, 'R')}).`, page(`/events/${item.slug}`));
    case 'event_cancelled':
      return made(`Cancelled: ${item.title}`, `This event, planned for ${discordTime(item.startsAt, 'F')}, has been cancelled.`, page(`/events/${item.slug}`));
    case 'event_tomorrow':
      return made(`Coming up: ${item.title}`, `Starts ${discordTime(item.startsAt, 'R')}, at ${discordTime(item.startsAt, 'F')}.`, page(`/events/${item.slug}`));
    case 'bill_published':
      return made(`Bill to watch: ${item.title}`, "The party's legislative team is following this bill in Congress.", page(`/legislation/${item.billId}`));
    case 'course_published':
      return made(`New course: ${item.title}`, 'A course is now open on the site.', page(`/course/${item.courseId}`));
  }
}

/**
 * Which ledger entries the bot posts about, and the record each needs read to say so: an allow-list. Every other entry,
 * and so everything about a member, an account or an admin's work, is nothing to Discord.
 */
export type DiscordLedgerInterest =
  | { readonly what: 'news_published'; readonly postId: string; readonly slug: string; readonly title: string; readonly pressRelease: boolean }
  | { readonly what: 'voting_open' | 'results_provisional' | 'results_certified'; readonly electionId: string }
  | { readonly what: 'event_published' | 'event_cancelled'; readonly eventId: string; readonly slug: string; readonly title: string; readonly startsAt: string }
  | { readonly what: 'bill_published'; readonly billId: string };

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

export function discordLedgerInterest(entry: Pick<LedgerEntry, 'type' | 'payload'>): DiscordLedgerInterest | null {
  const p = entry.payload;
  switch (entry.type) {
    case 'news.published': {
      const [postId, slug, title] = [str(p.postId), str(p.slug), str(p.title)];
      return postId && slug && title ? { what: 'news_published', postId, slug, title, pressRelease: p.kind === 'press_release' } : null;
    }
    case 'election.opened':
    case 'results.computed':
    case 'results.certified': {
      const electionId = str(p.electionId);
      const what = entry.type === 'election.opened' ? 'voting_open' : entry.type === 'results.computed' ? 'results_provisional' : 'results_certified';
      return electionId ? { what, electionId } : null;
    }
    case 'event.published':
    case 'event.cancelled': {
      const [eventId, slug, title, startsAt] = [str(p.eventId), str(p.slug), str(p.title), str(p.startsAt)];
      const what = entry.type === 'event.published' ? 'event_published' : 'event_cancelled';
      return eventId && slug && title && startsAt ? { what, eventId, slug, title, startsAt } : null;
    }
    case 'bills.public_changed': {
      const billId = str(p.billId);
      return billId && p.change === 'published' ? { what: 'bill_published', billId } : null;
    }
    default:
      return null;
  }
}

/** How long before voting closes, or an event starts, the bot says so. */
export const DISCORD_REMINDER_HOURS = 24;
/** A vote shorter than this gets no "closes soon" post: it would come on the heels of "voting is open". */
export const DISCORD_MIN_HOURS_FOR_REMINDER = 48;

/** `discord_state/feed`: how far the bot has read. Set when the bot is switched on, so it starts from then. */
export interface DiscordFeedState {
  /** The last ledger entry read. */
  readonly seq: number;
  /** Courses published from this moment on are still to be posted. */
  readonly since: string;
}

/** `discord_posts/{id}`: one post, made once. Kept so nothing is posted twice, and so the team sees what went out. */
export interface DiscordPostRecord extends DiscordPost {
  /** `sending` from the moment the worker takes it; one left so (the worker stopped mid-post) is not tried again. */
  readonly status: 'sending' | 'sent' | 'failed';
  readonly channelId: string;
  /** Discord's ID of the message, once sent. */
  readonly messageId: string | null;
  /** Why Discord refused it, when it did. */
  readonly problem: string | null;
  readonly createdAt: string;
  readonly sentAt: string | null;
}

/** `discord.posted`: the bot posted something to the party's Discord. What and where, as the post itself said in public. */
export interface DiscordPostedPayload {
  readonly ref: string;
  readonly kind: DiscordFeedKind;
  readonly channelId: string;
  readonly messageId: string;
}

/** `discord_state/test`: a Communications Admin's test post, queued for the worker (which alone can read the token). */
export interface DiscordTestRecord {
  readonly kind: DiscordFeedKind;
  readonly channelId: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly status: 'waiting' | 'sent' | 'failed';
  readonly problem: string | null;
  readonly doneAt: string | null;
}

/** `POST /v1/admin/discord/test` */
export const discordTestSchema = z.strictObject({ kind: z.enum(DISCORD_FEED_KINDS) });
export type DiscordTestInput = z.infer<typeof discordTestSchema>;

/** The test post's card. */
export function discordTestPost(kind: DiscordFeedKind, origin: string): Omit<DiscordPost, 'ref'> {
  return {
    kind,
    title: 'A test post from the site',
    text: `This is where the bot will post about ${discordKindPhrase(kind)}. A Communications Admin sent this test.`,
    url: `${origin}/?utm_source=discord`,
  };
}

export const DISCORD_KIND_LABELS: Readonly<Record<DiscordFeedKind, string>> = {
  news: 'News and press releases',
  votes: 'Votes and results',
  events: 'Events',
  legislation: 'Bills in Congress',
  courses: 'Courses',
  community: 'Weekly posts and Start here',
};

/** A kind's label inside a sentence ("bills in Congress"): its first letter lowered, names left alone. */
export const discordKindPhrase = (kind: DiscordFeedKind): string => DISCORD_KIND_LABELS[kind].charAt(0).toLowerCase() + DISCORD_KIND_LABELS[kind].slice(1);

/** `GET /v1/admin/discord`: the settings, whether the bot can post, and what it posted lately. */
export interface DiscordAdminView {
  readonly settings: DiscordSettingsRecord;
  readonly mode: DiscordMode;
  /** Whether a token is set; null when the server cannot tell yet. */
  readonly tokenSet: boolean | null;
  readonly botName: string | null;
  /** Whether the site knows its own address (`WEB_ORIGIN`), which every post's link needs. */
  readonly canLink: boolean;
  readonly test: DiscordTestRecord | null;
  /** The newest posts, newest first. */
  readonly recent: readonly DiscordPostRecord[];
  /** The slash commands: where Discord sends them, and whether it has been told. */
  readonly commands: import('./commands.js').DiscordCommandsStatus;
  /** Linked accounts, in counts: never who. */
  readonly links: import('./linking.js').DiscordLinksSummary;
  /** Whether members can link yet, and if not what is missing. */
  readonly linkBlocker: import('./linking.js').DiscordLinkBlocker | null;
  /** The questions of the week still waiting, oldest (next) first, then the last few posted. */
  readonly questions: readonly import('./loops.js').DiscordQuestionRecord[];
  readonly startHere: import('./loops.js').DiscordStartHereRecord | null;
}

/** What Discord is sent for a post: one embed, and no mention in it pings anyone. */
export function discordMessage(post: Pick<DiscordPost, 'title' | 'text' | 'url'>): Record<string, unknown> {
  return { embeds: [{ title: post.title, description: post.text, url: post.url }], allowed_mentions: { parse: [] } };
}
