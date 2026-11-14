import {
  Collections,
  type DiscordAdminView,
  type DiscordLinkRecord,
  type DiscordLinkStart,
  type DiscordLinkView,
  type DiscordPostRecord,
  type DiscordQuestionRecord,
  type LedgerEntry,
} from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountsService } from './accounts/accounts.service.js';
import { STUB_FORBIDDEN_ROLE, STUB_NOT_IN_SERVER, stubSignInCode } from './discord/discord-api.js';
import { DiscordLoops } from './discord/discord-loops.js';
import { DiscordRoles } from './discord/discord-roles.js';
import { DiscordSettingsService } from './discord/discord-settings.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** Linking Discord accounts, the Member role and the weekly posts (design §10.18), with `discord_outbox` standing in for Discord. */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let comms: Member;
let ada: Member;
let bob: Member;

const TOKEN = `${'A'.repeat(26)}.${'b'.repeat(6)}.${'c'.repeat(34)}WXYZ`;
const GUILD = '200000000000000001';
const ROLE = '200000000000000002';
const COMMUNITY = '100000000000000006';
const ADA_DISCORD = '300000000000000001';
const BOB_DISCORD = '300000000000000002';

const db = () => api.firebase.db;
const adminView = async () => (await api.call('GET', '/v1/admin/discord', comms)).body as DiscordAdminView;
const ledger = async (type: string) =>
  (await db().collection(Collections.auditEvents).where('type', '==', type).orderBy('seq').get()).docs.map((d) => d.data() as LedgerEntry);
const linkOf = async (discordUserId: string) => (await db().collection(Collections.discordLinks).doc(discordUserId).get()).data() as DiscordLinkRecord | undefined;
const roleOf = async (discordUserId: string) => (await db().collection(Collections.discordOutbox).doc(`role:${discordUserId}`).get()).data() as { held: boolean; roleId: string; guildId: string } | undefined;
const roles = (at: string) => worker.app.get(DiscordRoles).run(new Date(at));
const loops = (at: string) => worker.app.get(DiscordLoops).run(new Date(at));
const posts = async () => (await db().collection(Collections.discordPosts).get()).docs.map((d) => d.data() as DiscordPostRecord);
const outbox = async () =>
  (await db().collection(Collections.discordOutbox).get()).docs
    .map((d) => ({ id: d.id, ...(d.data() as { channelId?: string; message?: Record<string, any>; pinned?: boolean; at: string }) }))
    .filter((m) => m.message)
    .sort((a, b) => a.at.localeCompare(b.at));

async function setStatus(member: Member, status: string) {
  await db()
    .collection(Collections.members)
    .doc(member.accountId)
    .set({ accountId: member.accountId, status, legalName: member.email, preferredName: null, country: 'US', state: 'NY', statusChangedAt: new Date().toISOString() });
}

async function save(change: Record<string, unknown>) {
  const { settings } = await adminView();
  const res = await api.call('PUT', '/v1/admin/discord/settings', comms, { basedOn: settings.version, enabled: settings.enabled, channels: settings.channels, ...change });
  expect(res.status).toBe(200);
  for (const app of [api.app, worker.app]) app.get(DiscordSettingsService).invalidate();
  return res.body as DiscordAdminView;
}

/** Links as the Account page does: start, then come back from (the stand-in for) Discord as `discordUserId`. */
async function link(member: Member, discordUserId: string, name = 'Someone') {
  const start = await api.call('POST', '/v1/me/discord/start', member);
  expect(start.status).toBe(200);
  return api.call('POST', '/v1/me/discord/link', member, { code: stubSignInCode(discordUserId, name), state: (start.body as DiscordLinkStart).state });
}

beforeEach(async () => {
  await resetEmulators();
  for (const app of [api.app, worker.app]) app.get(DiscordSettingsService).invalidate();
  [sa1] = (await api.systemAdmins()) as [Member, Member];
  comms = await api.member('comms@example.test');
  ada = await api.member('ada@example.test');
  bob = await api.member('bob@example.test');
  await api.grant(comms.accountId, 'communications_admin', sa1);
  await Promise.all([setStatus(ada, 'active'), setStatus(bob, 'active')]);
  await api.call('PUT', '/v1/admin/discord-token', sa1, { token: TOKEN });
});

