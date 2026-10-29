import sharp from 'sharp';
import { DEFAULT_HUB, publicHub, type Hub, type HubSection } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordLiveService, HubService } from './administration/hub.js';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;
let sa2: Member;

beforeEach(async () => {
  await resetEmulators();
  api.app.get(HubService).invalidate();
  api.app.get(DiscordLiveService).invalidate();
  vi.restoreAllMocks();
  [sa1, sa2] = await api.systemAdmins();
});

const INVITE = 'https://discord.gg/ustp-test';
const GUILD = '123456789012345678';

const put = (by: User | undefined, change: Partial<Hub>, basedOn = 0) =>
  api.call('PUT', '/v1/admin/hub', by, { basedOn, ...DEFAULT_HUB, ...change });
const ledger = async () => (await api.firebase.db.collection('audit_events').orderBy('seq').get()).docs.map((d) => d.data());
const click = (target: string) => api.call('POST', `/v1/hub/clicks/${target}`);
const counts = async () => {
  const res = await api.call('GET', '/v1/admin/hub/clicks', sa1);
  return Object.fromEntries((res.body as { target: string; total: number; recent: number }[]).map((c) => [c.target, [c.total, c.recent]]));
};
const png = (side: number) =>
  sharp({ create: { width: side, height: side, channels: 4, background: { r: 189, g: 78, b: 0, alpha: 1 } } }).png().toBuffer();
/** A photo-like JPEG: a gradient, with camera metadata a re-encode must drop. */
const jpeg = (width: number, height: number, exif = false) => {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      pixels[i] = (x * 255) / width;
      pixels[i + 1] = (y * 255) / height;
      pixels[i + 2] = 120;
    }
  }
  const image = sharp(pixels, { raw: { width, height, channels: 3 } });
  return (exif ? image.withExif({ IFD0: { Make: 'CameraCo', Copyright: 'secret' }, IFD3: { GPSLatitudeRef: 'N' } }) : image).jpeg().toBuffer();
};
const fetchImage = (path: string) => api.app.inject({ method: 'GET', url: path });

const community = (url: string): HubSection => ({
  id: 'community',
  title: 'Community',
  shown: true,
  links: [{ id: 'subreddit', title: 'Subreddit', subtitle: 'Long-form discussion', url, icon: 'reddit', shown: true, iconRow: true, featured: false }],
});

