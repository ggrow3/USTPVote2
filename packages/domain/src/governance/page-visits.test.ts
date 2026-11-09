import { describe, expect, it } from 'vitest';
import { pageVisitReport, periodDays, TRACKED_PAGES, trackedPage, trackedPageById, visitDay, type PageHitsRecord, type PageVisitRecord } from './page-visits.js';

const pageOf = (path: string) => trackedPage(path)?.page.id ?? null;

describe('trackedPage (design §10.7)', () => {
  it.each([
    ['/', 'hub'],
    ['/vote', 'vote'],
    ['/signin', 'signin'],
    ['/account', 'account'],
    ['/admin', 'admin'],
    ['/courses', 'courses'],
    ['/course/transhumanism', 'course'],
    ['/course/certificates/abc', 'course-certificate'],
    ['/bylaws', 'bylaws'],
    ['/bylaws/3', 'bylaws'],
    ['/results/0193a0c4-0000-7000-8000-000000000000', 'results'],
    ['/candidates', 'candidates'],
    ['/candidates/declare', 'candidacy-declare'],
    ['/candidates/area', 'candidates-area'],
    ['/candidates/c1/edit', 'candidacy-edit'],
    ['/candidates/c1', 'candidate'],
    ['/forum/p1', 'forum-post'],
    ['/news/our-first-post', 'news-post'],
    ['/admin/members/a1', 'admin-member'],
    ['/admin/elections/e1', 'admin-election'],
    ['/admin/elections/e1/preview', 'admin-election-preview'],
  ])('%s is %s', (path, id) => {
    expect(pageOf(path)).toBe(id);
  });

  it('never tracks the ballot, its receipts or the receipt check', () => {
    for (const path of ['/ballot', '/ballot/e1', '/ballot/', '/verify', '/verify/x']) expect(trackedPage(path)).toBeNull();
  });

  it('records the path without a trailing slash', () => {
    expect(trackedPage('/candidates/c1/')).toEqual({ page: trackedPageById('candidate'), path: '/candidates/c1' });
  });

  it('records a conversation as Messages, never its address, which names the two accounts in it', () => {
    expect(trackedPage('/messages/a1_a2')).toEqual({ page: trackedPageById('messages-conversation'), path: '/messages' });
    expect(trackedPage('/messages')).toEqual({ page: trackedPageById('messages'), path: '/messages' });
    expect(trackedPage('/notifications')?.path).toBe('/notifications');
  });

  it('refuses paths the app has no page for, and anything that is not a plain path', () => {
    for (const path of [
      '/nowhere',
      '/candidates/c1/edit/more',
      '/admin/members',
      '/vote?x=1',
      '/signin#code',
      'vote',
      '//evil.example',
      '/vote/<script>',
      `/news/${'a'.repeat(200)}`,
      '/academy',
    ]) {
      expect(trackedPage(path), path).toBeNull();
    }
  });

  it('gives every page a different ID and route', () => {
    expect(new Set(TRACKED_PAGES.map((p) => p.id)).size).toBe(TRACKED_PAGES.length);
    expect(new Set(TRACKED_PAGES.map((p) => p.pattern)).size).toBe(TRACKED_PAGES.length);
  });
});

describe('periodDays', () => {
  it('lists the UTC days ending today, oldest first', () => {
    expect(periodDays('2026-11-01', 3)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(periodDays('2026-11-01', 1)).toEqual(['2026-11-01']);
  });

  it('counts by the UTC day', () => {
    expect(visitDay(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10-31');
  });
});

describe('pageVisitReport', () => {
  const visit = (accountId: string, page: string, path: string, at: string): PageVisitRecord => ({ accountId, page, path, at });

  it('sums each page over the period, busiest first, and leaves out pages not hit', () => {
    const report = pageVisitReport({
      days: 2,
      today: '2026-10-31',
      hits: new Map<string, Partial<PageHitsRecord>>([
        ['vote', { total: 9, days: { '2026-10-29': 4, '2026-10-30': 2, '2026-10-31': 3 }, signedIn: { '2026-10-31': 1 } }],
        ['hub', { total: 20, days: { '2026-10-31': 7 }, signedIn: {} }],
        ['press', { total: 1, days: { '2026-10-01': 1 } }],
        ['retired-page', { total: 1, days: { '2026-10-30': 1 } }],
      ]),
      visits: [],
      people: new Map(),
      truncated: false,
    });
    expect(report.dayList).toEqual(['2026-10-30', '2026-10-31']);
    expect(report.pages).toEqual([
      { page: 'hub', label: 'Link hub', pattern: '/', hits: 7, signedIn: 0, daily: [0, 7], signedInDaily: [0, 0], visitors: 0 },
      { page: 'vote', label: 'Voting home', pattern: '/vote', hits: 5, signedIn: 1, daily: [2, 3], signedInDaily: [0, 1], visitors: 0 },
      { page: 'retired-page', label: 'retired-page', pattern: '', hits: 1, signedIn: 0, daily: [1, 0], signedInDaily: [0, 0], visitors: 0 },
    ]);
  });

  it('gives each page its visitors by name, with their visits, first and last, and paths', () => {
    const report = pageVisitReport({
      days: 7,
      today: '2026-10-31',
      hits: new Map([['candidate', { total: 3, days: { '2026-10-31': 3 }, signedIn: { '2026-10-31': 3 } }]]),
      visits: [
        visit('a2', 'candidate', '/candidates/c1', '2026-10-31T10:00:00.000Z'),
        visit('a1', 'candidate', '/candidates/c2', '2026-10-31T09:00:00.000Z'),
        visit('a1', 'candidate', '/candidates/c1', '2026-10-31T08:00:00.000Z'),
        visit('a1', 'candidate', '/candidates/c2', '2026-10-31T11:00:00.000Z'),
      ],
      people: new Map([['a1', { name: 'Ada Brooks', email: 'ada@example.test' }]]),
      truncated: true,
    });
    expect(report.visitors).toEqual([
      {
        accountId: 'a1',
        name: 'Ada Brooks',
        email: 'ada@example.test',
        page: 'candidate',
        visits: 3,
        firstAt: '2026-10-31T08:00:00.000Z',
        lastAt: '2026-10-31T11:00:00.000Z',
        paths: [
          { path: '/candidates/c2', visits: 2 },
          { path: '/candidates/c1', visits: 1 },
        ],
      },
      {
        accountId: 'a2',
        name: null,
        email: null,
        page: 'candidate',
        visits: 1,
        firstAt: '2026-10-31T10:00:00.000Z',
        lastAt: '2026-10-31T10:00:00.000Z',
        paths: [{ path: '/candidates/c1', visits: 1 }],
      },
    ]);
    expect(report.pages[0]).toMatchObject({ page: 'candidate', hits: 3, visitors: 2 });
    expect(report.truncated).toBe(true);
  });

  it('keeps a page with visitors even when its counters are missing', () => {
    const report = pageVisitReport({
      days: 1,
      today: '2026-10-31',
      hits: new Map(),
      visits: [visit('a1', 'room', '/room', '2026-10-31T10:00:00.000Z')],
      people: new Map(),
      truncated: false,
    });
    expect(report.pages).toEqual([
      { page: 'room', label: "Members' room", pattern: '/room', hits: 0, signedIn: 0, daily: [0], signedInDaily: [0], visitors: 1 },
    ]);
    expect(report.visitors).toHaveLength(1);
  });
});
