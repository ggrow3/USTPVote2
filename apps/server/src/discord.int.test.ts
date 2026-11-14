import {
  Collections,
  DISCORD_BOT_TOKEN_SECRET,
  discordCommandsFingerprint,
  discordCommandsPayload,
  type DiscordAdminView,
  type DiscordAppState,
  type DiscordAppView,
  type DiscordFeedKind,
  type DiscordPostRecord,
  type DiscordTokenStatus,
  type LedgerEntry,
  type LedgerEvent,
  type NewsPostRecord,
} from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, type ServerConfig } from './config.js';
import { DISCORD_API, STUB_APPLICATION, STUB_UNKNOWN_CHANNEL, type DiscordApi } from './discord/discord-api.js';
import { DiscordCommandSync } from './discord/discord-commands.js';
import { DiscordKeepWarm } from './discord/discord-keep-warm.js';
import { DiscordToken } from './discord/discord-token.js';
import { DiscordFeed } from './discord/discord-feed.js';
import { DiscordSettingsService } from './discord/discord-settings.js';
import { Firebase } from './infra/firebase.js';
import { SECRET_STORE, type SecretStore } from './infra/secret-store.js';
import { LedgerService } from './ledger/ledger.service.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** The Discord bot (design §10.18), with `discord_outbox` standing in for Discord. */

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

// Made up, in the shape of a bot token; never a real one.
const TOKEN = `${'A'.repeat(26)}.${'b'.repeat(6)}.${'c'.repeat(34)}WXYZ`;
const CHANNELS: Record<DiscordFeedKind, string> = {
  news: '100000000000000001',
  votes: '100000000000000002',
  events: '100000000000000003',
  legislation: '100000000000000004',
  courses: '100000000000000005',
  community: '100000000000000006',
};
const NO_CHANNELS = { news: null, votes: null, events: null, legislation: null, courses: null, community: null };

const db = () => api.firebase.db;
const view = async () => (await api.call('GET', '/v1/admin/discord', comms)).body as DiscordAdminView;

async function save(change: { enabled?: boolean; channels?: Partial<Record<DiscordFeedKind, string | null>> }) {
  const { settings } = await view();
  const res = await api.call('PUT', '/v1/admin/discord/settings', comms, {
    basedOn: settings.version,
    enabled: change.enabled ?? settings.enabled,
    channels: { ...settings.channels, ...change.channels },
  });
  expect(res.status).toBe(200);
  worker.app.get(DiscordSettingsService).invalidate();
  return res.body as DiscordAdminView;
}

const addToken = () => api.call('PUT', '/v1/admin/discord-token', sa1, { token: TOKEN });
const post = (at?: string) => worker.app.get(DiscordFeed).postDue(at ? new Date(at) : new Date());
const outbox = async () =>
  (await db().collection(Collections.discordOutbox).orderBy('at').get()).docs.map(
    (d) => d.data() as { channelId: string; message: { embeds: { title: string; description: string; url: string }[]; allowed_mentions: unknown } },
  );
const posts = async () => (await db().collection(Collections.discordPosts).get()).docs.map((d) => d.data() as DiscordPostRecord);
const ledger = async (type: string) =>
  (await db().collection(Collections.auditEvents).where('type', '==', type).orderBy('seq').get()).docs.map((d) => d.data() as LedgerEntry);

async function publishNews(title: string, slug: string) {
  const body = { kind: 'news', title, summary: 'A summary.', body: 'The text.', dateline: '', hashtags: [], slug };
  const draft = (await api.call('POST', '/v1/admin/communications/news', comms, body)).body as NewsPostRecord;
  const res = await api.call('POST', `/v1/admin/communications/news/${draft.postId}/publish`, comms, { basedOn: draft.version });
  expect(res.status).toBeLessThan(300);
}

/** Records a ledger entry as a part of the app would. */
const record = (event: LedgerEvent) => db().runTransaction((tx) => api.app.get(LedgerService).record(tx, [event]));