describe('the home page hub (design §10.6)', () => {
  it('starts as the default, readable by anyone, showing only what is finished', async () => {
    const res = await api.call('GET', '/v1/hub');
    expect(res).toMatchObject({ status: 200, body: publicHub(DEFAULT_HUB, 0) });
    expect(res.body).not.toHaveProperty('updatedBy');
    expect(res.body.discord).toBeNull();
    expect((await api.call('GET', '/v1/admin/hub', sa1)).body).toEqual({ ...DEFAULT_HUB, version: 0, updatedAt: null, updatedBy: null });
  });

  it('is changed by System Admins only', async () => {
    const pat = await api.member('pat@example.test');
    await api.grant(pat.accountId, 'membership_admin', sa1);
    expect((await put(pat, {})).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/hub', pat)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/hub/clicks', pat)).status).toBe(403);
    expect((await api.upload('/v1/admin/hub/logo', pat, await png(128), 'image/png')).status).toBe(403);
    expect((await api.upload('/v1/admin/hub/cover', pat, await jpeg(1500, 500), 'image/jpeg')).status).toBe(403);
    const anonymous = await api.app.inject({
      method: 'PUT',
      url: '/v1/admin/hub/background',
      headers: { 'content-type': 'image/jpeg' },
      payload: await jpeg(1920, 1080),
    });
    expect(anonymous.statusCode).toBe(401);
    expect((await put(undefined, {})).status).toBe(401);
  });

  it('saves the hub tidied, ledgering each change with the admin as actor', async () => {
    const profile = { ...DEFAULT_HUB.profile, tagline: '  Science,\n health & technology ' };
    const discord = { invite: INVITE, guildId: GUILD, widget: true };
    const res = await put(sa1, { profile, discord, sections: [community('https://www.reddit.com/r/ustp_test'), ...DEFAULT_HUB.sections.slice(2)] });
    expect(res).toMatchObject({ status: 200, body: { version: 1, updatedBy: sa1.accountId, profile: { tagline: 'Science, health & technology' } } });

    const shown = (await api.call('GET', '/v1/hub')).body;
    expect(shown.discord).toEqual({ invite: INVITE, live: true });
    expect(shown.sections.map((s: { id: string }) => s.id)).toEqual(['community', 'follow']);
    expect(shown.icons.map((i: { id: string }) => i.id)).toEqual(['x', 'subreddit', 'facebook', 'linkedin']);

    expect((await ledger()).at(-1)).toMatchObject({
      type: 'hub.changed',
      actor: sa1.accountId,
      subject: null,
      payload: {
        version: 1,
        changes: [
          { part: 'profile', field: 'tagline', to: 'Science, health & technology' },
          { part: 'discord', field: 'invite', to: INVITE },
          { part: 'discord', field: 'guildId', to: GUILD },
          { part: 'discord', field: 'widget', to: true },
          { part: 'section', id: 'apps', title: 'Apps', change: 'removed' },
          { part: 'link', id: 'vote', section: 'apps', change: 'removed' },
          { part: 'link', id: 'register', section: 'apps', change: 'removed' },
          { part: 'link', id: 'website', section: 'apps', change: 'removed' },
          { part: 'link', id: 'events', section: 'apps', change: 'removed' },
          { part: 'link', id: 'donate', section: 'apps', change: 'removed' },
          { part: 'link', id: 'forum', section: 'apps', change: 'removed' },
          { part: 'link', id: 'chat', section: 'apps', change: 'removed' },
          { part: 'link', id: 'discord-server', section: 'community', change: 'removed' },
          { part: 'link', id: 'telegram-channel', section: 'community', change: 'removed' },
          { part: 'link', id: 'subreddit', section: 'community', change: 'edited', fields: ['url'] },
          { part: 'link', id: 'subreddit', section: 'community', change: 'shown' },
        ],
      },
    });
  });

  it('records nothing when nothing changed', async () => {
    const before = (await ledger()).length;
    const res = await put(sa1, { profile: { ...DEFAULT_HUB.profile, name: ' U.S.  Transhumanist Party ' } });
    expect(res.body.version).toBe(0);
    expect(await ledger()).toHaveLength(before);
  });

  it("refuses an edit made from an older copy, so one admin does not undo another's", async () => {
    expect((await put(sa1, { profile: { ...DEFAULT_HUB.profile, bio: 'Hello' } })).body.version).toBe(1);
    const stale = await put(sa2, { discord: { invite: INVITE, guildId: '', widget: false } }, 0);
    expect(stale).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/someone else changed/) } });
    expect((await api.call('GET', '/v1/hub')).body.profile.bio).toBe('Hello');
  });

  it('refuses what cannot be shown: unfinished links, unsafe addresses and an unreadable accent', async () => {
    const draft = await put(sa1, { sections: [community('')] });
    expect(draft).toMatchObject({ status: 400, body: { detail: 'Subreddit needs an address before it can be shown' } });
    const script = await put(sa1, { sections: [community('javascript:alert(1)')] });
    expect(script).toMatchObject({ status: 400, body: { detail: 'Subreddit: use an https:// address' } });
    const accent = await put(sa1, { profile: { ...DEFAULT_HUB.profile, accent: '#ff6900' } });
    expect(accent).toMatchObject({ status: 400, body: { detail: expect.stringMatching(/^white text on the accent needs 4.5:1/) } });
    const discord = await put(sa1, { discord: { invite: 'https://evil.example/x', guildId: '', widget: false } });
    expect(discord.status).toBe(400);
    const widget = await put(sa1, { discord: { invite: INVITE, guildId: '', widget: true } });
    expect(widget).toMatchObject({ status: 400, body: { detail: "the live widget needs the Discord server's ID" } });
    expect((await api.call('PUT', '/v1/admin/hub', sa1, { ...DEFAULT_HUB })).status).toBe(400);
    expect((await api.call('GET', '/v1/hub')).body.version).toBe(0);
  });

  it('takes a logo upload, shows it only once saved, and serves it to anyone for good', async () => {
    const res = await api.upload('/v1/admin/hub/logo', sa1, await png(512), 'image/png');
    expect(res.status).toBe(200);
    const { logo } = res.body as { logo: string };
    expect(logo).toMatch(/^[0-9a-f]{64}$/);
    expect((await api.call('GET', '/v1/hub')).body.profile.logo).toBeNull();

    const image = await api.app.inject({ method: 'GET', url: `/v1/hub/logo/${logo}` });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/webp');
    expect(image.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(await sharp(image.rawPayload).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });

    const saved = await put(sa1, { profile: { ...DEFAULT_HUB.profile, logo } });
    expect(saved.body.profile.logo).toBe(logo);
    expect((await api.call('GET', '/v1/hub')).body.profile.logo).toBe(logo);
    expect((await ledger()).at(-1)!.payload).toEqual({ version: 1, changes: [{ part: 'profile', field: 'logo', to: logo }] });
  });

  it('refuses a logo that was never uploaded, a tiny one, and a file that is not an image', async () => {
    const unknown = await put(sa1, { profile: { ...DEFAULT_HUB.profile, logo: 'a'.repeat(64) } });
    expect(unknown).toMatchObject({ status: 400, body: { detail: expect.stringMatching(/not one uploaded here/) } });
    expect((await api.upload('/v1/admin/hub/logo', sa1, await png(32), 'image/png')).status).toBe(400);
    expect((await api.upload('/v1/admin/hub/logo', sa1, Buffer.from('not an image'), 'image/png')).status).toBe(400);
    expect((await api.app.inject({ method: 'GET', url: `/v1/hub/logo/${'b'.repeat(64)}` })).statusCode).toBe(404);
    expect((await api.app.inject({ method: 'GET', url: '/v1/hub/logo/..%2F..%2Fsecret' })).statusCode).toBe(404);
  });

  it('takes a 3:1 cover banner, keeps it as a 1120×374 WebP without its metadata, and shows it once saved', async () => {
    const res = await api.upload('/v1/admin/hub/cover', sa1, await jpeg(1500, 500, true), 'image/jpeg');
    expect(res.status).toBe(200);
    const { cover } = res.body as { cover: string };
    expect(cover).toMatch(/^[0-9a-f]{64}$/);
    expect((await api.call('GET', '/v1/hub')).body.profile.cover).toBeNull();

    const image = await fetchImage(`/v1/hub/cover/${cover}`);
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/webp');
    expect(image.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const meta = await sharp(image.rawPayload).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 1120, height: 374 });
    expect(meta.exif).toBeUndefined();
    expect(image.rawPayload.includes('CameraCo')).toBe(false);
    expect((await fetchImage(`/v1/hub/logo/${cover}`)).statusCode).toBe(404); // each kind is kept apart

    const saved = await put(sa1, { profile: { ...DEFAULT_HUB.profile, cover } });
    expect(saved.body.profile.cover).toBe(cover);
    expect((await api.call('GET', '/v1/hub')).body.profile.cover).toBe(cover);
    expect((await ledger()).at(-1)!.payload).toEqual({ version: 1, changes: [{ part: 'profile', field: 'cover', to: cover }] });

    const removed = await put(sa1, { profile: DEFAULT_HUB.profile }, 1);
    expect(removed.body.profile.cover).toBeNull();
    expect((await ledger()).at(-1)!.payload).toEqual({ version: 2, changes: [{ part: 'profile', field: 'cover', to: null }] });
    expect((await fetchImage(`/v1/hub/cover/${cover}`)).statusCode).toBe(200); // an old copy of the page can still load it
  });

  it('crops a cover a little off 3:1 from the middle, and refuses other shapes and small ones', async () => {
    const near = await api.upload('/v1/admin/hub/cover', sa1, await jpeg(1500, 520), 'image/jpeg');
    expect(near.status).toBe(200);
    const image = await fetchImage(`/v1/hub/cover/${(near.body as { cover: string }).cover}`);
    expect(await sharp(image.rawPayload).metadata()).toMatchObject({ width: 1120, height: 374 });

    const wide = await api.upload('/v1/admin/hub/cover', sa1, await jpeg(1920, 1080), 'image/jpeg');
    expect(wide).toMatchObject({
      status: 400,
      body: { detail: 'the cover banner must be 3:1 and at least 1120×374 pixels, such as 1500×500; this one is 1920×1080' },
    });
    expect((await api.upload('/v1/admin/hub/cover', sa1, await jpeg(900, 300), 'image/jpeg')).status).toBe(400);
    expect((await api.upload('/v1/admin/hub/cover', sa1, Buffer.from('not an image'), 'image/jpeg')).status).toBe(400);
  });

  it('takes a background photo of at least 1920×1080, kept at most 2560 wide, and shows it once saved', async () => {
    const res = await api.upload('/v1/admin/hub/background', sa1, await jpeg(1920, 1080, true), 'image/jpeg');
    expect(res.status).toBe(200);
    const { background } = res.body as { background: string };
    const image = await fetchImage(`/v1/hub/background/${background}`);
    expect(image.headers['content-type']).toBe('image/webp');
    const meta = await sharp(image.rawPayload).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 1920, height: 1080 }); // never enlarged
    expect(meta.exif).toBeUndefined();
    expect((await api.call('GET', '/v1/hub')).body.profile.background).toBeNull();

    const big = await api.upload('/v1/admin/hub/background', sa1, await jpeg(3200, 1800), 'image/jpeg');
    expect(big.status).toBe(200);
    const shrunk = await fetchImage(`/v1/hub/background/${(big.body as { background: string }).background}`);
    expect(await sharp(shrunk.rawPayload).metadata()).toMatchObject({ width: 2560, height: 1440 });

    const saved = await put(sa1, { profile: { ...DEFAULT_HUB.profile, background } });
    expect(saved.status).toBe(200);
    expect((await api.call('GET', '/v1/hub')).body.profile.background).toBe(background);
    expect((await ledger()).at(-1)!.payload).toEqual({ version: 1, changes: [{ part: 'profile', field: 'background', to: background }] });

    const small = await api.upload('/v1/admin/hub/background', sa1, await jpeg(1280, 720), 'image/jpeg');
    expect(small).toMatchObject({ status: 400, body: { detail: expect.stringMatching(/at least 1920×1080 pixels.*this one is 1280×720$/) } });
  });

  it('refuses a cover or background that was never uploaded, or was uploaded as another kind', async () => {
    const { logo } = (await api.upload('/v1/admin/hub/logo', sa1, await png(512), 'image/png')).body as { logo: string };
    const asCover = await put(sa1, { profile: { ...DEFAULT_HUB.profile, cover: logo } });
    expect(asCover).toMatchObject({ status: 400, body: { detail: 'that cover banner is not one uploaded here; upload it again' } });
    const unknown = await put(sa1, { profile: { ...DEFAULT_HUB.profile, background: 'c'.repeat(64) } });
    expect(unknown).toMatchObject({ status: 400, body: { detail: 'that background photo is not one uploaded here; upload it again' } });
    const path = await put(sa1, { profile: { ...DEFAULT_HUB.profile, background: '../hub_logos/x' } });
    expect(path).toMatchObject({ status: 400, body: { detail: 'that background photo is not one uploaded here' } });
    expect((await fetchImage(`/v1/hub/background/${'d'.repeat(64)}`)).statusCode).toBe(404);
    expect((await api.call('GET', '/v1/hub')).body.version).toBe(0);
  });
});

