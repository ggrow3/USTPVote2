import { describe, expect, it } from 'vitest';
import type { PublicBillCard } from '../bills/index.js';
import type { PublicEventSummary } from '../communications/events.js';
import type { PublicNewsSummary } from '../communications/news.js';
import type { CourseMapEntry } from '../course-map.js';
import {
  DISCORD_COMMANDS,
  discordCommandReply,
  discordCommandsFingerprint,
  discordCommandsPayload,
  discordCommandsStatus,
  discordInteractionNote,
  discordInteractionReply,
  discordPlain,
  discordSharedCommand,
  isDiscordCommand,
  type DiscordAppState,
} from './commands.js';

const ORIGIN = 'https://vote.example.org';

const event = (over: Partial<PublicEventSummary>): PublicEventSummary => ({
  slug: 'town-hall',
  kind: 'meeting' as PublicEventSummary['kind'],
  title: 'Town hall',
  summary: '',
  startsAt: '2026-12-01T18:00:00.000Z',
  endsAt: '2026-12-01T19:00:00.000Z',
  timeZone: 'America/New_York',
  attendance: 'online' as PublicEventSummary['attendance'],
  place: '',
  speakers: [],
  status: 'published',
  recorded: false,
  partners: [],
  ...over,
});

const news = (slug: string, publishedAt: string): PublicNewsSummary => ({ slug, kind: 'news', title: `Post ${slug}`, summary: '', dateline: '', hashtags: [], publishedAt, editedAt: null });

const course = (over: Partial<CourseMapEntry>): CourseMapEntry => ({
  courseId: 'intro',
  title: 'Introduction',
  summary: null,
  published: true,
  lessonCount: 3,
  prerequisites: [],
  position: null,
  openToGuests: false,
  ...over,
});

describe('the commands Discord is told of', () => {
  it('are chat commands with names and descriptions Discord accepts', () => {
    const payload = discordCommandsPayload();
    expect(payload.map((c) => c.name)).toEqual(['vote', 'events', 'news', 'bills', 'courses', 'join', 'link', 'help']);
    for (const command of payload) {
      expect(command.type).toBe(1);
      expect(command.name).toMatch(/^[a-z]{1,32}$/);
      expect(command.description.length).toBeGreaterThan(0);
      expect(command.description.length).toBeLessThanOrEqual(100);
    }
    expect(isDiscordCommand('vote')).toBe(true);
    expect(isDiscordCommand('ask')).toBe(false);
    expect(isDiscordCommand(undefined)).toBe(false);
  });

  it('are due again when the commands or the address change', () => {
    expect(discordCommandsFingerprint('https://a.example/interactions')).toBe(discordCommandsFingerprint('https://a.example/interactions'));
    expect(discordCommandsFingerprint('https://a.example/interactions')).not.toBe(discordCommandsFingerprint('https://b.example/interactions'));
  });

  it('show on the admin page only what was done for the address in use', () => {
    const endpoint = 'https://a.example/interactions';
    const state: DiscordAppState = {
      tokenVersion: 'v1',
      fingerprint: discordCommandsFingerprint(endpoint),
      applicationId: '1',
      publicKey: 'ab'.repeat(32),
      endpointSet: true,
      registered: true,
      problem: null,
      triedAt: '2026-11-13T00:00:00.000Z',
    };
    expect(discordCommandsStatus(endpoint, state)).toEqual({ endpoint, registered: true, endpointSet: true, problem: null, triedAt: state.triedAt });
    expect(discordCommandsStatus('https://b.example/interactions', state)).toMatchObject({ registered: false, endpointSet: false, triedAt: null });
    expect(discordCommandsStatus(null, state)).toEqual({ endpoint: null, registered: false, endpointSet: false, problem: null, triedAt: null });
    expect(discordCommandsStatus(endpoint, undefined)).toMatchObject({ endpoint, registered: false });
    // The worker keeps the key before the rest: such a record is not yet a finished try.
    expect(discordCommandsStatus(endpoint, { applicationId: '1', publicKey: 'ab'.repeat(32) } as DiscordAppState)).toMatchObject({ registered: false, problem: null });
  });
});

