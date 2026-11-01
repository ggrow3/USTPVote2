import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_VISITS_UNTRACKED, TRACKED_PAGES, type PageVisitReport } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import {
  dailyHits,
  filterPages,
  niceMax,
  pageLabel,
  people,
  personLabel,
  visitorsOf,
  visitsCsv,
  visitsCsvFileName,
  visitTotals,
} from './page-visits.js';

const REPORT: PageVisitReport = {
  days: 2,
  dayList: ['2026-10-30', '2026-10-31'],
  pages: [
    { page: 'hub', label: 'Link hub', pattern: '/', hits: 10, signedIn: 3, daily: [4, 6], signedInDaily: [1, 2], visitors: 1 },
    { page: 'forum-post', label: 'A forum post', pattern: '/forum/:postId', hits: 4, signedIn: 4, daily: [0, 4], signedInDaily: [0, 4], visitors: 2 },
  ],
  visitors: [
    {
      accountId: 'a1',
      name: 'Ada Brooks',
      email: 'ada@example.test',
      page: 'forum-post',
      visits: 3,
      firstAt: '2026-10-31T08:00:00.000Z',
      lastAt: '2026-10-31T11:00:00.000Z',
      paths: [
        { path: '/forum/p2', visits: 2 },
        { path: '/forum/p1', visits: 1 },
      ],
    },
    {
      accountId: 'a1',
      name: 'Ada Brooks',
      email: 'ada@example.test',
      page: 'hub',
      visits: 3,
      firstAt: '2026-10-30T08:00:00.000Z',
      lastAt: '2026-10-31T12:00:00.000Z',
      paths: [{ path: '/', visits: 3 }],
    },
    {
      accountId: 'a2',
      name: null,
      email: 'ben@example.test',
      page: 'forum-post',
      visits: 1,
      firstAt: '2026-10-31T10:00:00.000Z',
      lastAt: '2026-10-31T10:00:00.000Z',
      paths: [{ path: '/forum/p1', visits: 1 }],
    },
  ],
  truncated: false,
};

describe('the page-visits report (design §10.7)', () => {
  it('names a person by name, else email, else account', () => {
    expect(personLabel({ name: 'Ada Brooks', email: 'ada@example.test', accountId: 'a1' })).toBe('Ada Brooks');
    expect(personLabel({ name: null, email: 'ben@example.test', accountId: 'a2' })).toBe('ben@example.test');
    expect(personLabel({ name: null, email: null, accountId: 'a3' })).toBe('a3');
    expect(pageLabel('room')).toBe("Members' room");
    expect(pageLabel('retired')).toBe('retired');
  });

  it('totals the hits and the people', () => {
    expect(visitTotals(REPORT)).toEqual({ hits: 14, signedIn: 7, signedOut: 7, people: 2 });
  });

  it('charts the whole site or one page by day', () => {
    expect(dailyHits(REPORT.dayList, REPORT.pages)).toEqual([
      { day: '2026-10-30', signedIn: 1, signedOut: 3 },
      { day: '2026-10-31', signedIn: 6, signedOut: 4 },
    ]);
    expect(dailyHits(REPORT.dayList, [REPORT.pages[1]!])).toEqual([
      { day: '2026-10-30', signedIn: 0, signedOut: 0 },
      { day: '2026-10-31', signedIn: 4, signedOut: 0 },
    ]);
  });

  it('rounds the scale up to 1, 2 or 5 of a power of ten', () => {
    expect([0, 1, 3, 7, 10, 11, 140, 2001].map(niceMax)).toEqual([1, 1, 5, 10, 10, 20, 200, 5000]);
  });

  it('finds pages by name or route, and the pages a person opened', () => {
    expect(filterPages(REPORT, '').map((p) => p.page)).toEqual(['hub', 'forum-post']);
    expect(filterPages(REPORT, 'FORUM').map((p) => p.page)).toEqual(['forum-post']);
    expect(filterPages(REPORT, 'ben@').map((p) => p.page)).toEqual(['forum-post']);
    expect(filterPages(REPORT, 'nobody')).toEqual([]);
  });

  it("lists a page's visitors, narrowed to the people searched for", () => {
    expect(visitorsOf(REPORT, 'forum-post', '').map((v) => v.accountId)).toEqual(['a1', 'a2']);
    expect(visitorsOf(REPORT, 'forum-post', 'ben').map((v) => v.accountId)).toEqual(['a2']);
    // A search for the page itself names nobody, so everyone stays.
    expect(visitorsOf(REPORT, 'forum-post', 'forum').map((v) => v.accountId)).toEqual(['a1', 'a2']);
  });

  it('gathers each person across pages, most visits first', () => {
    expect(people(REPORT, '')).toEqual([
      {
        accountId: 'a1',
        name: 'Ada Brooks',
        email: 'ada@example.test',
        visits: 6,
        lastAt: '2026-10-31T12:00:00.000Z',
        pages: [
          { page: 'hub', visits: 3, lastAt: '2026-10-31T12:00:00.000Z' },
          { page: 'forum-post', visits: 3, lastAt: '2026-10-31T11:00:00.000Z' },
        ],
      },
      expect.objectContaining({ accountId: 'a2', visits: 1 }),
    ]);
    expect(people(REPORT, 'hub').map((p) => p.accountId)).toEqual(['a1']);
  });

  it('exports a row per page and person', () => {
    const csv = visitsCsv(REPORT).split('\r\n');
    expect(csv[0]).toBe('Page,Route,Name,Email,Account ID,Visits,First visit,Last visit,Paths');
    expect(csv[1]).toBe(
      'A forum post,/forum/:postId,Ada Brooks,ada@example.test,a1,3,2026-10-31T08:00:00.000Z,2026-10-31T11:00:00.000Z,/forum/p2 (2); /forum/p1 (1)',
    );
    expect(csv).toHaveLength(5);
    expect(visitsCsvFileName(new Date(2026, 9, 31))).toBe('ustp-page-visits-2026-10-31.csv');
  });
});

describe('the pages tracked', () => {
  // Every page in router.ts, as a full route: its children are written without the leading slash.
  const source = readFileSync(join(import.meta.dirname, '..', 'router.ts'), 'utf8');
  const router = source.slice(source.indexOf('routes: ['), source.indexOf('router.beforeEach'));
  const routes = [...router.matchAll(/path: '([^']*)'/g)]
    .map((m) => m[1]!)
    .filter((path) => path !== '/' && !path.startsWith('/:pathMatch'))
    .map((path) => `/${path}`);
  const redirects = [...router.matchAll(/path: '([^']*)', redirect:/g)].map((m) => `/${m[1]}`);
  const untracked = routes.filter((route) => PAGE_VISITS_UNTRACKED.some((p) => route === p || route.startsWith(`${p}/`)));

  it('are every page of the router but the ballot and the receipt check, by the same routes', () => {
    expect(untracked.sort()).toEqual(['/ballot', '/ballot/:id', '/verify']);
    const pages = routes.filter((route) => !redirects.includes(route) && !untracked.includes(route));
    expect(pages.sort()).toEqual(TRACKED_PAGES.map((p) => p.pattern).sort());
  });
});
