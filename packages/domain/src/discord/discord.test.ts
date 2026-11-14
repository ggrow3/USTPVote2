import { describe, expect, it } from 'vitest';
import { LEDGER_EVENT_TYPES, type LedgerEventType } from '../ledger-events.js';
import { isPublicLedgerEvent } from '../ledger.js';
import {
  checkDiscordToken,
  DEFAULT_DISCORD_SETTINGS,
  DISCORD_FEED_KINDS,
  DISCORD_TITLE_LIMIT,
  discordLedgerInterest,
  discordMessage,
  discordPost,
  discordPostId,
  discordSettingsChanges,
  discordSettingsSchema,
  discordTestPost,
  resolveDiscordSettings,
  type DiscordFeedItem,
} from './discord.js';

const ORIGIN = 'https://vote.example.org';
const CLOSES = '2026-12-01T18:00:00.000Z';
const UNIX = Date.parse(CLOSES) / 1000;

describe('which ledger entries the bot posts about', () => {
  /** Everything the bot may speak of. Adding to this list is a decision about what leaves the site (design §10.18). */
  const POSTED: readonly LedgerEventType[] = ['news.published', 'election.opened', 'results.computed', 'results.certified', 'event.published', 'event.cancelled', 'bills.public_changed'];

  const full = {
    postId: 'p1',
    slug: 'a-post',
    title: 'A post',
    kind: 'news',
    electionId: 'e1',
    eventId: 'ev1',
    startsAt: CLOSES,
    billId: '119-hr-1',
    change: 'published',
    accountId: 'member-1',
  };

  it('is an allow-list: every other entry type is nothing to Discord', () => {
    for (const type of LEDGER_EVENT_TYPES) {
      const interest = discordLedgerInterest({ type, payload: full });
      expect(interest !== null, type).toBe(POSTED.includes(type));
    }
  });

  it('never posts about a member, an account, a role or a team', () => {
    for (const type of LEDGER_EVENT_TYPES.filter((t) => /^(member|identity|account|role|team|room|forum|approval)\./.test(t))) {
      expect(discordLedgerInterest({ type, payload: full }), type).toBeNull();
    }
  });

  it('never posts about its own posts, which would loop', () => {
    expect(discordLedgerInterest({ type: 'discord.posted', payload: full })).toBeNull();
    expect(isPublicLedgerEvent('discord.posted')).toBe(false);
  });

  it('takes from a payload only what the public page shows', () => {
    expect(discordLedgerInterest({ type: 'news.published', payload: { ...full, kind: 'press_release' } })).toEqual({
      what: 'news_published',
      postId: 'p1',
      slug: 'a-post',
      title: 'A post',
      pressRelease: true,
    });
    expect(discordLedgerInterest({ type: 'results.computed', payload: { electionId: 'e1', participationCount: 12, tieBreakSeed: 's' } })).toEqual({
      what: 'results_provisional',
      electionId: 'e1',
    });
  });

  it('posts a bill when it is first shown, not when it changes or is taken off', () => {
    expect(discordLedgerInterest({ type: 'bills.public_changed', payload: { billId: 'b', change: 'published' } })).toEqual({ what: 'bill_published', billId: 'b' });
    expect(discordLedgerInterest({ type: 'bills.public_changed', payload: { billId: 'b', change: 'changed' } })).toBeNull();
    expect(discordLedgerInterest({ type: 'bills.public_changed', payload: { billId: 'b', change: 'withdrawn' } })).toBeNull();
  });

  it('skips an entry whose payload lacks what the post needs', () => {
    expect(discordLedgerInterest({ type: 'news.published', payload: { postId: 'p1' } })).toBeNull();
    expect(discordLedgerInterest({ type: 'election.opened', payload: {} })).toBeNull();
  });
});