describe('a command’s answer', () => {
  it('lists the open votes, soonest first as given, with Discord times', () => {
    const reply = discordCommandReply({ command: 'vote', votes: [{ electionId: 'e1', title: 'Platform *vote*', closesAt: '2026-12-01T00:00:00.000Z' }] }, ORIGIN);
    expect(reply).toEqual({
      title: 'One vote is open',
      text: '• **Platform \\*vote\\***: closes <t:1796083200:R>, at <t:1796083200:F>\n\nMembers on the voter roll vote on the site.',
      url: `${ORIGIN}/ballot?utm_source=discord`,
    });
    expect(discordCommandReply({ command: 'vote', votes: [] }, ORIGIN)).toMatchObject({ title: 'No vote is open right now', url: `${ORIGIN}/?utm_source=discord` });
  });

  it('lists five at most and says how many more there are', () => {
    const posts = Array.from({ length: 7 }, (_, i) => news(`p${i}`, `2026-11-0${i + 1}T00:00:00.000Z`));
    const reply = discordCommandReply({ command: 'news', posts }, ORIGIN);
    const lines = reply.text.split('\n');
    expect(lines).toHaveLength(6);
    // Newest first, whatever order the site gave.
    expect(lines[0]).toBe(`• [Post p6](${ORIGIN}/news/p6?utm_source=discord) (<t:${Date.parse('2026-11-07T00:00:00.000Z') / 1000}:R>)`);
    expect(lines[5]).toBe('…and 2 more posts on the site.');
  });

  it('leaves cancelled events and unpublished courses out', () => {
    const events = discordCommandReply({ command: 'events', page: { upcoming: [event({ status: 'cancelled', title: 'Off' }), event({})], past: [event({ title: 'Old' })] } }, ORIGIN);
    expect(events.text).toContain('[Town hall]');
    expect(events.text).not.toContain('Off');
    expect(events.text).not.toContain('Old');
    expect(discordCommandReply({ command: 'events', page: { upcoming: [event({ status: 'cancelled' })], past: [] } }, ORIGIN).title).toBe('No events are planned right now');

    const courses = discordCommandReply({ command: 'courses', map: { courses: [course({}), course({ courseId: 'soon', title: 'Coming soon', published: false }), course({ courseId: 'open', title: 'Open', openToGuests: true })] } }, ORIGIN);
    expect(courses.text).toBe(`• [Introduction](${ORIGIN}/course/intro?utm_source=discord)\n• [Open](${ORIGIN}/course/open?utm_source=discord) (no sign-in needed)`);
  });

  it('names a bill with its number and where it stands', () => {
    const bill = { id: '119-hr-1', label: 'H.R. 1', title: 'A bill', status: 'introduced' } as PublicBillCard;
    expect(discordCommandReply({ command: 'bills', bills: [bill] }, ORIGIN).text).toMatch(/^• \[H\.R\. 1: A bill\]\(https:\/\/vote\.example\.org\/legislation\/119-hr-1\?utm_source=discord\) \(.+\)$/);
  });

  it('answers join and help without reading anything', () => {
    expect(discordCommandReply({ command: 'join' }, ORIGIN).url).toBe(`${ORIGIN}/register?utm_source=discord`);
    const link = discordCommandReply({ command: 'link' }, ORIGIN);
    expect(link.url).toBe(`${ORIGIN}/account?utm_source=discord`);
    expect(link.text).toContain('tells Discord');
    const help = discordCommandReply({ command: 'help' }, ORIGIN).text;
    for (const command of DISCORD_COMMANDS) expect(help).toContain(`\`/${command.name}\``);
  });

  it('keeps an admin’s title as plain text on one line', () => {
    expect(discordPlain('A [link](https://evil.example) @everyone\n<@1> `x`')).toBe('A \\[link\\]\\(https://evil.example\\) \\@everyone \\<\\@1\\> \\`x\\`');
    expect(discordPlain('x'.repeat(300))).toHaveLength(100);
  });
});

describe('what Discord is answered', () => {
  const reply = { title: 'T', text: 'Text', url: 'https://vote.example.org/' };

  it('is private with a button to post it, and public without one once posted', () => {
    const own = discordInteractionReply(reply, { shared: false, command: 'news' });
    expect(own).toEqual({
      type: 4,
      data: {
        embeds: [{ title: 'T', description: 'Text', url: reply.url }],
        allowed_mentions: { parse: [] },
        flags: 64,
        components: [{ type: 1, components: [{ type: 2, style: 2, label: 'Post in channel', custom_id: 'share:news' }] }],
      },
    });
    expect(discordInteractionReply(reply, { shared: true })).toEqual({ type: 4, data: { embeds: [{ title: 'T', description: 'Text', url: reply.url }], allowed_mentions: { parse: [] } } });
    // Nobody needs the list of commands posted for them.
    expect(discordInteractionReply(reply, { shared: false, command: 'help' }).data).not.toHaveProperty('components');
  });

  it('reads only its own buttons', () => {
    expect(discordSharedCommand('share:vote')).toBe('vote');
    expect(discordSharedCommand('share:ask')).toBeNull();
    expect(discordSharedCommand('vote')).toBeNull();
    expect(discordSharedCommand(7)).toBeNull();
  });

  it('can say a short thing privately', () => {
    expect(discordInteractionNote('Try again.')).toEqual({ type: 4, data: { content: 'Try again.', flags: 64, allowed_mentions: { parse: [] } } });
  });
});