describe('click counts', () => {
  it('count clicks on what the hub shows, cards and icons alike, with no sign-in and nothing about who clicked', async () => {
    expect((await click('link-vote')).status).toBe(204);
    expect((await click('link-vote')).status).toBe(204);
    expect((await click('link-x')).status).toBe(204);
    expect(await counts()).toEqual({ 'link-vote': [2, 2], 'link-x': [1, 1] });
    const doc = (await api.firebase.db.collection('hub_clicks').doc('link-vote').get()).data();
    expect(Object.keys(doc!).sort()).toEqual(['days', 'total']);
  });

  it('refuse targets the hub does not show, so nobody can make up counters', async () => {
    expect((await click('link-events')).status).toBe(404); // a hidden draft
    expect((await click('link-subreddit')).status).toBe(404); // an icon without an address
    expect((await click('discord')).status).toBe(404); // no invite, so no card
    expect((await click('anything')).status).toBe(404);
    expect(await counts()).toEqual({});
  });

  it('keep a link’s count when it is edited or hidden', async () => {
    await click('link-x');
    const sections = DEFAULT_HUB.sections.map((s) =>
      s.id === 'follow' ? { ...s, links: s.links.map((l) => (l.id === 'x' ? { ...l, title: 'X', shown: false } : l)) } : s,
    );
    expect((await put(sa1, { sections })).status).toBe(200);
    expect((await click('link-x')).status).toBe(404);
    expect(await counts()).toEqual({ 'link-x': [1, 1] });
  });

  it('count the Discord button once the card has an invite', async () => {
    await put(sa1, { discord: { invite: INVITE, guildId: '', widget: false } });
    expect((await click('discord')).status).toBe(204);
    expect(await counts()).toEqual({ discord: [1, 1] });
  });
});

