import { BILL_STATUS_LABELS, type PublicBillCard } from '../bills/index.js';
import type { PublicEventsPage } from '../communications/events.js';
import type { PublicNewsSummary } from '../communications/news.js';
import type { CourseMap } from '../course-map.js';
import { DISCORD_TITLE_LIMIT, discordTime } from './discord.js';

/**
 * The Discord bot's slash commands (design §10.18, "Slash commands"). Each answers from what the site already shows
 * anyone: nothing here reads a member's record, and a command takes no words from the person who ran it.
 */
export const DISCORD_COMMANDS = [
  { name: 'vote', description: 'Votes open now, and when each closes' },
  { name: 'events', description: "The party's coming events" },
  { name: 'news', description: 'The latest news and press releases' },
  { name: 'bills', description: 'Bills in Congress the party is following' },
  { name: 'courses', description: 'Courses you can take on the site' },
  { name: 'join', description: 'How to join the party' },
  { name: 'help', description: 'What this bot can do' },
] as const;

export type DiscordCommandName = (typeof DISCORD_COMMANDS)[number]['name'];

export const isDiscordCommand = (name: unknown): name is DiscordCommandName => DISCORD_COMMANDS.some((command) => command.name === name);

/** What Discord is told the commands are (`PUT /applications/{id}/commands`): chat commands, with no options. */
export function discordCommandsPayload(): { name: string; description: string; type: 1 }[] {
  return DISCORD_COMMANDS.map(({ name, description }) => ({ name, description, type: 1 }));
}

/** `GET /v1/public/discord/app`: the key Discord signs each command with, which is public. Null until the worker has read it. */
export interface DiscordAppView {
  readonly publicKey: string | null;
}

/** `GET /v1/public/discord/votes`: a vote that is open now, soonest to close first. Rehearsals are left out. */
export interface DiscordOpenVote {
  readonly electionId: string;
  readonly title: string;
  readonly closesAt: string;
}

/**
 * `discord_state/app`: what the worker last told Discord about the commands, and what Discord told it of the
 * application. `problem` is why the last try did not finish; the worker tries again after a while, or at once when the
 * token, the commands or the address change.
 */
export interface DiscordAppState {
  /** The token it was done with (its Secret Manager version name), so a new token is noticed. */
  readonly tokenVersion: string;
  /** The commands and address it was done for (`discordCommandsFingerprint`). */
  readonly fingerprint: string;
  readonly applicationId: string | null;
  readonly publicKey: string | null;
  /** Whether Discord took the address it sends commands to, and the list of commands. */
  readonly endpointSet: boolean;
  readonly registered: boolean;
  readonly problem: string | null;
  readonly triedAt: string;
}

/** What makes a new sync due: the commands as Discord is told them, and where it sends them. */
export function discordCommandsFingerprint(endpoint: string): string {
  return JSON.stringify([endpoint, discordCommandsPayload()]);
}

/**
 * The worker tries a failed sync again after this long. Short on purpose: Discord calls the commands service before it
 * accepts its address, and the first call can find the service and the api both starting cold; two minutes later they
 * are still running, and the service still holds the key it read.
 */
export const DISCORD_SYNC_RETRY_MINUTES = 2;

/** What the Discord admin page shows of the commands. */
export interface DiscordCommandsStatus {
  /** Where Discord sends commands; null when this deployment has no commands service (`DISCORD_INTERACTIONS_URL`). */
  readonly endpoint: string | null;
  readonly registered: boolean;
  readonly endpointSet: boolean;
  readonly problem: string | null;
  readonly triedAt: string | null;
}

export function discordCommandsStatus(endpoint: string | null, state: DiscordAppState | null | undefined): DiscordCommandsStatus {
  const current = !!endpoint && !!state && state.fingerprint === discordCommandsFingerprint(endpoint);
  return {
    endpoint,
    registered: current && state.registered,
    endpointSet: current && state.endpointSet,
    problem: current ? state.problem : null,
    triedAt: current ? state.triedAt : null,
  };
}

// --- Replies ----------------------------------------------------------------------------------------------------------

/** What a command answers from, as the site's public routes give it. */
export type DiscordCommandData =
  | { readonly command: 'vote'; readonly votes: readonly DiscordOpenVote[] }
  | { readonly command: 'events'; readonly page: PublicEventsPage }
  | { readonly command: 'news'; readonly posts: readonly PublicNewsSummary[] }
  | { readonly command: 'bills'; readonly bills: readonly PublicBillCard[] }
  | { readonly command: 'courses'; readonly map: CourseMap }
  | { readonly command: 'join' }
  | { readonly command: 'help' };

export interface DiscordReply {
  readonly title: string;
  readonly text: string;
  readonly url: string;
}

