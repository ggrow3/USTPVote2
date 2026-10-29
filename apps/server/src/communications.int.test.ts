import sharp from 'sharp';
import type {
  BotRecord,
  CalendarItemRecord,
  JsonFeed,
  LedgerEntry,
  NewsPostRecord,
  SharePostRecord,
  SuggestionRecord,
} from 'ustp-domain';
import { SUGGESTIONS_PER_SENDER_PER_DAY } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;
let comms: Member;
let ma: Member;
let ada: Member;
let cy: Member;

async function memberRecord(user: Member, legalName: string, status = 'active') {
  await api.firebase.db.collection('members').doc(user.accountId).set({ accountId: user.accountId, status, legalName, preferredName: null, state: 'TX' });
}

async function entries(type: string): Promise<LedgerEntry[]> {
  const snap = await api.firebase.db.collection('audit_events').where('type', '==', type).orderBy('seq').get();
  return snap.docs.map((d) => d.data() as LedgerEntry);
}

const NEWS = {
  kind: 'press_release',
  title: 'USTP publishes its 2028 platform',
  summary: 'The party sets out science, health and technology first.',
  body: 'Today the party published its platform.\n\n- Science\n- Health',
  dateline: 'Washington, D.C.',
  hashtags: ['USTP'],
  slug: 'platform-2028',
};

const draft = async (body: Record<string, unknown> = {}) => (await api.call('POST', '/v1/admin/communications/news', comms, { ...NEWS, ...body })).body as NewsPostRecord;
const publish = async (post: NewsPostRecord) =>
  (await api.call('POST', `/v1/admin/communications/news/${post.postId}/publish`, comms, { basedOn: post.version })).body as NewsPostRecord;

/** Sends the suggestions form as a visitor from `address` would. */
const suggest = (body: Record<string, unknown>, address = '203.0.113.7') =>
  api.app.inject({ method: 'POST', url: '/v1/suggestions', headers: { 'x-forwarded-for': address }, payload: body });

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  comms = await api.member('comms@example.test');
  ma = await api.member('membership.admin@example.test');
  ada = await api.member('ada@example.test');
  cy = await api.member('cy@example.test');
  await api.grant(comms.accountId, 'communications_admin', sa1);
  await api.grant(ma.accountId, 'membership_admin', sa1);
  await memberRecord(ada, 'Ada Brooks');
  await memberRecord(cy, 'Cy Park', 'applicant');
});

describe('who may use the communications tools', () => {
  it('only Communications Admins, who may also edit the Link hub', async () => {
    for (const user of [ma, ada, sa1]) {
      expect((await api.call('GET', '/v1/admin/communications/news', user)).status).toBe(403);
    }
    expect((await api.call('GET', '/v1/admin/communications/news')).status).toBe(401);
    expect((await api.call('GET', '/v1/admin/communications/news', comms)).status).toBe(200);
    expect((await api.call('GET', '/v1/admin/hub', comms)).status).toBe(200);
    expect((await api.call('GET', '/v1/admin/hub', ma)).status).toBe(403);
  });

  it('a Communications Admin cannot also be an Auditor', async () => {
    const res = await api.call('POST', '/v1/admin/roles', sa1, { accountId: comms.accountId, role: 'auditor', change: 'grant', reason: 'test' });
    expect(res.status).toBe(409);
  });
});

