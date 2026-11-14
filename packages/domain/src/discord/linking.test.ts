import { describe, expect, it } from 'vitest';
import { checkApiKey } from '../api-keys.js';
import { isPublicLedgerEvent } from '../ledger.js';
import { DEFAULT_DISCORD_SETTINGS, discordSettingsChanges, discordSettingsSchema, resolveDiscordSettings } from './discord.js';
import {
  discordAuthorizeUrl,
  discordLinkView,
  discordRoleNextCheck,
  discordRolesSet,
  discordRoleStep,
  newDiscordLink,
  type DiscordLinkRecord,
} from './linking.js';
import {
  discordDigestText,
  discordLoopDue,
  discordMembersWeekHasNews,
  discordMembersWeekText,
  discordPollMessage,
  discordQuestionSchema,
  discordStartHereMessage,
  discordWeekOf,
} from './loops.js';

const ORIGIN = 'https://vote.example.org';
const NOW = new Date('2026-11-16T12:00:00.000Z');
const link = (over: Partial<DiscordLinkRecord> = {}): DiscordLinkRecord => ({ ...newDiscordLink('acct-1', { id: '300000000000000001', name: 'Ada' }, NOW), ...over });

describe('linking a Discord account', () => {
  it('sends the member to Discord asking only who they are, and back to the site', () => {
    const url = new URL(discordAuthorizeUrl('100000000000000001', ORIGIN, 'a-word'));
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: '100000000000000001',
      scope: 'identify',
      state: 'a-word',
      redirect_uri: `${ORIGIN}/account/discord`,
      prompt: 'consent',
    });
  });

  it('starts unnamed in the weekly post, with no role', () => {
    expect(link()).toMatchObject({ celebrate: false, role: 'none', roleProblem: null, unlinkedAt: null, roleCheckAt: NOW.toISOString() });
  });

  it('shows the member their link, and nothing of one that was unlinked', () => {
    const facts = { blocker: null, rolesSet: true, activeMember: true };
    expect(discordLinkView(link({ role: 'given' }), facts).link).toEqual({ discordName: 'Ada', linkedAt: NOW.toISOString(), celebrate: false, role: 'given', roleProblem: null });
    expect(discordLinkView(link({ unlinkedAt: NOW.toISOString() }), facts).link).toBeNull();
    expect(discordLinkView(null, facts).link).toBeNull();
  });

  it('keeps links and unlinks out of the public ledger', () => {
    expect(isPublicLedgerEvent('discord.linked')).toBe(false);
    expect(isPublicLedgerEvent('discord.unlinked')).toBe(false);
  });

  it('takes a client secret in the API keys, and not the bot token in its place', () => {
    expect(checkApiKey('discord', 'aB3_'.repeat(8)).ok).toBe(true);
    expect(checkApiKey('discord', `${'A'.repeat(26)}.${'b'.repeat(6)}.${'c'.repeat(38)}`).ok).toBe(false);
    expect(checkApiKey('discord', 'short').ok).toBe(false);
  });
});