async function election(electionId: string, title: string, fields: { rehearsal?: boolean; opensAt?: string; closesAt?: string } = {}) {
  const rollSnapshotId = `roll-${electionId}`;
  await db()
    .collection(Collections.eligibilitySnapshots)
    .doc(rollSnapshotId)
    .set({ criteria: fields.rehearsal ? { status: 'active', testVotersOnly: true } : { status: 'active' } });
  await db()
    .collection(Collections.elections)
    .doc(electionId)
    .set({ electionId, title, state: 'open', rollSnapshotId, opensAt: fields.opensAt ?? '2026-11-01T00:00:00.000Z', closesAt: fields.closesAt ?? '2026-12-01T00:00:00.000Z' });
}
const opened = (electionId: string) => record({ type: 'election.opened', actor: 'system', subject: electionId, payload: { electionId } });

beforeEach(async () => {
  await resetEmulators();
  for (const app of [api.app, worker.app]) app.get(DiscordSettingsService).invalidate();
  [sa1] = (await api.systemAdmins()) as [Member, Member];
  comms = await api.member('comms@example.test');
  ada = await api.member('ada@example.test');
  await api.grant(comms.accountId, 'communications_admin', sa1);
});

describe('who sets the Discord bot', () => {
  it('Communications Admins set where it posts; System Admins add its token; nobody else sees either', async () => {
    for (const user of [ada, sa1]) expect((await api.call('GET', '/v1/admin/discord', user)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/discord')).status).toBe(401);
    for (const user of [ada, comms]) expect((await api.call('GET', '/v1/admin/discord-token', user)).status).toBe(403);
    expect((await api.call('PUT', '/v1/admin/discord-token', comms, { token: TOKEN })).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/discord-token', sa1)).status).toBe(200);
  });

  it('is off, with no channels and no token, until they set it', async () => {
    expect(await view()).toMatchObject({ settings: { enabled: false, channels: NO_CHANNELS, version: 0 }, mode: 'stub', tokenSet: false, recent: [], test: null });
    await publishNews('Before anything is set', 'before');
    expect(await post()).toBe(0);
    expect(await outbox()).toEqual([]);
    expect((await db().collection(Collections.discordState).doc('feed').get()).exists).toBe(false);
  });

  it('ledgers each change to the settings, and refuses one made from an older copy', async () => {
    await save({ enabled: true, channels: { news: CHANNELS.news } });
    expect((await ledger('discord.settings_changed')).map((e) => e.payload)).toEqual([
      {
        version: 1,
        changes: [
          { field: 'enabled', from: false, to: true },
          { field: 'channels.news', from: null, to: CHANNELS.news },
        ],
      },
    ]);
    const stale = await api.call('PUT', '/v1/admin/discord/settings', comms, { basedOn: 0, enabled: false, channels: NO_CHANNELS });
    expect(stale.status).toBe(409);
    const bad = await api.call('PUT', '/v1/admin/discord/settings', comms, { basedOn: 1, enabled: true, channels: { ...NO_CHANNELS, news: '#news' } });
    expect(bad.status).toBe(400);
  });
});

describe("the bot's token", () => {
  it('is kept in the secret store alone: no record, answer or ledger entry holds it', async () => {
    const added = await addToken();
    expect(added.status).toBe(200);
    expect(added.body as DiscordTokenStatus).toMatchObject({ set: true, hint: 'WXYZ', addedBy: { accountId: sa1.accountId }, tried: false, unavailable: null });
    expect(await api.app.get<SecretStore>(SECRET_STORE).read(DISCORD_BOT_TOKEN_SECRET)).toBe(TOKEN);
    const kept = JSON.stringify([
      added.body,
      await view(),
      (await db().collection(Collections.discordSettings).get()).docs.map((d) => d.data()),
      await ledger('discord.token_changed'),
    ]);
    expect(kept).not.toContain(TOKEN);
    expect((await ledger('discord.token_changed')).map((e) => e.payload)).toEqual([{ change: 'added' }]);
    expect((await view()).tokenSet).toBe(true);
  });

  it('is refused when it is not shaped like one', async () => {
    expect((await api.call('PUT', '/v1/admin/discord-token', sa1, { token: 'a'.repeat(64) })).status).toBe(400);
    expect(((await api.call('GET', '/v1/admin/discord-token', sa1)).body as DiscordTokenStatus).set).toBe(false);
  });

  it('can be removed, after which nothing is posted', async () => {
    await addToken();
    await save({ enabled: true, channels: CHANNELS });
    const removed = await api.call('DELETE', '/v1/admin/discord-token', sa1);
    expect(removed.body as DiscordTokenStatus).toMatchObject({ set: false, hint: null });
    expect((await api.call('DELETE', '/v1/admin/discord-token', sa1)).status).toBe(404);
    await publishNews('With no token', 'no-token');
    expect(await post()).toBe(0);
    expect(await outbox()).toEqual([]);
  });
});

describe('what the bot posts', () => {
  beforeEach(async () => {
    await addToken();
  });

  it('posts news published after it was switched on, once, to the news channel, and ledgers the post', async () => {
    await publishNews('Published while the bot was off', 'earlier');
    await save({ enabled: true, channels: CHANNELS });
    expect(await post()).toBe(0);

    await publishNews('Convention dates @everyone', 'convention-dates');
    expect(await post()).toBe(1);
    expect(await outbox()).toEqual([
      {
        channelId: CHANNELS.news,
        at: expect.any(String),
        message: {
          embeds: [{ title: 'Convention dates @everyone', description: 'News from the party.', url: 'http://localhost:5173/news/convention-dates?utm_source=discord' }],
          allowed_mentions: { parse: [] },
        },
      },
    ]);
    const [sent] = await posts();
    expect(sent).toMatchObject({ kind: 'news', status: 'sent', channelId: CHANNELS.news, problem: null });
    expect((await ledger('discord.posted')).map((e) => e.payload)).toEqual([
      { ref: sent!.ref, kind: 'news', channelId: CHANNELS.news, messageId: sent!.messageId },
    ]);

    expect(await post()).toBe(0);
    expect(await outbox()).toHaveLength(1);
    expect((await view()).recent.map((p) => p.title)).toEqual(['Convention dates @everyone']);
  });

  it('posts through the worker’s tick', async () => {
    await save({ enabled: true, channels: CHANNELS });
    await publishNews('From the tick', 'from-the-tick');
    const tick = await worker.tick();
    expect(tick.status).toBe(200);
    expect(tick.body.discordPosts).toBe(1);
    expect((await worker.tick()).body.discordPosts).toBe(0);
  });

  it('posts that voting opened with the election’s title, and never for a rehearsal', async () => {
    await save({ enabled: true, channels: CHANNELS });
    await election('real', 'Officer election 2027');
    await election('practice', 'A rehearsal', { rehearsal: true });
    await opened('real');
    await opened('practice');
    expect(await post('2026-11-02T00:00:00.000Z')).toBe(1);
    const [message] = await outbox();
    expect(message!.channelId).toBe(CHANNELS.votes);
    expect(message!.message.embeds[0]!.title).toBe('Voting is open: Officer election 2027');
    expect(message!.message.embeds[0]!.url).toBe('http://localhost:5173/ballot?utm_source=discord');
  });

  it('says once that a vote closes within a day, unless the vote is a rehearsal or too short for that to be news', async () => {
    await save({ enabled: true, channels: CHANNELS });
    await election('long', 'A long vote', { opensAt: '2026-11-01T00:00:00.000Z', closesAt: '2026-11-10T00:00:00.000Z' });
    await election('short', 'A short vote', { opensAt: '2026-11-09T00:00:00.000Z', closesAt: '2026-11-10T00:00:00.000Z' });
    await election('practice', 'A rehearsal', { rehearsal: true, opensAt: '2026-11-01T00:00:00.000Z', closesAt: '2026-11-10T00:00:00.000Z' });
    expect(await post('2026-11-08T12:00:00.000Z')).toBe(0);
    expect(await post('2026-11-09T06:00:00.000Z')).toBe(1);
    expect(await post('2026-11-09T07:00:00.000Z')).toBe(0);
    expect((await outbox()).map((m) => m.message.embeds[0]!.title)).toEqual(['Voting closes soon: A long vote']);
  });

  it('says once that a published event starts within a day', async () => {
    await save({ enabled: true, channels: CHANNELS });
    const event = (eventId: string, status: string) =>
      db().collection(Collections.events).doc(eventId).set({ eventId, slug: eventId, title: `Event ${eventId}`, status, startsAt: '2026-11-10T18:00:00.000Z' });
    await event('town-hall', 'published');
    await event('draft', 'draft');
    expect(await post('2026-11-09T12:00:00.000Z')).toBe(0);
    expect(await post('2026-11-09T19:00:00.000Z')).toBe(1);
    expect(await post('2026-11-09T20:00:00.000Z')).toBe(0);
    const [message] = await outbox();
    expect(message).toMatchObject({ channelId: CHANNELS.events, message: { embeds: [{ title: 'Coming up: Event town-hall' }] } });
  });

  it('posts a course published since the bot was switched on, once', async () => {
    await save({ enabled: true, channels: CHANNELS });
    const now = new Date();
    const later = new Date(now.getTime() + 60_000).toISOString();
    await db().collection(Collections.courses).doc('intro').set({ courseId: 'intro', title: 'Introduction', status: 'published' });
    await db().collection(Collections.courseVersions).doc('intro-1').set({ courseId: 'intro', publishedAt: later });
    await db().collection(Collections.courses).doc('hidden').set({ courseId: 'hidden', title: 'A draft', status: 'draft' });
    await db().collection(Collections.courseVersions).doc('hidden-1').set({ courseId: 'hidden', publishedAt: later });
    expect(await post(new Date(now.getTime() + 120_000).toISOString())).toBe(1);
    expect(await post(new Date(now.getTime() + 180_000).toISOString())).toBe(0);
    expect((await outbox()).map((m) => m.message.embeds[0]!.title)).toEqual(['New course: Introduction']);
  });

  it('posts nothing of a kind that has no channel, and nothing about members or roles', async () => {
    await save({ enabled: true, channels: { votes: CHANNELS.votes } });
    await publishNews('News with no channel', 'no-channel');
    await api.grant(ada.accountId, 'course_admin', sa1);
    expect(await post()).toBe(0);
    expect(await outbox()).toEqual([]);
    expect(await posts()).toEqual([]);
  });

  it('records a post Discord refuses for good, and goes on to the next', async () => {
    await save({ enabled: true, channels: { ...CHANNELS, news: STUB_UNKNOWN_CHANNEL } });
    await publishNews('To a channel that is gone', 'gone');
    await election('real', 'Officer election 2027');
    await opened('real');
    expect(await post('2026-11-02T00:00:00.000Z')).toBe(1);
    const failed = (await posts()).find((p) => p.status === 'failed');
    expect(failed).toMatchObject({ kind: 'news', messageId: null });
    expect(failed!.problem).toContain('no such channel');
    expect(await ledger('discord.posted')).toHaveLength(1);
    expect(await post('2026-11-02T00:01:00.000Z')).toBe(0);
  });

  it('stops posting when it is switched off, and does not catch up when switched on again', async () => {
    await save({ enabled: true, channels: CHANNELS });
    await save({ enabled: false });
    await publishNews('While it was off', 'while-off');
    expect(await post()).toBe(0);
    await save({ enabled: true });
    expect(await post()).toBe(0);
    expect(await outbox()).toEqual([]);
  });
});

describe('a test post', () => {
  it('goes to the kind’s channel within a tick, even while the bot is off', async () => {
    await addToken();
    await save({ channels: { events: CHANNELS.events } });
    const asked = await api.call('POST', '/v1/admin/discord/test', comms, { kind: 'events' });
    expect(asked.status).toBe(200);
    expect((asked.body as DiscordAdminView).test).toMatchObject({ kind: 'events', status: 'waiting' });
    expect((await worker.tick()).body.discordPosts).toBe(1);
    expect((await view()).test).toMatchObject({ status: 'sent', problem: null });
    expect(await outbox()).toMatchObject([{ channelId: CHANNELS.events, message: { embeds: [{ title: 'A test post from the site' }] } }]);
    expect(await ledger('discord.posted')).toEqual([]);
    expect((await worker.tick()).body.discordPosts).toBe(0);
  });

  it('needs a channel and a token first', async () => {
    expect((await api.call('POST', '/v1/admin/discord/test', comms, { kind: 'news' })).status).toBe(409);
    await save({ channels: { news: CHANNELS.news } });
    expect((await api.call('POST', '/v1/admin/discord/test', comms, { kind: 'news' })).status).toBe(409);
    await addToken();
    expect((await api.call('POST', '/v1/admin/discord/test', comms, { kind: 'news' })).status).toBe(200);
  });

  it('says why Discord refused it', async () => {
    await addToken();
    await save({ channels: { news: STUB_UNKNOWN_CHANNEL } });
    await api.call('POST', '/v1/admin/discord/test', comms, { kind: 'news' });
    expect((await worker.tick()).body.discordPosts).toBe(0);
    const { test } = await view();
    expect(test!.status).toBe('failed');
    expect(test!.problem).toContain('no such channel');
  });
});

describe('the slash commands', () => {
  const ENDPOINT = 'https://discord.example.test/interactions';
  /** The worker's step, as a deployment with a commands service runs it (the emulators have none). */
  /**
   * The worker's account as Terraform makes it: it may read a secret's newest version but not list its versions
   * (`secretAccessor`), so asking for the list is refused as Secret Manager refuses it.
   */
  const workerToken = () => {
    const store = worker.app.get<SecretStore>(SECRET_STORE);
    const denied = () => Promise.reject(Object.assign(new Error('PERMISSION_DENIED: secretmanager.versions.list'), { code: 7 }));
    return new DiscordToken({ read: (id: string) => store.read(id), readVersion: (id: string) => store.readVersion(id), latest: denied } as unknown as SecretStore);
  };
  const sync = (discord: Partial<DiscordApi> = {}, at = '2026-11-13T12:00:00.000Z', endpoint: string | null = ENDPOINT) => {
    const stub = worker.app.get<DiscordApi>(DISCORD_API);
    const api_: DiscordApi = {
      whoAmI: (t) => stub.whoAmI(t),
      send: (t, c, m) => stub.send(t, c, m),
      application: (t) => stub.application(t),
      setInteractionsUrl: (t, u) => stub.setInteractionsUrl(t, u),
      setCommands: (t, a, c) => stub.setCommands(t, a, c),
      edit: (t, c, m, b) => stub.edit(t, c, m, b),
      pin: (t, c, m) => stub.pin(t, c, m),
      setRole: (t, g, u, r, h) => stub.setRole(t, g, u, r, h),
      signIn: (a, s, c, r) => stub.signIn(a, s, c, r),
      ...discord,
    };
    const config = { ...worker.app.get<ServerConfig>(CONFIG), discordInteractionsUrl: endpoint };
    return new DiscordCommandSync(worker.app.get(Firebase), workerToken(), api_, config).sync(new Date(at));
  };
  const state = async () => (await db().collection(Collections.discordState).doc('app').get()).data() as DiscordAppState | undefined;
  const publicKey = async () => ((await api.call('GET', '/v1/public/discord/app')).body as DiscordAppView).publicKey;

  it('tells Discord nothing without a token or a commands service', async () => {
    expect(await sync()).toBe(false);
    await addToken();
    expect(await sync({}, undefined, null)).toBe(false);
    expect(await state()).toBeUndefined();
    expect(await publicKey()).toBeNull();
    expect((await worker.tick()).status).toBe(200);
  });

  it('tells Discord once of the address and the commands, and gives the key to anyone', async () => {
    await addToken();
    const told: unknown[] = [];
    const discord: Partial<DiscordApi> = {
      setInteractionsUrl: async (_t, url) => (told.push(url), { ok: true }),
      setCommands: async (_t, applicationId, commands) => (told.push([applicationId, commands]), { ok: true }),
    };
    expect(await sync(discord)).toBe(true);
    expect(told).toEqual([ENDPOINT, [STUB_APPLICATION.applicationId, discordCommandsPayload()]]);
    expect(await state()).toMatchObject({ ...STUB_APPLICATION, endpointSet: true, registered: true, problem: null, fingerprint: discordCommandsFingerprint(ENDPOINT) });
    expect(await publicKey()).toBe(STUB_APPLICATION.publicKey);
    // Even while the bot is switched off: the switch is for what it posts by itself.
    expect((await view()).settings.enabled).toBe(false);

    expect(await sync(discord, '2026-11-14T12:00:00.000Z')).toBe(false);
    expect(told).toHaveLength(2);
    // A new address, or a new token, is told again.
    expect(await sync(discord, '2026-11-14T12:01:00.000Z', 'https://other.example.test/interactions')).toBe(true);
    await addToken();
    expect(await sync(discord, '2026-11-14T12:02:00.000Z', 'https://other.example.test/interactions')).toBe(true);
    expect(told).toHaveLength(6);
  });

  it('keeps the key before Discord calls the address, and tries a refused step again after two minutes', async () => {
    await addToken();
    let keyAtCall: string | null = null;
    const refusing: Partial<DiscordApi> = {
      setInteractionsUrl: async () => {
        keyAtCall = await publicKey();
        return { ok: false, problem: 'Discord called the commands address and did not get the answers it checks for' };
      },
    };
    expect(await sync(refusing)).toBe(true);
    expect(keyAtCall).toBe(STUB_APPLICATION.publicKey);
    expect(await state()).toMatchObject({ endpointSet: false, registered: false, problem: expect.stringContaining('commands address') });
    expect(await sync(refusing, '2026-11-13T12:01:00.000Z')).toBe(false);
    expect(await sync({}, '2026-11-13T12:03:00.000Z')).toBe(true);
    expect(await state()).toMatchObject({ endpointSet: true, registered: true, problem: null });
  });

  it('says so when Discord will not describe the application', async () => {
    await addToken();
    expect(await sync({ application: async () => ({ ok: false, problem: "Discord did not accept the bot's token" }) })).toBe(true);
    expect(await state()).toMatchObject({ applicationId: null, publicKey: null, registered: false, problem: "Discord did not accept the bot's token" });
    expect(await publicKey()).toBeNull();
  });

  describe('kept awake', () => {
    /** The worker's step with a commands service, and what it asked for. */
    const ping = async (answer: () => Promise<Response> = async () => new Response('ok'), config: Partial<ServerConfig> = {}) => {
      const asked: string[] = [];
      const step = new DiscordKeepWarm(worker.app.get(Firebase), { ...worker.app.get<ServerConfig>(CONFIG), discordInteractionsUrl: ENDPOINT, ...config });
      step.fetcher = async (url) => (asked.push(String(url)), answer());
      return { started: await step.ping(), asked };
    };

    it('asks nothing before Discord has the address, or without a commands service', async () => {
      expect(await ping()).toEqual({ started: false, asked: [] });
      await addToken();
      await sync({ setInteractionsUrl: async () => ({ ok: false, problem: 'refused' }) });
      expect((await ping()).asked).toEqual([]);
      await sync({}, '2026-11-13T12:03:00.000Z');
      expect((await ping(undefined, { discordInteractionsUrl: null })).asked).toEqual([]);
      expect((await ping(undefined, { discord: 'off' })).asked).toEqual([]);
    });

    it("asks the commands service for its health once Discord has the address, and a silent service does not fail the tick's step", async () => {
      await addToken();
      await sync();
      expect(await ping()).toEqual({ started: false, asked: ['https://discord.example.test/health'] });
      expect((await ping(async () => new Response('no', { status: 503 }))).started).toBe(false);
      expect(
        (
          await ping(async () => {
            throw new Error('unreachable');
          })
        ).started,
      ).toBe(false);
      // The emulators have no commands service: the tick's own step asks nothing.
      expect((await worker.tick()).status).toBe(200);
    });
  });

  it('shows Communications Admins where commands go and whether Discord was told', async () => {
    // The emulators have no commands service.
    expect((await view()).commands).toEqual({ endpoint: null, registered: false, endpointSet: false, problem: null, triedAt: null });
  });

  it('lists the votes open now for anyone, soonest to close first, without rehearsals or votes past closing', async () => {
    await election('later', 'Closes later', { closesAt: '2099-12-01T00:00:00.000Z' });
    await election('sooner', 'Closes sooner', { closesAt: '2099-06-01T00:00:00.000Z' });
    await election('practice', 'A rehearsal', { rehearsal: true, closesAt: '2099-06-01T00:00:00.000Z' });
    await election('over', 'Past closing', { closesAt: '2020-01-01T00:00:00.000Z' });
    await db().collection(Collections.elections).doc('draft').set({ electionId: 'draft', title: 'A draft', state: 'draft', closesAt: '2099-06-01T00:00:00.000Z' });
    const res = await api.call('GET', '/v1/public/discord/votes');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { electionId: 'sooner', title: 'Closes sooner', closesAt: '2099-06-01T00:00:00.000Z' },
      { electionId: 'later', title: 'Closes later', closesAt: '2099-12-01T00:00:00.000Z' },
    ]);
  });
});