describe('linking a Discord account', () => {
  it('needs a sign-in, and shows a member nothing linked at first', async () => {
    expect((await api.call('GET', '/v1/me/discord')).status).toBe(401);
    const view = (await api.call('GET', '/v1/me/discord', ada)).body as DiscordLinkView;
    expect(view).toEqual({ blocker: null, rolesSet: false, activeMember: true, link: null });
  });

  it('links the account the member came back from Discord as, keeping the ID and name only, and ledgers it without the ID', async () => {
    const res = await link(ada, ADA_DISCORD, 'Ada on Discord');
    expect(res.status).toBe(200);
    expect((res.body as DiscordLinkView).link).toMatchObject({ discordName: 'Ada on Discord', celebrate: false, role: 'none', roleProblem: null });
    expect(await linkOf(ADA_DISCORD)).toMatchObject({ accountId: ada.accountId, discordUserId: ADA_DISCORD, celebrate: false, unlinkedAt: null });
    const [entry] = await ledger('discord.linked');
    expect(entry).toMatchObject({ actor: ada.accountId, subject: ada.accountId, payload: {} });
    expect(JSON.stringify(entry)).not.toContain(ADA_DISCORD);
    // The word that tied the return to the account is used up.
    expect((await db().collection(Collections.discordLinkStates).get()).size).toBe(0);
    expect((await adminView()).links).toEqual({ linked: 1, withRole: 0, notInServer: 0, refused: 0, celebrating: 0 });
  });

  it("refuses a return that was not started by this account, was used already, or took too long", async () => {
    const start = (await api.call('POST', '/v1/me/discord/start', ada)).body as DiscordLinkStart;
    const code = stubSignInCode(ADA_DISCORD, 'Ada');
    // Bob comes back with Ada's word: refused, and the word is spent.
    expect((await api.call('POST', '/v1/me/discord/link', bob, { code, state: start.state })).status).toBe(409);
    expect((await api.call('POST', '/v1/me/discord/link', ada, { code, state: start.state })).status).toBe(409);
    expect((await api.call('POST', '/v1/me/discord/link', ada, { code, state: 'a-word-nobody-was-given' })).status).toBe(409);

    const late = (await api.call('POST', '/v1/me/discord/start', ada)).body as DiscordLinkStart;
    const states = await db().collection(Collections.discordLinkStates).get();
    await Promise.all(states.docs.map((d) => d.ref.update({ expiresAt: '2020-01-01T00:00:00.000Z' })));
    expect((await api.call('POST', '/v1/me/discord/link', ada, { code, state: late.state })).status).toBe(409);
    expect(await linkOf(ADA_DISCORD)).toBeUndefined();
  });

  it('refuses a code Discord does not accept', async () => {
    const start = (await api.call('POST', '/v1/me/discord/start', ada)).body as DiscordLinkStart;
    expect((await api.call('POST', '/v1/me/discord/link', ada, { code: 'not-from-discord', state: start.state })).status).toBe(422);
  });

  it('keeps one Discord account to one site account, and one site account to one Discord account', async () => {
    expect((await link(ada, ADA_DISCORD)).status).toBe(200);
    expect((await link(bob, ADA_DISCORD)).status).toBe(409);
    expect((await api.call('POST', '/v1/me/discord/start', ada)).status).toBe(409);
    expect((await linkOf(ADA_DISCORD))!.accountId).toBe(ada.accountId);
  });

  it('lets the member choose to be named, and unlink', async () => {
    await link(ada, ADA_DISCORD);
    const chosen = await api.call('PUT', '/v1/me/discord', ada, { celebrate: true });
    expect((chosen.body as DiscordLinkView).link!.celebrate).toBe(true);
    expect((await api.call('PUT', '/v1/me/discord', bob, { celebrate: true })).status).toBe(404);

    const unlinked = await api.call('DELETE', '/v1/me/discord', ada);
    expect((unlinked.body as DiscordLinkView).link).toBeNull();
    // The record keeps the Discord ID, and nothing of the account, until the role is taken away.
    expect(await linkOf(ADA_DISCORD)).toMatchObject({ accountId: null, discordName: null, celebrate: false });
    expect((await ledger('discord.unlinked')).map((e) => e.actor)).toEqual([ada.accountId]);
    expect((await api.call('DELETE', '/v1/me/discord', ada)).status).toBe(404);
    await roles('2026-11-16T12:00:00.000Z');
    expect(await linkOf(ADA_DISCORD)).toBeUndefined();
  });
});