describe('the Member role', () => {
  const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

  it('needs both the server and the role to be set', () => {
    expect(discordRolesSet(DEFAULT_DISCORD_SETTINGS)).toBe(false);
    expect(discordRolesSet({ guildId: '1'.repeat(18), memberRoleId: null })).toBe(false);
    expect(discordRolesSet({ guildId: '1'.repeat(18), memberRoleId: '2'.repeat(18) })).toBe(true);
  });

  it('is given to a linked Active member, and given again a day later', () => {
    expect(discordRoleStep(link(), true, true, NOW)).toBe('give');
    const given = link({ role: 'given', roleAt: NOW.toISOString() });
    expect(discordRoleStep(given, true, true, hours(1))).toBe('nothing');
    expect(discordRoleStep(given, true, true, hours(24))).toBe('give');
  });

  it('is taken away when the membership is not Active, or the link is ended', () => {
    const given = link({ role: 'given', roleAt: NOW.toISOString() });
    expect(discordRoleStep(given, false, true, NOW)).toBe('take');
    expect(discordRoleStep(link(), false, true, NOW)).toBe('nothing');
    expect(discordRoleStep({ ...given, unlinkedAt: NOW.toISOString() }, false, true, NOW)).toBe('take');
    // An ended link that never held the role is only a record to delete.
    expect(discordRoleStep(link({ unlinkedAt: NOW.toISOString() }), false, true, NOW)).toBe('forget');
  });

  it('does nothing on Discord while no server and role are set, but still forgets ended links', () => {
    expect(discordRoleStep(link(), true, false, NOW)).toBe('nothing');
    expect(discordRoleStep(link({ role: 'given', unlinkedAt: NOW.toISOString() }), false, false, NOW)).toBe('forget');
  });

  it('looks again in two minutes while a new link waits for the person to join the server, and hourly otherwise', () => {
    const minutes = (iso: string, from: Date) => (Date.parse(iso) - from.getTime()) / 60_000;
    expect(minutes(discordRoleNextCheck(link(), 'not_in_server', NOW), NOW)).toBe(2);
    expect(minutes(discordRoleNextCheck(link(), 'not_in_server', hours(2)), hours(2))).toBe(60);
    expect(minutes(discordRoleNextCheck(link(), null, NOW), NOW)).toBe(60);
    expect(minutes(discordRoleNextCheck(link(), 'not_allowed', NOW), NOW)).toBe(60);
  });
});

describe('the settings for linking and the weekly posts', () => {
  const base = { basedOn: 0, enabled: true, channels: { news: null, votes: null, events: null, legislation: null } };

  it('are optional for a page opened before they existed', () => {
    expect(discordSettingsSchema.safeParse(base).success).toBe(true);
    expect(resolveDiscordSettings({ enabled: true })).toMatchObject({ guildId: null, memberRoleId: null, loops: { digest: false, question: false, members: false } });
  });

  it('take IDs only for the server and the role', () => {
    const good = { ...base, guildId: '2'.repeat(18), memberRoleId: '3'.repeat(19), loops: { digest: true, question: false, members: false } };
    expect(discordSettingsSchema.safeParse(good).success).toBe(true);
    expect(discordSettingsSchema.safeParse({ ...good, guildId: 'Transhumanist Party' }).success).toBe(false);
    expect(discordSettingsSchema.safeParse({ ...good, memberRoleId: '@Member' }).success).toBe(false);
  });

  it('list each change for the ledger', () => {
    const after = { ...DEFAULT_DISCORD_SETTINGS, guildId: '2'.repeat(18), loops: { ...DEFAULT_DISCORD_SETTINGS.loops, members: true } };
    expect(discordSettingsChanges(DEFAULT_DISCORD_SETTINGS, after)).toEqual([
      { field: 'guildId', from: null, to: '2'.repeat(18) },
      { field: 'loops.members', from: false, to: true },
    ]);
  });
});