/** Lines in one answer at most; the title links to the page with the rest. */
export const DISCORD_REPLY_ITEMS = 5;
const ITEM_TITLE_LIMIT = 100;

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** A title an admin wrote, as plain text inside a Discord link: its Markdown is escaped, and it stays on one line. */
export function discordPlain(text: string): string {
  return cut(text.replace(/\s+/g, ' ').trim(), ITEM_TITLE_LIMIT).replace(/[\\`*_~|>[\]()<@#]/g, '\\$&');
}

/** The embed a command answers with: a title linking to the site's page, and up to five lines. */
export function discordCommandReply(data: DiscordCommandData, origin: string): DiscordReply {
  const page = (path: string) => `${origin}${path}?utm_source=discord`;
  const link = (title: string, path: string) => `[${discordPlain(title)}](${page(path)})`;
  const list = (lines: readonly string[], total: number, noun: string) =>
    [...lines.map((line) => `• ${line}`), ...(total > lines.length ? [`…and ${total - lines.length} more ${noun} on the site.`] : [])].join('\n');
  const made = (title: string, text: string, path: string): DiscordReply => ({ title: cut(title, DISCORD_TITLE_LIMIT), text, url: page(path) });

  switch (data.command) {
    case 'vote': {
      if (!data.votes.length) return made('No vote is open right now', 'When voting opens, it is announced on the site.', '/');
      const lines = data.votes.slice(0, DISCORD_REPLY_ITEMS).map((v) => `**${discordPlain(v.title)}**: closes ${discordTime(v.closesAt, 'R')}, at ${discordTime(v.closesAt, 'F')}`);
      return made(
        data.votes.length === 1 ? 'One vote is open' : `${data.votes.length} votes are open`,
        `${list(lines, data.votes.length, 'votes')}\n\nMembers on the voter roll vote on the site.`,
        '/ballot',
      );
    }
    case 'events': {
      const coming = data.page.upcoming.filter((e) => e.status === 'published');
      if (!coming.length) return made('No events are planned right now', 'New events appear on the Events page.', '/events');
      const lines = coming.slice(0, DISCORD_REPLY_ITEMS).map((e) => `${link(e.title, `/events/${e.slug}`)}: ${discordTime(e.startsAt, 'F')} (${discordTime(e.startsAt, 'R')})`);
      return made('Coming events', list(lines, coming.length, 'events'), '/events');
    }
    case 'news': {
      if (!data.posts.length) return made('No news yet', 'News and press releases from the party appear on the News page.', '/news');
      const newest = [...data.posts].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      const lines = newest.slice(0, DISCORD_REPLY_ITEMS).map((p) => `${link(p.title, `/news/${p.slug}`)} (${discordTime(p.publishedAt, 'R')})`);
      return made('Latest news', list(lines, newest.length, 'posts'), '/news');
    }
    case 'bills': {
      if (!data.bills.length) return made('No bills are listed right now', "The bills the party's legislative team follows appear on the Legislation page.", '/legislation');
      const lines = data.bills.slice(0, DISCORD_REPLY_ITEMS).map((b) => `${link(`${b.label}: ${b.title}`, `/legislation/${b.id}`)} (${BILL_STATUS_LABELS[b.status]})`);
      return made('Bills the party is following', list(lines, data.bills.length, 'bills'), '/legislation');
    }
    case 'courses': {
      const open = data.map.courses.filter((c) => c.published);
      if (!open.length) return made('No courses are open yet', 'Courses appear on the Courses page as they are published.', '/courses');
      const lines = open.slice(0, DISCORD_REPLY_ITEMS).map((c) => `${link(c.title, `/course/${c.courseId}`)}${c.openToGuests ? ' (no sign-in needed)' : ''}`);
      return made('Courses on the site', list(lines, open.length, 'courses'), '/courses');
    }
    case 'join':
      return made(
        'Join the party',
        'Register on the site. Once your application is approved you can vote in party elections, take the courses and join teams.',
        '/register',
      );
    case 'help':
      return made('What this bot can do', DISCORD_COMMANDS.map((c) => `\`/${c.name}\`: ${c.description}`).join('\n'), '/');
  }
}

// --- Interactions -----------------------------------------------------------------------------------------------------

/** Discord's numbers for what it sends (interaction types) and what is answered (callback types). */
export const DISCORD_INTERACTION = { ping: 1, command: 2, component: 3 } as const;
export const DISCORD_CALLBACK = { pong: 1, message: 4 } as const;
/** Message flag: only the person who ran the command sees the answer. */
const EPHEMERAL = 64;

const SHARE_PREFIX = 'share:';

/** The command a pressed button asks to post in the channel, or null for any other button. */
export function discordSharedCommand(customId: unknown): DiscordCommandName | null {
  if (typeof customId !== 'string' || !customId.startsWith(SHARE_PREFIX)) return null;
  const name = customId.slice(SHARE_PREFIX.length);
  return isDiscordCommand(name) ? name : null;
}

/**
 * The answer to an interaction. A command's answer is shown to the person who ran it alone, with a button that posts
 * it in the channel (`shared`); nothing in it can mention anyone.
 */
export function discordInteractionReply(reply: DiscordReply, how: { readonly shared: true } | { readonly shared: false; readonly command: DiscordCommandName | null }) {
  const offerShare = !how.shared && how.command !== null && how.command !== 'help';
  return {
    type: DISCORD_CALLBACK.message,
    data: {
      embeds: [{ title: reply.title, description: reply.text, url: reply.url }],
      allowed_mentions: { parse: [] as string[] },
      ...(!how.shared && { flags: EPHEMERAL }),
      ...(offerShare && {
        components: [{ type: 1, components: [{ type: 2, style: 2, label: 'Post in channel', custom_id: `${SHARE_PREFIX}${how.command}` }] }],
      }),
    },
  };
}

/** A short private answer when a command cannot be answered (the site is waking, or the command is unknown). */
export function discordInteractionNote(text: string) {
  return { type: DISCORD_CALLBACK.message, data: { content: text, flags: EPHEMERAL, allowed_mentions: { parse: [] as string[] } } };
}
