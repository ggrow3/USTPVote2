import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import {
  Collections,
  type BillDetail,
  type BillWatchEntry,
  type LedgerEntry,
  type PublicBillCard,
  type PublicBillRecord,
  type PublicBillTeamView,
  type PublicBillView,
  type ScorecardMemberView,
  type ScorecardView,
} from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/**
 * The public Legislation page and scorecard (design §5.14, "Legislation and the scorecard"), against the emulators
 * with `BILLS=local`: the fixture H.R. 6100 has two House roll calls and one Senate roll call, whose made-up votes
 * LocalRollCallSource gives, so nothing goes to Congress.gov or the Senate.
 */

/** The web app's index.html as Hosting serves it, for the link previews. */
const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="The site's description." />
    <meta property="og:site_name" content="USTP Vote" />
    <title>USTP Vote</title>
  </head>
  <body><div id="app"></div></body>
</html>
`;

let index: Server;
let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  index = createServer((req, res) => {
    if (req.url === '/index.html') res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', etag: '"v1"' }).end(INDEX);
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => index.listen(0, '127.0.0.1', resolve));
  process.env.WEB_ORIGIN = `http://127.0.0.1:${(index.address() as AddressInfo).port}`;
  api = await TestApi.start();
  worker = await TestWorker.start();
});
afterAll(async () => {
  delete process.env.WEB_ORIGIN;
  await worker.close();
  await api.close();
  await new Promise<void>((resolve) => index.close(() => resolve()));
});

type Member = User & { accountId: string };
let sa1: Member;
let ma: Member;
let lea: Member;
let ada: Member;

const BILL = '119-hr-6100';
const POSITIONS = { 'house-119-2-301': 'yea', 'house-119-2-300': 'nay', 'senate-119-2-250': 'yea' } as const;
const SUMMARY = 'It would fund research into the biology of aging, which the party has long asked for.';

async function memberRecord(user: Member, legalName: string) {
  await api.firebase.db.collection('members').doc(user.accountId).set({ accountId: user.accountId, status: 'active', legalName, preferredName: null, state: 'TX' });
}

async function entries(type: string): Promise<LedgerEntry[]> {
  const snap = await api.firebase.db.collection('audit_events').where('type', '==', type).orderBy('seq').get();
  return snap.docs.map((d) => d.data() as LedgerEntry);
}

const watch = (by: User, id: string, tags: string[]) => api.call('PUT', `/v1/bills/watchlist/${id}`, by, { tags, basedOn: null });
const show = (by: User | undefined, id: string, body: Record<string, unknown>) => api.call('PUT', `/v1/bills/watchlist/${id}/public`, by, body);
const publish = () => show(lea, BILL, { topic: 'longevity', summary: SUMMARY, positions: POSITIONS, basedOn: null });
/** A public read, signed out. */
const read = (path: string) => api.call('GET', path);

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  ma = await api.member('membership.admin@example.test');
  lea = await api.member('lea@example.test');
  ada = await api.member('ada@example.test');
  await api.grant(ma.accountId, 'membership_admin', sa1);
  await memberRecord(lea, 'Lea Ortiz');
  await memberRecord(ada, 'Ada Brooks');
  const team = await api.call('POST', '/v1/admin/teams', ma, {
    teamId: 'legislative',
    name: 'Legislative',
    description: 'Reads bills in Congress',
    joinPolicy: 'closed',
    joinQuestion: null,
    capacity: null,
    memberLink: null,
    color: 'indigo',
    icon: 'gavel',
    leadAccountId: lea.accountId,
  });
  expect(team.status).toBe(201);
  const settings = (await api.call('GET', '/v1/admin/bills', sa1)).body;
  expect((await api.call('PUT', '/v1/admin/bills', sa1, { teamIds: ['legislative'], basedOn: settings.version })).status).toBe(200);
  expect((await watch(lea, BILL, ['priority-alpha'])).status).toBe(200);
  expect((await api.call('POST', `/v1/bills/watchlist/${BILL}/notes`, lea, { text: 'Private: call the sponsor’s office first.' })).status).toBe(201);
});

