import { Timestamp } from 'firebase-admin/firestore';
import { PAGE_VISIT_RATE, PAGE_VISIT_RETENTION_DAYS, visitDay, type PageVisitReport } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PageVisitsService } from './security/page-visits.js';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;

beforeEach(async () => {
  await resetEmulators();
  api.app.get(PageVisitsService).forget();
  [sa1] = await api.systemAdmins();
});

const today = () => visitDay(new Date());
const hitsOf = async (page: string) => (await api.firebase.db.collection('page_hits').doc(page).get()).data();
const visitsOf = async () => (await api.firebase.db.collection('page_visits').get()).docs.map((d) => d.data());
const visitSignedOut = (path: string, address = '198.51.100.7') =>
  api.call('POST', '/v1/public/page-visits', undefined, { path }, { 'x-forwarded-for': `${address}, 35.191.0.1` });
const visit = (user: User, path: string) => api.call('POST', '/v1/page-visits', user, { path });

describe('page visits (design §10.7)', () => {
  it('counts a signed-out visit and records nothing about who', async () => {
    expect((await visitSignedOut('/news')).status).toBe(204);
    expect((await visitSignedOut('/news')).status).toBe(204);
    expect(await hitsOf('news')).toEqual({ total: 2, days: { [today()]: 2 } });
    expect(await visitsOf()).toEqual([]);
  });

  it('records a signed-in visit with the account, the path, and when it expires', async () => {
    const pat = await api.member('pat@example.test');
    expect((await visit(pat, '/candidates/c1/')).status).toBe(204);

    expect(await hitsOf('candidate')).toEqual({ total: 1, days: { [today()]: 1 }, signedIn: { [today()]: 1 } });
    const [record, ...rest] = await visitsOf();
    expect(rest).toEqual([]);
    expect(record).toMatchObject({ accountId: pat.accountId, page: 'candidate', path: '/candidates/c1' });
    const days = ((record!.expireAt as Timestamp).toMillis() - Date.parse(record!.at as string)) / 86_400_000;
    expect(days).toBeCloseTo(PAGE_VISIT_RETENTION_DAYS, 3);
  });

  it('only counts a login that has no account yet', async () => {
    const lee = await api.user('lee@example.test');
    expect((await visit(lee, '/register')).status).toBe(204);
    expect(await hitsOf('register')).toEqual({ total: 1, days: { [today()]: 1 } });
    expect(await visitsOf()).toEqual([]);
  });

  it('never tracks the ballot or the receipt check, nor paths the app has no page for', async () => {
    const pat = await api.member('pat@example.test');
    for (const path of ['/ballot', '/ballot/0193a0c4-0000-7000-8000-000000000000', '/verify', '/nowhere', '/signin?code=x']) {
      expect((await visit(pat, path)).status, path).toBe(404);
      expect((await visitSignedOut(path)).status, path).toBe(404);
    }
    expect((await visit(pat, '')).status).toBe(400);
    expect((await api.firebase.db.collection('page_hits').get()).empty).toBe(true);
    expect(await visitsOf()).toEqual([]);
  });

  it('refuses more than its share of visits a minute from one address or account', async () => {
    for (let i = 0; i < PAGE_VISIT_RATE.visits; i++) expect((await visitSignedOut('/')).status).toBe(204);
    expect((await visitSignedOut('/')).status).toBe(429);
    expect((await visitSignedOut('/', '203.0.113.9')).status).toBe(204);
    expect((await hitsOf('hub'))?.total).toBe(PAGE_VISIT_RATE.visits + 1);

    const pat = await api.member('pat@example.test');
    for (let i = 0; i < PAGE_VISIT_RATE.visits; i++) expect((await visit(pat, '/vote')).status).toBe(204);
    expect((await visit(pat, '/vote')).status).toBe(429);
  });

  it('is read by System Admins and Auditors only: hits per page and who opened each one', async () => {
    const aud = await api.member('aud@example.test');
    await api.grant(aud.accountId, 'auditor', sa1);
    const ma = await api.member('ma@example.test');
    await api.grant(ma.accountId, 'membership_admin', sa1);
    const ada = await api.member('ada@example.test');
    // A member by their member name; staff without a membership by their account's display name.
    await api.firebase.db.collection('members').doc(ada.accountId).set({ accountId: ada.accountId, legalName: 'Ada Q. Brooks', preferredName: 'Ada Brooks' });
    await api.firebase.db.collection('accounts').doc(aud.accountId).update({ displayName: 'Ann Auditor' });

    await visit(ada, '/forum/p1');
    await visit(ada, '/forum/p2');
    await visit(ada, '/forum/p1');
    await visit(aud, '/forum/p1');
    await visitSignedOut('/forum/p1');
    // A visit older than the period is left out.
    await api.firebase.db.collection('page_visits').add({
      accountId: ma.accountId,
      page: 'forum-post',
      path: '/forum/p9',
      at: '2020-01-01T00:00:00.000Z',
      expireAt: Timestamp.now(),
    });

    const read = (by: User | undefined, days?: number) => api.call('GET', `/v1/admin/page-visits${days ? `?days=${days}` : ''}`, by);
    expect((await read(ma)).status).toBe(403);
    expect((await read(undefined)).status).toBe(401);
    expect((await read(sa1)).status).toBe(200);

    const res = await read(aud, 7);
    expect(res.status).toBe(200);
    const report = res.body as PageVisitReport;
    expect(report.days).toBe(7);
    expect(report.dayList).toHaveLength(7);
    expect(report.dayList.at(-1)).toBe(today());
    expect(report.pages).toEqual([
      expect.objectContaining({ page: 'forum-post', label: 'A forum post', hits: 5, signedIn: 4, visitors: 2 }),
    ]);
    expect(report.pages[0]!.daily.at(-1)).toBe(5);
    expect(report.visitors).toEqual([
      expect.objectContaining({
        accountId: ada.accountId,
        name: 'Ada Brooks',
        email: 'ada@example.test',
        page: 'forum-post',
        visits: 3,
        paths: [
          { path: '/forum/p1', visits: 2 },
          { path: '/forum/p2', visits: 1 },
        ],
      }),
      expect.objectContaining({ accountId: aud.accountId, name: 'Ann Auditor', email: 'aud@example.test', visits: 1 }),
    ]);
    expect(report.truncated).toBe(false);
    // Any other period is read as 30 days.
    expect(((await read(aud, 12)).body as PageVisitReport).days).toBe(30);
  });
});