describe('news and press releases', () => {
  it('a draft is private until published; publishing is ledgered and public at once', async () => {
    const post = await draft();
    expect(post).toMatchObject({ status: 'draft', slug: 'platform-2028', createdBy: comms.accountId });
    expect((await api.call('GET', '/v1/news/platform-2028')).status).toBe(404);
    expect((await api.call('GET', '/v1/news')).body).toEqual([]);

    const published = await publish(post);
    expect(published).toMatchObject({ status: 'published', version: 2, publishedBy: comms.accountId });
    expect((await entries('news.published')).map((e) => [e.actor, e.subject, e.payload.slug])).toEqual([[comms.accountId, post.postId, 'platform-2028']]);

    const page = await api.call('GET', '/v1/news/platform-2028');
    expect(page).toMatchObject({ status: 200, body: { status: 'published', title: NEWS.title, body: NEWS.body, hashtags: ['USTP'] } });
    expect(page.body).not.toHaveProperty('publishedBy');
    expect((await api.call('GET', '/v1/news')).body).toMatchObject([{ slug: 'platform-2028', kind: 'press_release' }]);
  });

  it('refuses another post at the same address, and a stale edit', async () => {
    const post = await draft();
    expect((await api.call('POST', '/v1/admin/communications/news', comms, NEWS)).status).toBe(409);
    const edit = (basedOn: number) => api.call('PUT', `/v1/admin/communications/news/${post.postId}`, comms, { ...NEWS, title: 'Changed', basedOn });
    expect((await edit(1)).body).toMatchObject({ title: 'Changed', version: 2 });
    expect((await edit(1)).status).toBe(409);
    expect(await entries('news.changed')).toEqual([]);
  });

  it('a published post is edited with a ledger entry, and withdrawn rather than deleted', async () => {
    const published = await publish(await draft());
    const edited = await api.call('PUT', `/v1/admin/communications/news/${published.postId}`, comms, { ...NEWS, summary: 'Updated summary.', basedOn: 2 });
    expect(edited.body).toMatchObject({ version: 3, editedAt: expect.any(String) });
    expect((await entries('news.changed')).map((e) => e.payload.fields)).toEqual([['summary']]);
    expect((await api.call('DELETE', `/v1/admin/communications/news/${published.postId}`, comms)).status).toBe(409);

    const withdrawn = await api.call('POST', `/v1/admin/communications/news/${published.postId}/withdraw`, comms, { basedOn: 3 });
    expect(withdrawn.body).toMatchObject({ status: 'withdrawn' });
    expect((await entries('news.withdrawn')).length).toBe(1);
    expect((await api.call('GET', '/v1/news/platform-2028')).body).toMatchObject({ status: 'withdrawn', title: NEWS.title });
    expect((await api.call('GET', '/v1/news/platform-2028')).body).not.toHaveProperty('body');
  });

  it('a draft that was never published is deleted', async () => {
    const post = await draft();
    expect((await api.call('DELETE', `/v1/admin/communications/news/${post.postId}`, comms)).status).toBe(204);
    expect((await api.call('GET', `/v1/admin/communications/news/${post.postId}`, comms)).status).toBe(404);
  });

  it('the feeds carry published posts as RSS and JSON Feed', async () => {
    await publish(await draft({ title: 'Science & health' }));
    await draft({ slug: 'still-a-draft', title: 'Not yet' });
    const rss = await api.app.inject({ method: 'GET', url: '/v1/news/feed.xml', headers: { host: 'vote.example', 'x-forwarded-proto': 'https' } });
    expect(rss.headers['content-type']).toContain('application/rss+xml');
    expect(rss.body).toContain('<title>Science &amp; health</title>');
    expect(rss.body).toContain('/news/platform-2028</link>');
    expect(rss.body).not.toContain('Not yet');
    const json = await api.app.inject({ method: 'GET', url: '/v1/news/feed.json' });
    expect(json.headers['content-type']).toContain('application/feed+json');
    const feed = JSON.parse(json.body) as JsonFeed;
    expect(feed.items.map((i) => i.title)).toEqual(['Science & health']);
  });
});

describe('the share kit', () => {
  const POST = { title: 'Debate night', text: 'Watch the debate tonight', url: '/news/platform-2028', hashtags: ['USTP'] };

  it('offers Active members what was published, and nobody else', async () => {
    const created = (await api.call('POST', '/v1/admin/communications/share', comms, POST)).body as SharePostRecord;
    expect((await api.call('GET', '/v1/share', ada)).body).toEqual([]);
    const published = await api.call('POST', `/v1/admin/communications/share/${created.shareId}/publish`, comms, { basedOn: 1 });
    expect(published.body).toMatchObject({ status: 'published' });
    expect((await entries('share_post.changed')).map((e) => e.payload.change)).toEqual(['published']);

    const kit = await api.call('GET', '/v1/share', ada);
    expect(kit.body).toEqual([expect.objectContaining({ shareId: created.shareId, text: POST.text })]);
    expect(kit.body[0]).not.toHaveProperty('createdBy');
    expect((await api.call('GET', '/v1/share', cy)).status).toBe(403);
    expect((await api.call('GET', '/v1/share')).status).toBe(401);
  });

  it('counts share buttons on what can be shared, and nothing about who', async () => {
    const created = (await api.call('POST', '/v1/admin/communications/share', comms, POST)).body as SharePostRecord;
    const click = (item: string, target = 'x') => api.call('POST', '/v1/share/clicks', undefined, { item, target });
    expect((await click(`kit-${created.shareId}`)).status).toBe(404);
    await api.call('POST', `/v1/admin/communications/share/${created.shareId}/publish`, comms, { basedOn: 1 });
    await publish(await draft());
    expect((await click(`kit-${created.shareId}`)).status).toBe(204);
    expect((await click(`kit-${created.shareId}`, 'bluesky')).status).toBe(204);
    expect((await click('news-platform-2028', 'facebook')).status).toBe(204);
    expect((await click('news-no-such-post')).status).toBe(404);
    expect((await click('link-x')).status).toBe(404);
    const counts = (await api.call('GET', '/v1/admin/communications/share-counts', comms)).body;
    expect(counts).toEqual([
      expect.objectContaining({ item: `kit-${created.shareId}`, total: 2, targets: { x: 1, bluesky: 1 } }),
      expect.objectContaining({ item: 'news-platform-2028', total: 1, targets: { facebook: 1 } }),
    ]);
  });
});