describe('showing a bill publicly', () => {
  it('puts a watched bill on the public page with its topic, summary and positions, ledgered, and nothing of the team’s', async () => {
    const res = await publish();
    expect(res.status).toBe(200);
    const view = res.body as PublicBillTeamView;
    expect(view).toMatchObject({ topic: 'longevity', summary: SUMMARY, positions: POSITIONS, unread: [], version: 1 });
    expect(view.rollCalls.map((r) => r.voteId)).toEqual(['house-119-2-300', 'house-119-2-301', 'senate-119-2-250']);
    expect((await entries('bills.public_changed')).map((e) => [e.actor, e.subject, e.payload])).toEqual([
      [lea.accountId, BILL, { billId: BILL, change: 'published', topic: 'longevity', summary: SUMMARY, positions: POSITIONS }],
    ]);

    const list = await read('/v1/public/bills');
    expect(list.status).toBe(200);
    expect(list.body as PublicBillCard[]).toEqual([
      expect.objectContaining({ id: BILL, label: 'H.R. 6100', topic: 'longevity', status: 'passed_both', summary: SUMMARY, rollCalls: 3, scored: 3, sponsor: { name: 'Rep. Ro Khanna', party: 'D', state: 'CA', district: 17 } }),
    ]);
    const bill = await read(`/v1/public/bills/${BILL}`);
    expect(bill.status).toBe(200);
    const page = bill.body as PublicBillView;
    expect(page.votes.map((v) => [v.voteId, v.position, v.question, v.totals])).toEqual([
      ['senate-119-2-250', 'yea', 'On Passage of the Bill', { yea: 2, nay: 1, present: 1, notVoting: 0 }],
      ['house-119-2-301', 'yea', 'On Passage', { yea: 3, nay: 2, present: 0, notVoting: 0 }],
      ['house-119-2-300', 'nay', 'On Motion to Recommit', { yea: 2, nay: 3, present: 0, notVoting: 0 }],
    ]);
    expect(page.votes[1]!.parties).toEqual([
      { party: 'D', yea: 2, nay: 1, present: 0, notVoting: 0 },
      { party: 'R', yea: 1, nay: 1, present: 0, notVoting: 0 },
    ]);
    expect(page.crsSummary?.paragraphs[0]).toMatch(/biology of aging/);

    // Nothing of the team's working papers reaches the public: no tags, notes, names or accounts.
    for (const body of [JSON.stringify(list.body), JSON.stringify(bill.body)]) {
      for (const secret of ['priority-alpha', 'Private:', 'Lea Ortiz', lea.accountId, 'publishedBy', 'updatedBy']) expect(body, secret).not.toContain(secret);
    }
    expect((await read('/v1/public/bills?topic=ai')).body).toEqual([]);
    expect((await read('/v1/public/bills?topic=longevity')).body).toHaveLength(1);
    expect((await read('/v1/public/bills?topic=politics')).status).toBe(400);
    expect((await read('/v1/public/bills/119-hr-10538')).status).toBe(404);
    expect((await read('/v1/public/bills/nonsense')).status).toBe(404);
  });

  it('scores each member against the party’s positions', async () => {
    await publish();
    const card = (await read('/v1/public/scorecard')).body as ScorecardView;
    expect(card).toMatchObject({ bills: 1, votes: 3 });
    expect(card.rows.map((r) => [r.memberId, r.chamber, r.state, r.with, r.against, r.missed, r.score])).toEqual([
      ['A000055', 'house', 'AL', 2, 0, 0, 1],
      ['G000574', 'senate', 'AZ', 0, 0, 1, null],
      ['K000389', 'house', 'CA', 2, 0, 0, 1],
      ['F000446', 'house', 'IA', 0, 2, 0, 0],
      ['B001278', 'house', 'OR', 0, 2, 0, 0],
      ['C001098', 'senate', 'TX', 0, 1, 0, 0],
      ['C001131', 'house', 'TX', 2, 0, 0, 1],
      ['S000033', 'senate', 'VT', 1, 0, 0, 1],
      ['C000127', 'senate', 'WA', 1, 0, 0, 1],
    ]);
    const member = await read('/v1/public/scorecard/B001278');
    expect(member.status).toBe(200);
    const view = member.body as ScorecardMemberView;
    expect(view.member).toMatchObject({ name: 'Suzanne Bonamici', district: 1, with: 0, against: 2, score: 0 });
    expect(view.votes.map((v) => [v.voteId, v.vote, v.position, v.outcome])).toEqual([
      ['house-119-2-301', 'nay', 'yea', 'against'],
      ['house-119-2-300', 'yea', 'nay', 'against'],
    ]);
    expect((await read('/v1/public/scorecard/Z000000')).status).toBe(404);
    expect((await read('/v1/public/scorecard/not-an-id')).status).toBe(404);
  });

  it('shows the team its public page and marks it on the watchlist', async () => {
    await publish();
    const detail = (await api.call('GET', '/v1/bills/119/hr/6100', lea)).body as BillDetail;
    expect(detail.public).toMatchObject({ topic: 'longevity', version: 1, positions: POSITIONS });
    expect(detail.watch?.public).toBe(true);
    const list = (await api.call('GET', '/v1/bills/watchlist', lea)).body as BillWatchEntry[];
    expect(list.map((e) => [e.billId, e.public])).toEqual([[BILL, true]]);
    expect(((await api.call('GET', '/v1/bills/119/hr/10538', lea)).body as BillDetail).public).toBeNull();
  });

  it('changes from the version edited, and refuses a stale save, a stray position, an unwatched bill and anyone without the tool', async () => {
    await publish();
    expect((await publish()).status).toBe(409);
    expect((await show(lea, BILL, { topic: 'ai', summary: '', positions: { 'house-119-2-1': 'yea' }, basedOn: 1 })).status).toBe(409);
    expect((await show(lea, '119-hr-10538', { topic: 'ai', summary: '', positions: {}, basedOn: null })).status).toBe(409);
    expect((await show(lea, BILL, { topic: 'politics', summary: '', positions: {}, basedOn: 1 })).status).toBe(400);
    expect((await show(ada, BILL, { topic: 'ai', summary: '', positions: {}, basedOn: 1 })).status).toBe(403);
    expect((await show(undefined, BILL, { topic: 'ai', summary: '', positions: {}, basedOn: 1 })).status).toBe(401);

    const changed = await show(lea, BILL, { topic: 'science', summary: 'Shorter.', positions: { 'house-119-2-301': 'yea' }, basedOn: 1 });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ topic: 'science', version: 2, positions: { 'house-119-2-301': 'yea' } });
    expect((await entries('bills.public_changed')).map((e) => (e.payload as { change: string }).change)).toEqual(['published', 'changed']);
    const card = (await read('/v1/public/scorecard')).body as ScorecardView;
    expect(card.votes).toBe(1);
    expect(card.rows.find((r) => r.memberId === 'B001278')).toMatchObject({ with: 0, against: 1 });
    // The senators are in no scored roll call now.
    expect(card.rows.some((r) => r.chamber === 'senate')).toBe(false);
    // Their unscored votes still show on their own pages.
    expect(((await read('/v1/public/scorecard/S000033')).body as ScorecardMemberView).votes[0]).toMatchObject({ outcome: 'unscored', position: null });
  });

  it('keeps a public bill on the watchlist until it is taken off the public page, which drops its votes too', async () => {
    await publish();
    const refused = await api.call('DELETE', `/v1/bills/watchlist/${BILL}`, lea);
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toMatch(/public Legislation page/);
    expect((await api.call('DELETE', `/v1/bills/watchlist/${BILL}/public`, ada)).status).toBe(403);
    expect((await api.call('DELETE', `/v1/bills/watchlist/${BILL}/public`, lea)).status).toBe(200);
    expect((await api.call('DELETE', `/v1/bills/watchlist/${BILL}/public`, lea)).status).toBe(404);
    expect((await read('/v1/public/bills')).body).toEqual([]);
    expect((await read('/v1/public/scorecard')).body).toMatchObject({ rows: [], votes: 0 });
    expect((await api.firebase.db.collection(Collections.billRollCalls).get()).size).toBe(0);
    expect((await entries('bills.public_changed')).map((e) => e.payload)).toEqual([
      expect.objectContaining({ change: 'published' }),
      { billId: BILL, change: 'withdrawn', topic: null, summary: null, positions: null },
    ]);
    expect((await api.call('DELETE', `/v1/bills/watchlist/${BILL}`, lea)).status).toBe(200);
  });
});