describe('the Discord online count', () => {
  const live = () => api.call('GET', '/v1/hub/discord');

  it('is nothing until the live widget is switched on, and asks Discord nothing till then', async () => {
    const fetchWidget = vi.spyOn(api.app.get(DiscordLiveService), 'fetchWidget');
    expect((await live()).body).toEqual({ online: null });
    await put(sa1, { discord: { invite: INVITE, guildId: GUILD, widget: false } });
    expect((await live()).body).toEqual({ online: null });
    expect(fetchWidget).not.toHaveBeenCalled();
  });

  it("is read from Discord's widget by the API and kept for five minutes", async () => {
    const fetchWidget = vi.spyOn(api.app.get(DiscordLiveService), 'fetchWidget').mockResolvedValue({ presence_count: 42 });
    await put(sa1, { discord: { invite: INVITE, guildId: GUILD, widget: true } });
    expect((await live()).body).toEqual({ online: 42 });
    expect((await live()).body).toEqual({ online: 42 });
    expect(fetchWidget).toHaveBeenCalledTimes(1);
    expect(fetchWidget).toHaveBeenCalledWith(GUILD);
  });

  it('is nothing when Discord fails or has the widget off, without failing the request', async () => {
    const service = api.app.get(DiscordLiveService);
    vi.spyOn(service, 'fetchWidget').mockRejectedValue(new Error('timeout'));
    await put(sa1, { discord: { invite: INVITE, guildId: GUILD, widget: true } });
    expect(await live()).toMatchObject({ status: 200, body: { online: null } });
    service.invalidate();
    vi.spyOn(service, 'fetchWidget').mockResolvedValue(null);
    expect((await live()).body).toEqual({ online: null });
  });
});