describe('the Member role', () => {
  const T0 = '2099-01-05T12:00:00.000Z';
  const later = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

  it('is given to a linked Active member once the server and the role are set, and taken away when the membership lapses', async () => {
    await link(ada, ADA_DISCORD);
    expect(await roles(T0)).toBe(0);
    expect(await roleOf(ADA_DISCORD)).toBeUndefined();

    // Saving the server and the role looks at every link at once, not within the hour.
    await save({ guildId: GUILD, memberRoleId: ROLE });
    expect(await roles(later(2))).toBe(1);
    expect(await roleOf(ADA_DISCORD)).toEqual(expect.objectContaining({ held: true, roleId: ROLE, guildId: GUILD }));
    expect(((await api.call('GET', '/v1/me/discord', ada)).body as DiscordLinkView).link).toMatchObject({ role: 'given', roleProblem: null });
    expect((await adminView()).links).toMatchObject({ linked: 1, withRole: 1 });
    // Nothing more to do until the next look, an hour on.
    expect(await roles(later(3))).toBe(0);

    await setStatus(ada, 'lapsed');
    expect(await roles(later(30))).toBe(0);
    expect(await roles(later(63))).toBe(1);
    expect((await roleOf(ADA_DISCORD))!.held).toBe(false);
    expect((await linkOf(ADA_DISCORD))!.role).toBe('none');

    await setStatus(ada, 'active');
    expect(await roles(later(124))).toBe(1);
    expect((await roleOf(ADA_DISCORD))!.held).toBe(true);

    // Another role: given at once, in place of the old one (which is not chased).
    const OTHER = '200000000000000003';
    await save({ memberRoleId: OTHER });
    expect(await roles(later(125))).toBe(1);
    expect(await roleOf(ADA_DISCORD)).toEqual(expect.objectContaining({ held: true, roleId: OTHER }));
  });

  it('is not given to a linked account that is not an Active member', async () => {
    await setStatus(bob, 'applicant');
    await save({ guildId: GUILD, memberRoleId: ROLE });
    await link(bob, BOB_DISCORD);
    expect(await roles(later(1))).toBe(0);
    expect(await roleOf(BOB_DISCORD)).toBeUndefined();
  });

  it('is taken away when the member unlinks or the account is deleted, and the record goes', async () => {
    await save({ guildId: GUILD, memberRoleId: ROLE });
    await link(ada, ADA_DISCORD);
    await link(bob, BOB_DISCORD);
    expect(await roles(later(1))).toBe(2);

    await api.call('DELETE', '/v1/me/discord', ada);
    expect(await roles(later(2))).toBe(1);
    expect((await roleOf(ADA_DISCORD))!.held).toBe(false);
    expect(await linkOf(ADA_DISCORD)).toBeUndefined();

    // What deleting an account does with what it leaves behind (the route itself is tried in accounts.int.test.ts).
    await api.app.get(AccountsService).forgetActivity(bob.accountId, []);
    expect(await linkOf(BOB_DISCORD)).toMatchObject({ accountId: null });
    expect(await roles(later(3))).toBe(1);
    expect((await roleOf(BOB_DISCORD))!.held).toBe(false);
    expect(await linkOf(BOB_DISCORD)).toBeUndefined();
  });

  it('waits for a person who has not joined the server, and says so', async () => {
    await save({ guildId: GUILD, memberRoleId: ROLE });
    await link(ada, STUB_NOT_IN_SERVER);
    const linkedAt = Date.parse((await linkOf(STUB_NOT_IN_SERVER))!.linkedAt);
    expect(await roles(new Date(linkedAt + 1000).toISOString())).toBe(0);
    const waiting = (await linkOf(STUB_NOT_IN_SERVER))!;
    expect(waiting).toMatchObject({ role: 'none', roleProblem: 'not_in_server' });
    // Looked at again two minutes later while the link is new.
    expect(Date.parse(waiting.roleCheckAt) - (linkedAt + 1000)).toBe(2 * 60_000);
    expect((await adminView()).links).toMatchObject({ linked: 1, withRole: 0, notInServer: 1 });
  });

  it('says so when the bot may not change the role', async () => {
    await save({ guildId: GUILD, memberRoleId: STUB_FORBIDDEN_ROLE });
    await link(ada, ADA_DISCORD);
    expect(await roles(later(1))).toBe(0);
    expect(await linkOf(ADA_DISCORD)).toMatchObject({ role: 'none', roleProblem: 'not_allowed' });
    expect((await adminView()).links).toMatchObject({ refused: 1 });
  });
});