describe('the social media calendar', () => {
  it('plans posts for the party accounts, assigned to the team, and records them as posted', async () => {
    const team = (await api.call('GET', '/v1/admin/communications/team', comms)).body;
    expect(team).toEqual([{ accountId: comms.accountId, name: expect.any(String) }]);
    const plan = { network: 'x', scheduledFor: '2030-01-01T17:00:00Z', text: 'Happy new year', assignee: comms.accountId };
    expect((await api.call('POST', '/v1/admin/communications/calendar', comms, { ...plan, assignee: ada.accountId })).status).toBe(400);
    const item = (await api.call('POST', '/v1/admin/communications/calendar', comms, plan)).body as CalendarItemRecord;
    expect(item).toMatchObject({ status: 'planned', scheduledFor: '2030-01-01T17:00:00.000Z' });
    const posted = await api.call('POST', `/v1/admin/communications/calendar/${item.itemId}/status`, comms, {
      basedOn: 1,
      status: 'posted',
      postedUrl: 'https://x.com/USTranshumanist/status/1',
    });
    expect(posted.body).toMatchObject({ status: 'posted', postedBy: comms.accountId });
    expect((await api.call('GET', '/v1/admin/communications/calendar', comms)).body).toHaveLength(1);
    expect((await api.firebase.db.collection('audit_events').get()).docs.map((d) => d.get('type'))).not.toContain('calendar.changed');
  });
});

describe('suggestions from the public', () => {
  const SUGGESTION = { topic: 'policy', message: 'Please write a policy on longevity research.' };

  it('anyone may send one, read only by Communications Admins, with no ledger entry', async () => {
    const res = await suggest({ ...SUGGESTION, name: 'Ada', email: 'ada@example.org', consent: true });
    expect(res.statusCode).toBe(202);
    expect((await suggest({ ...SUGGESTION, email: 'ada@example.org' })).statusCode).toBe(400);
    const list = (await api.call('GET', '/v1/admin/communications/suggestions', comms)).body as SuggestionRecord[];
    expect(list).toEqual([expect.objectContaining({ topic: 'policy', name: 'Ada', email: 'ada@example.org', status: 'new' })]);
    expect((await api.call('GET', '/v1/admin/communications/suggestions', ma)).status).toBe(403);
    const types = (await api.firebase.db.collection('audit_events').get()).docs.map((d) => d.get('type'));
    expect(types.some((t: string) => t.startsWith('suggestion'))).toBe(false);

    const handled = await api.call('PUT', `/v1/admin/communications/suggestions/${list[0]!.suggestionId}`, comms, { status: 'answered', note: 'Replied by email' });
    expect(handled.body).toMatchObject({ status: 'answered', handledBy: comms.accountId });
    expect((await api.call('DELETE', `/v1/admin/communications/suggestions/${list[0]!.suggestionId}`, comms)).status).toBe(204);
    expect((await api.call('GET', '/v1/admin/communications/suggestions', comms)).body).toEqual([]);
  });

  it('drops what a form filler sends, and limits each sender per day without keeping their address', async () => {
    expect((await suggest({ ...SUGGESTION, website: 'https://spam.example' })).statusCode).toBe(202);
    expect((await api.call('GET', '/v1/admin/communications/suggestions', comms)).body).toEqual([]);
    for (let i = 0; i < SUGGESTIONS_PER_SENDER_PER_DAY; i++) expect((await suggest(SUGGESTION)).statusCode).toBe(202);
    expect((await suggest(SUGGESTION)).statusCode).toBe(429);
    expect((await suggest(SUGGESTION, '198.51.100.2')).statusCode).toBe(202);
    const limits = (await api.firebase.db.collection('suggestion_limits').get()).docs.map((d) => d.data());
    expect(limits).toHaveLength(1);
    expect(JSON.stringify(limits)).not.toContain('203.0.113.7');
    expect(limits[0]).toMatchObject({ total: SUGGESTIONS_PER_SENDER_PER_DAY + 1 });
  });

  it('the worker deletes suggestions a year old and the limits of days gone', async () => {
    const old = { suggestionId: 'old', topic: 'other', message: 'x'.repeat(20), name: null, email: null, receivedAt: '2020-01-01T00:00:00.000Z', status: 'new', flagged: false, note: '', handledAt: null, handledBy: null };
    await api.firebase.db.collection('suggestions').doc('old').set(old);
    await api.firebase.db.collection('suggestion_limits').doc('2020-01-01').set({ day: '2020-01-01', salt: 'aa', total: 1, senders: {} });
    expect((await suggest(SUGGESTION)).statusCode).toBe(202);
    const { SuggestionsService } = await import('./communications/suggestions.service.js');
    expect(await api.app.get(SuggestionsService).deleteExpired()).toBe(1);
    expect((await api.call('GET', '/v1/admin/communications/suggestions', comms)).body).toHaveLength(1);
    expect((await api.firebase.db.collection('suggestion_limits').get()).docs.map((d) => d.id)).not.toContain('2020-01-01');
  });
});