describe('keeping public bills current', () => {
  it('reads a public bill again on the worker’s tick when due, with roll calls missing, keeping the team’s fields', async () => {
    await publish();
    const db = api.firebase.db;
    const ref = db.collection(Collections.billPublic).doc(BILL);
    const before = (await ref.get()).data() as PublicBillRecord;
    expect(Date.parse(before.nextCheckAt) - Date.parse(before.checkedAt)).toBe(6 * 60 * 60 * 1000);

    // Not due yet: nothing is read.
    expect((await worker.tick()).body.publicBillsRefreshed).toBe(0);

    await ref.update({ nextCheckAt: '2026-01-01T00:00:00.000Z', title: 'An old title', checkedAt: '2026-01-01T00:00:00.000Z' });
    await db.collection(Collections.billRollCalls).doc('senate-119-2-250').delete();
    const tick = await worker.tick();
    expect(tick.status).toBe(200);
    expect(tick.body.publicBillsRefreshed).toBe(1);
    const after = (await ref.get()).data() as PublicBillRecord;
    expect(after).toMatchObject({ title: 'Longevity Research Acceleration Act (a local fixture)', topic: 'longevity', summary: SUMMARY, positions: POSITIONS, version: 1, refreshFailedAt: null });
    expect(after.checkedAt > before.checkedAt).toBe(true);
    expect((await db.collection(Collections.billRollCalls).doc('senate-119-2-250').get()).exists).toBe(true);
  });
});