describe('the weekly posts', () => {
  // 2099-01-05 is a Monday.
  const MONDAY = '2099-01-05T16:30:00.000Z';
  const WEDNESDAY = '2099-01-07T16:30:00.000Z';
  const FRIDAY = '2099-01-09T16:30:00.000Z';
  const ALL = { digest: true, question: true, members: true };

  async function publishNews(title: string, slug: string) {
    const body = { kind: 'news', title, summary: 'A summary.', body: 'The text.', dateline: '', hashtags: [], slug };
    const draft = (await api.call('POST', '/v1/admin/communications/news', comms, body)).body as { postId: string; version: number };
    expect((await api.call('POST', `/v1/admin/communications/news/${draft.postId}/publish`, comms, { basedOn: draft.version })).status).toBeLessThan(300);
  }

  it('are off until switched on, each by itself, and need the community channel', async () => {
    await save({ enabled: true, channels: { ...(await adminView()).settings.channels, community: COMMUNITY } });
    expect(await loops(MONDAY)).toBe(0);
    expect((await ledger('discord.settings_changed')).at(-1)!.payload).toMatchObject({ changes: expect.arrayContaining([{ field: 'channels.community', from: null, to: COMMUNITY }]) });
    await save({ loops: { digest: false, question: true, members: false } });
    expect((await ledger('discord.settings_changed')).at(-1)!.payload).toMatchObject({ changes: [{ field: 'loops.question', from: false, to: true }] });
    expect(await loops(MONDAY)).toBe(0);
  });

  it('post the week on the site on Monday, once, and nothing in a week with nothing new', async () => {
    await save({ enabled: true, channels: { ...(await adminView()).settings.channels, community: COMMUNITY }, loops: ALL });
    expect(await loops(MONDAY)).toBe(0);
    expect(await posts()).toEqual([]);

    // The news post is published "now", so a Monday within a week of now carries it.
    await publishNews('A *bold* move', 'bold-move');
    const now = new Date();
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + ((8 - now.getUTCDay()) % 7 || 7), 16, 30));
    expect(await loops(new Date(monday.getTime() - 3 * 3_600_000).toISOString())).toBe(0);
    expect(await loops(monday.toISOString())).toBe(1);
    expect(await loops(new Date(monday.getTime() + 60_000).toISOString())).toBe(0);
    const [sent] = await outbox();
    expect(sent!.channelId).toBe(COMMUNITY);
    expect(sent!.message!.embeds[0].title).toBe('This week on the site');
    expect(sent!.message!.embeds[0].description).toContain('[A \\*bold\\* move](');
    expect(sent!.message!.allowed_mentions).toEqual({ parse: [] });
    expect((await posts()).map((p) => [p.kind, p.status])).toEqual([['community', 'sent']]);
    expect((await ledger('discord.posted')).at(-1)!.payload).toMatchObject({ kind: 'community', channelId: COMMUNITY });
  });

  it('post the oldest waiting question as a Discord poll on Wednesday', async () => {
    await save({ enabled: true, channels: { ...(await adminView()).settings.channels, community: COMMUNITY }, loops: ALL });
    expect((await api.call('POST', '/v1/admin/discord/questions', ada, { question: 'Q?', answers: ['A', 'B'] })).status).toBe(403);
    expect((await api.call('POST', '/v1/admin/discord/questions', comms, { question: 'One answer?', answers: ['Only'] })).status).toBe(400);
    expect((await api.call('POST', '/v1/admin/discord/questions', comms, { question: 'Twice?', answers: ['Same', 'same'] })).status).toBe(400);
    await api.call('POST', '/v1/admin/discord/questions', comms, { question: 'Which comes first?', answers: ['Longevity', 'AI policy', 'Space'] });
    const queued = (await api.call('POST', '/v1/admin/discord/questions', comms, { question: 'And second?', answers: ['Yes', 'No'] })).body as DiscordAdminView;
    expect(queued.questions.map((q) => [q.question, q.status])).toEqual([
      ['Which comes first?', 'waiting'],
      ['And second?', 'waiting'],
    ]);

    expect(await loops(MONDAY)).toBe(0);
    expect(await loops(WEDNESDAY)).toBe(1);
    expect(await loops(WEDNESDAY)).toBe(0);
    const [sent] = await outbox();
    expect(sent!.message).toEqual({
      poll: { question: { text: 'Which comes first?' }, answers: [{ poll_media: { text: 'Longevity' } }, { poll_media: { text: 'AI policy' } }, { poll_media: { text: 'Space' } }], duration: 168, allow_multiselect: false },
      allowed_mentions: { parse: [] },
    });
    const after = await adminView();
    expect(after.questions.map((q) => [q.question, q.status, q.week])).toEqual([
      ['And second?', 'waiting', null],
      ['Which comes first?', 'posted', '2099-01-05'],
    ]);
    // A posted question stays; a waiting one can be removed.
    const [second, first] = after.questions as [DiscordQuestionRecord, DiscordQuestionRecord];
    expect((await api.call('DELETE', `/v1/admin/discord/questions/${first.questionId}`, comms)).status).toBe(409);
    expect((await api.call('DELETE', `/v1/admin/discord/questions/${second.questionId}`, comms)).status).toBe(200);
  });

  it('say what members did on Friday in totals, naming only those who chose to be named', async () => {
    await save({ enabled: true, channels: { ...(await adminView()).settings.channels, community: COMMUNITY }, loops: ALL });
    expect(await loops(FRIDAY)).toBe(0);

    await link(ada, ADA_DISCORD);
    await link(bob, BOB_DISCORD);
    await api.call('PUT', '/v1/me/discord', ada, { celebrate: true });
    const at = '2099-01-08T10:00:00.000Z';
    const history = db().collection(Collections.memberStatusHistory);
    await Promise.all([
      history.add({ accountId: ada.accountId, from: 'applicant', to: 'active', at }),
      history.add({ accountId: bob.accountId, from: 'applicant', to: 'active', at }),
      history.add({ accountId: 'someone-else', from: 'active', to: 'lapsed', at }),
      db().collection(Collections.courses).doc('intro').set({ courseId: 'intro', title: 'Why the party', status: 'published' }),
      db().collection(Collections.courseCertificates).doc('intro_ada').set({ courseId: 'intro', accountId: ada.accountId, issuedAt: at, revokedAt: null }),
      db().collection(Collections.courseCertificates).doc('intro_bob').set({ courseId: 'intro', accountId: bob.accountId, issuedAt: at, revokedAt: null }),
    ]);
    expect(await loops('2099-01-16T16:30:00.000Z')).toBe(0); // the Friday after: that week is past
    expect(await loops(FRIDAY)).toBe(1);
    const [sent] = await outbox();
    const text = sent!.message!.embeds[0].description as string;
    expect(text).toContain('**2 new members** joined the party. Welcome, <@300000000000000001>!');
    expect(text).toContain('**2 courses** finished.');
    expect(text).toContain('• Why the party: <@300000000000000001>');
    expect(text).not.toContain(BOB_DISCORD);
    expect(sent!.message!.allowed_mentions).toEqual({ parse: [] });
  });

  it('post nothing while the bot is switched off', async () => {
    await save({ channels: { ...(await adminView()).settings.channels, community: COMMUNITY }, loops: ALL });
    await api.call('POST', '/v1/admin/discord/questions', comms, { question: 'Anyone?', answers: ['Yes', 'No'] });
    expect(await loops(WEDNESDAY)).toBe(0);
    expect(await outbox()).toEqual([]);
  });
});