describe('the press kit', () => {
  const png = () => sharp({ create: { width: 600, height: 300, channels: 4, background: { r: 189, g: 78, b: 0, alpha: 0.5 } } }).png().toBuffer();
  const KIT = { about: 'The USTP puts science first.', contact: { name: 'Press Office', email: 'press@example.org' }, facts: [{ label: 'Founded', value: '2014' }] };

  it('takes images (re-encoded) and PDFs, offers them once the kit lists them, and ledgers each save', async () => {
    const image = await api.upload('/v1/admin/communications/press-kit/assets?name=USTP%20logo.png', comms, await png(), 'image/png');
    expect(image).toMatchObject({ status: 200, body: { contentType: 'image/png', width: 600, height: 300, fileName: 'USTP-logo.png' } });
    const pdf = await api.upload('/v1/admin/communications/press-kit/assets?name=facts.pdf', comms, Buffer.from('%PDF-1.4\n%fake\n'), 'application/pdf');
    expect(pdf.body).toMatchObject({ contentType: 'application/pdf', fileName: 'facts.pdf' });
    expect((await api.upload('/v1/admin/communications/press-kit/assets', comms, Buffer.from('not a pdf'), 'application/pdf')).status).toBe(400);
    expect((await api.call('GET', `/v1/press/assets/${image.body.id}`)).status).toBe(404);

    const assets = [
      { id: image.body.id, title: 'Logo' },
      { id: pdf.body.id, title: 'Fact sheet' },
    ];
    const saved = await api.call('PUT', '/v1/admin/communications/press-kit', comms, { ...KIT, assets, basedOn: 0 });
    expect(saved.body).toMatchObject({ version: 1, contact: { name: 'Press Office', role: '' } });
    expect((await entries('press_kit.changed')).map((e) => e.payload.assetsAdded)).toEqual([[image.body.id, pdf.body.id]]);
    expect((await api.call('PUT', '/v1/admin/communications/press-kit', comms, { ...KIT, assets, basedOn: 0 })).status).toBe(409);
    expect((await api.call('PUT', '/v1/admin/communications/press-kit', comms, { ...KIT, assets: [{ id: 'b'.repeat(64), title: 'X' }], basedOn: 1 })).status).toBe(400);

    const page = await api.call('GET', '/v1/press');
    expect(page.body.kit.assets).toMatchObject([{ title: 'Logo', contentType: 'image/png' }, { title: 'Fact sheet', contentType: 'application/pdf' }]);
    const file = await api.app.inject({ method: 'GET', url: `/v1/press/assets/${pdf.body.id}` });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-disposition']).toBe('attachment; filename="facts.pdf"');
    expect(file.headers['content-security-policy']).toContain('sandbox');
  });
});

describe('the bot registry', () => {
  const BOT = { name: 'News bot', site: 'bluesky', handle: '@news', url: 'https://bsky.app/profile/news', purpose: 'Posts each release.', status: 'active', public: true, notes: 'Token with the director' };

  it('is ledgered, and lists public bots on the Press page without the team’s notes', async () => {
    const bot = (await api.call('POST', '/v1/admin/communications/bots', comms, BOT)).body as BotRecord;
    await api.call('POST', '/v1/admin/communications/bots', comms, { ...BOT, name: 'Private bot', public: false });
    const checked = await api.call('POST', `/v1/admin/communications/bots/${bot.botId}/checked`, comms, { basedOn: 1 });
    expect(checked.body).toMatchObject({ checkedBy: comms.accountId, version: 2 });
    expect((await entries('bot.changed')).map((e) => e.payload.change)).toEqual(['added', 'added', 'checked']);
    const page = await api.call('GET', '/v1/press');
    expect(page.body.bots).toEqual([{ botId: bot.botId, name: 'News bot', site: 'bluesky', handle: '@news', url: BOT.url, purpose: BOT.purpose, status: 'active' }]);
    expect((await api.call('DELETE', `/v1/admin/communications/bots/${bot.botId}`, comms)).status).toBe(204);
    expect((await entries('bot.changed')).at(-1)?.payload.change).toBe('removed');
  });
});