describe('the weekly posts', () => {
  it('name a week by its Monday', () => {
    expect(discordWeekOf(new Date('2026-11-16T00:00:00.000Z'))).toBe('2026-11-16');
    expect(discordWeekOf(new Date('2026-11-22T23:59:59.000Z'))).toBe('2026-11-16');
    expect(discordWeekOf(new Date('2026-11-23T00:00:00.000Z'))).toBe('2026-11-23');
  });

  it('are due on their own day from 16:00 UTC, and not made late', () => {
    expect(discordLoopDue('digest', new Date('2026-11-16T15:59:00.000Z'))).toBeNull();
    expect(discordLoopDue('digest', new Date('2026-11-16T16:00:00.000Z'))).toBe('2026-11-16');
    expect(discordLoopDue('digest', new Date('2026-11-17T16:00:00.000Z'))).toBeNull();
    expect(discordLoopDue('question', new Date('2026-11-18T20:00:00.000Z'))).toBe('2026-11-16');
    expect(discordLoopDue('members', new Date('2026-11-20T16:00:00.000Z'))).toBe('2026-11-16');
    expect(discordLoopDue('members', new Date('2026-11-21T16:00:00.000Z'))).toBeNull();
  });

  it('say the week on the site as links, with titles kept plain', () => {
    const text = discordDigestText(
      { elections: [{ title: 'Officers 2027', closesAt: '2026-11-20T00:00:00.000Z' }], news: [{ title: 'A [new] day @everyone', slug: 'new-day' }], courses: [{ title: 'Why the party', courseId: 'intro' }] },
      ORIGIN,
    );
    expect(text).toContain('**A vote is open**');
    expect(text).toContain('Officers 2027: closes <t:');
    expect(text).toContain(`[A \\[new\\] day \\@everyone](${ORIGIN}/news/new-day?utm_source=discord)`);
    expect(text).toContain(`[Why the party](${ORIGIN}/course/intro?utm_source=discord)`);
  });

  it('take a question with two to ten different answers within Discord’s limits', () => {
    const good = { question: 'Which first?', answers: ['Longevity', 'AI policy'] };
    expect(discordQuestionSchema.safeParse(good).success).toBe(true);
    expect(discordQuestionSchema.safeParse({ ...good, answers: ['Only one'] }).success).toBe(false);
    expect(discordQuestionSchema.safeParse({ ...good, answers: ['Same', ' same '] }).success).toBe(false);
    expect(discordQuestionSchema.safeParse({ ...good, answers: ['ok', 'x'.repeat(56)] }).success).toBe(false);
    expect(discordQuestionSchema.safeParse({ ...good, question: 'x'.repeat(301) }).success).toBe(false);
    expect(discordQuestionSchema.safeParse({ ...good, answers: Array.from({ length: 11 }, (_, i) => `Answer ${i}`) }).success).toBe(false);
  });

  it('make the question a one-choice Discord poll open for a week, mentioning nobody', () => {
    expect(discordPollMessage({ question: 'Which first?', answers: ['Longevity', 'AI policy'] })).toEqual({
      poll: { question: { text: 'Which first?' }, answers: [{ poll_media: { text: 'Longevity' } }, { poll_media: { text: 'AI policy' } }], duration: 168, allow_multiselect: false },
      allowed_mentions: { parse: [] },
    });
  });

  it('say what members did in totals, naming only those who chose it', () => {
    const quiet = { week: '2026-11-16', joined: 0, coursesFinished: 0, welcome: [], finishers: [] };
    expect(discordMembersWeekHasNews(quiet)).toBe(false);
    const week = { week: '2026-11-16', joined: 3, coursesFinished: 1, welcome: ['300000000000000001'], finishers: [{ discordUserId: '300000000000000002', course: 'Why *the* party' }] };
    expect(discordMembersWeekHasNews(week)).toBe(true);
    const text = discordMembersWeekText(week);
    expect(text).toContain('**3 new members** joined the party. Welcome, <@300000000000000001>!');
    expect(text).toContain('**1 course** finished.');
    expect(text).toContain('• Why \\*the\\* party: <@300000000000000002>');
    expect(text).toContain('only if they chose to be');
    // Nobody chose to be named: totals alone.
    expect(discordMembersWeekText({ ...week, welcome: [], finishers: [] })).not.toContain('<@');
  });

  it('counts the names past twenty rather than listing them', () => {
    const many = Array.from({ length: 23 }, (_, i) => `3000000000000000${String(i).padStart(2, '0')}`);
    expect(discordMembersWeekText({ week: '2026-11-16', joined: 23, coursesFinished: 0, welcome: many, finishers: [] })).toContain('and 3 more!');
  });

  it('has a Start here message with the three ways in', () => {
    const message = discordStartHereMessage(ORIGIN) as { embeds: { title: string; description: string }[]; allowed_mentions: unknown };
    expect(message.embeds[0]!.title).toBe('Start here');
    for (const path of ['/register', '/account', '/ballot']) expect(message.embeds[0]!.description).toContain(`${ORIGIN}${path}?utm_source=discord`);
    expect(message.allowed_mentions).toEqual({ parse: [] });
  });
});