describe('a post', () => {
  const items: DiscordFeedItem[] = [
    { what: 'news_published', postId: 'p1', slug: 'a-post', title: 'A post', pressRelease: false },
    { what: 'voting_open', electionId: 'e1', title: 'Officer election', closesAt: CLOSES },
    { what: 'voting_closing', electionId: 'e1', title: 'Officer election', closesAt: CLOSES },
    { what: 'results_provisional', electionId: 'e1', title: 'Officer election', closesAt: CLOSES },
    { what: 'results_certified', electionId: 'e1', title: 'Officer election', closesAt: CLOSES },
    { what: 'event_published', eventId: 'ev1', slug: 'town-hall', title: 'Town hall', startsAt: CLOSES },
    { what: 'event_cancelled', eventId: 'ev1', slug: 'town-hall', title: 'Town hall', startsAt: CLOSES },
    { what: 'event_tomorrow', eventId: 'ev1', slug: 'town-hall', title: 'Town hall', startsAt: CLOSES },
    { what: 'bill_published', billId: '119-hr-1', title: 'A bill' },
    { what: 'course_published', courseId: 'c1', title: 'Introduction' },
  ];

  it('links to the page on the site, marked as coming from Discord', () => {
    const urls = items.map((item) => discordPost(item, ORIGIN).url);
    expect(urls).toEqual([
      `${ORIGIN}/news/a-post?utm_source=discord`,
      `${ORIGIN}/ballot?utm_source=discord`,
      `${ORIGIN}/ballot?utm_source=discord`,
      `${ORIGIN}/results/e1?utm_source=discord`,
      `${ORIGIN}/results/e1?utm_source=discord`,
      `${ORIGIN}/events/town-hall?utm_source=discord`,
      `${ORIGIN}/events/town-hall?utm_source=discord`,
      `${ORIGIN}/events/town-hall?utm_source=discord`,
      `${ORIGIN}/legislation/119-hr-1?utm_source=discord`,
      `${ORIGIN}/course/c1?utm_source=discord`,
    ]);
  });

  it('goes to its kind’s channel, and has a ref of its own', () => {
    const posts = items.map((item) => discordPost(item, ORIGIN));
    expect(posts.map((p) => p.kind)).toEqual(['news', 'votes', 'votes', 'votes', 'votes', 'events', 'events', 'events', 'legislation', 'courses']);
    expect(new Set(posts.map((p) => p.ref)).size).toBe(items.length);
    for (const kind of posts.map((p) => p.kind)) expect(DISCORD_FEED_KINDS).toContain(kind);
  });

  it('gives times as Discord shows them in each reader’s own time zone', () => {
    const post = discordPost(items[1]!, ORIGIN);
    expect(post.title).toBe('Voting is open: Officer election');
    expect(post.text).toContain(`<t:${UNIX}:F>`);
    expect(post.text).toContain(`<t:${UNIX}:R>`);
  });

  it('cuts a title Discord would refuse', () => {
    const post = discordPost({ what: 'news_published', postId: 'p', slug: 's', title: 'x'.repeat(400), pressRelease: true }, ORIGIN);
    expect(post.title).toHaveLength(DISCORD_TITLE_LIMIT);
    expect(post.title.endsWith('…')).toBe(true);
  });

  it('is sent as one card that pings nobody, whatever its title says', () => {
    const post = discordPost({ what: 'news_published', postId: 'p', slug: 's', title: '@everyone look', pressRelease: false }, ORIGIN);
    expect(discordMessage(post)).toEqual({
      embeds: [{ title: '@everyone look', description: 'News from the party.', url: `${ORIGIN}/news/s?utm_source=discord` }],
      allowed_mentions: { parse: [] },
    });
  });

  it('has a record ID Firestore accepts', () => {
    expect(discordPostId('bill_published:119/hr 1')).toBe('bill_published:119_hr_1');
    expect(discordPostId(discordPost(items[8]!, ORIGIN).ref)).toBe('bill_published:119-hr-1');
  });

  it('has a test card for each kind', () => {
    expect(discordTestPost('votes', ORIGIN)).toMatchObject({ kind: 'votes', url: `${ORIGIN}/?utm_source=discord` });
    expect(discordTestPost('votes', ORIGIN).text).toContain('votes and results');
    expect(discordTestPost('legislation', ORIGIN).text).toContain('bills in Congress');
  });
});

describe('the settings', () => {
  it('are off, with no channels, until someone saves them', () => {
    expect(resolveDiscordSettings(undefined)).toEqual(DEFAULT_DISCORD_SETTINGS);
    expect(DEFAULT_DISCORD_SETTINGS.enabled).toBe(false);
  });

  it('keep a kind added later without a channel', () => {
    expect(resolveDiscordSettings({ enabled: true, channels: { news: '123456789012345678' } }).channels).toEqual({
      ...DEFAULT_DISCORD_SETTINGS.channels,
      news: '123456789012345678',
    });
  });

  it('take a channel ID only', () => {
    const input = { basedOn: 0, enabled: true, channels: { news: '123456789012345678', votes: null, events: null, legislation: null, courses: null } };
    expect(discordSettingsSchema.safeParse(input).success).toBe(true);
    for (const bad of ['#news', 'https://discord.com/channels/1/2', '12345', '']) {
      expect(discordSettingsSchema.safeParse({ ...input, channels: { ...input.channels, news: bad } }).success, bad).toBe(false);
    }
  });

  it('list what changed, for the ledger', () => {
    const after = { ...DEFAULT_DISCORD_SETTINGS, enabled: true, channels: { ...DEFAULT_DISCORD_SETTINGS.channels, votes: '123456789012345678' } };
    expect(discordSettingsChanges(DEFAULT_DISCORD_SETTINGS, after)).toEqual([
      { field: 'enabled', from: false, to: true },
      { field: 'channels.votes', from: null, to: '123456789012345678' },
    ]);
    expect(discordSettingsChanges(after, after)).toEqual([]);
  });
});

describe('a pasted bot token', () => {
  const token = `${'A'.repeat(26)}.${'b'.repeat(6)}.${'c'.repeat(38)}`;

  it('is three parts joined by dots', () => {
    expect(checkDiscordToken(token).ok).toBe(true);
  });

  it('is refused when it is something else, before it is sent anywhere', () => {
    expect(checkDiscordToken('a'.repeat(64)).ok).toBe(false); // the public key
    expect(checkDiscordToken('abc.def.ghi').ok).toBe(false);
    expect(checkDiscordToken(`${token} `).ok).toBe(false);
  });
});