describe('the Start here message', () => {
  it('is posted and pinned when a Communications Admin asks, and changed in place the next time', async () => {
    expect((await api.call('POST', '/v1/admin/discord/start-here', comms)).status).toBe(409);
    await save({ channels: { ...(await adminView()).settings.channels, community: COMMUNITY } });
    expect((await api.call('POST', '/v1/admin/discord/start-here', ada)).status).toBe(403);
    const asked = (await api.call('POST', '/v1/admin/discord/start-here', comms)).body as DiscordAdminView;
    expect(asked.startHere).toMatchObject({ status: 'waiting', channelId: COMMUNITY });

    // Whether or not the bot is switched on.
    expect(await loops('2099-01-06T09:00:00.000Z')).toBe(1);
    const [sent] = await outbox();
    expect(sent!.pinned).toBe(true);
    expect(sent!.message!.embeds[0].title).toBe('Start here');
    expect(sent!.message!.embeds[0].description).toContain('/register?utm_source=discord');
    expect(sent!.message!.embeds[0].description).toContain('/account?utm_source=discord');
    const posted = (await adminView()).startHere!;
    expect(posted).toMatchObject({ status: 'posted', pinned: true, problem: null, messageId: sent!.id });

    await api.call('POST', '/v1/admin/discord/start-here', comms);
    expect(await loops('2099-01-06T09:05:00.000Z')).toBe(0);
    expect(await outbox()).toHaveLength(1);
    expect((await adminView()).startHere).toMatchObject({ status: 'posted', messageId: sent!.id });
  });
});