describe('link previews and search engines', () => {
  const get = (url: string) => api.app.inject({ method: 'GET', url, headers: { 'x-forwarded-host': 'vote.example.org', 'x-forwarded-proto': 'https' } });
  const meta = (html: string, key: string) => html.match(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`))?.[1];

  it('gives the bills, the scorecard and each of their pages a preview of its own', async () => {
    await publish();
    const bill = await get(`/legislation/${BILL}`);
    expect(bill.statusCode).toBe(200);
    expect(meta(bill.body, 'og:title')).toBe('H.R. 6100: Longevity Research Acceleration Act (a local fixture)');
    expect(meta(bill.body, 'og:description')).toBe(SUMMARY);
    expect(meta(bill.body, 'og:type')).toBe('article');
    expect(meta(bill.body, 'og:image:alt')).toBe('Bill in Congress · Longevity: H.R. 6100: Longevity Research Acceleration Act (a local fixture)');

    const member = await get('/scorecard/B001278');
    expect(meta(member.body, 'og:title')).toBe('Rep. Suzanne Bonamici (D-OR-1): scorecard');
    expect(meta(member.body, 'og:description')).toMatch(/voted with the U\.S\. Transhumanist Party&#39;s position on 0 of 2 scored votes/);
    const image = meta(member.body, 'og:image')!;
    const card = await api.app.inject({ method: 'GET', url: image.replace(/^https?:\/\/[^/]+/, '') });
    expect(card.statusCode).toBe(200);
    expect((await sharp(card.rawPayload).metadata()).width).toBe(1200);

    expect(meta((await get('/legislation')).body, 'og:title')).toBe('Science, AI and longevity bills in Congress');
    expect(meta((await get('/scorecard')).body, 'og:description')).toMatch(/3 roll calls on 1 bill\.$/);
    // A bill the party does not show, or nobody in a roll call here, gets the site's own head.
    expect(meta((await get('/legislation/119-hr-10538')).body, 'og:title')).toBeUndefined();
    expect(meta((await get('/scorecard/Z000000')).body, 'og:title')).toBeUndefined();
  });

  it('lists the Legislation pages and each public bill in the sitemap', async () => {
    await publish();
    const sitemap = await get('/sitemap.xml');
    expect(sitemap.statusCode).toBe(200);
    for (const path of ['/legislation', '/scorecard', `/legislation/${BILL}`]) expect(sitemap.body).toContain(`<loc>https://vote.example.org${path}</loc>`);
  });
});
