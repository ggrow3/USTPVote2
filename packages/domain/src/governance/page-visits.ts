import { z } from 'zod';

/**
 * Page visits (design §10.7): how often each page of the web app is opened, and which signed-in people open it. Hits
 * are counted per page and UTC day for good, with nothing about who. A visit by someone signed in to an account is
 * also recorded with that account, for System Admins and Auditors to read, and expires after
 * `PAGE_VISIT_RETENTION_DAYS`. The ballot and the receipt check are never tracked, so no visit sits beside a cast.
 */

/** How long a visit naming its account is kept before Firestore's TTL deletes it, as the sign-in log. */
export const PAGE_VISIT_RETENTION_DAYS = 180;

/** Pages never tracked, nor the pages under them: the ballot and its receipts, and checking a receipt. */
export const PAGE_VISITS_UNTRACKED = ['/ballot', '/verify'] as const;

/** A tracked page of the web app: its ID (the `page_hits` document), its route and what the report calls it. */
export interface TrackedPage {
  readonly id: string;
  /** The route, as the web app's router writes it: `:name` is one segment, `:name?` an optional last one. */
  readonly pattern: string;
  readonly label: string;
  /**
   * The path recorded for every visit to it, in place of the path opened, for a page whose address says too much: a
   * conversation's names the two accounts in it (design §10.13), so its visits are recorded as `/messages`.
   */
  readonly recordAs?: string;
}

/** Every page the web app's router has but the untracked ones, more specific routes first. */
export const TRACKED_PAGES: readonly TrackedPage[] = [
  { id: 'hub', pattern: '/', label: 'Link hub' },
  { id: 'vote', pattern: '/vote', label: 'Voting home' },
  { id: 'signin', pattern: '/signin', label: 'Sign in' },
  { id: 'email-action', pattern: '/email-action', label: 'Account email link' },
  { id: 'register', pattern: '/register', label: 'Register' },
  { id: 'set-password', pattern: '/set-password', label: 'Set your password' },
  { id: 'unsubscribe', pattern: '/unsubscribe', label: 'Unsubscribe' },
  { id: 'account', pattern: '/account', label: 'Account' },
  { id: 'notifications', pattern: '/notifications', label: 'Notifications' },
  { id: 'messages-team', pattern: '/messages/team/:threadId', label: 'A conversation with the membership team' },
  { id: 'messages-conversation', pattern: '/messages/:threadId', label: 'A conversation (recorded as Messages)', recordAs: '/messages' },
  { id: 'messages', pattern: '/messages', label: 'Messages' },
  { id: 'guide', pattern: '/guide', label: 'Guide' },
  { id: 'courses', pattern: '/courses', label: 'Courses' },
  { id: 'course-certificate', pattern: '/course/certificates/:id', label: 'A course certificate' },
  { id: 'course', pattern: '/course/:courseId', label: 'A course' },
  { id: 'bylaws', pattern: '/bylaws/:version?', label: 'Bylaws' },
  { id: 'results', pattern: '/results/:id', label: 'Election results' },
  { id: 'offices', pattern: '/offices', label: 'Offices' },
  { id: 'candidates', pattern: '/candidates', label: 'Candidates' },
  { id: 'candidacy-declare', pattern: '/candidates/declare', label: 'Declare a candidacy' },
  { id: 'candidates-area', pattern: '/candidates/area', label: 'Your area' },
  { id: 'candidacy-edit', pattern: '/candidates/:candidacyId/edit', label: 'Edit a candidacy' },
  { id: 'candidate', pattern: '/candidates/:id', label: 'A candidate' },
  { id: 'teams', pattern: '/teams', label: 'Teams' },
  { id: 'team', pattern: '/teams/:teamId', label: 'A team' },
  { id: 'forum', pattern: '/forum', label: 'Forum' },
  { id: 'forum-post', pattern: '/forum/:postId', label: 'A forum post' },
  { id: 'room', pattern: '/room', label: "Members' room" },
  { id: 'bills', pattern: '/bills', label: 'Bills in Congress' },
  { id: 'bill', pattern: '/bills/:congress/:type/:number', label: 'A bill in Congress' },
  { id: 'news', pattern: '/news', label: 'News' },
  { id: 'news-post', pattern: '/news/:slug', label: 'A news post' },
  { id: 'events', pattern: '/events', label: 'Events' },
  { id: 'event', pattern: '/events/:slug', label: 'An event' },
  { id: 'partners', pattern: '/partners', label: 'Partners' },
  { id: 'press', pattern: '/press', label: 'Press kit' },
  { id: 'suggest', pattern: '/suggest', label: 'Suggestions' },
  { id: 'share', pattern: '/share', label: 'Share kit' },
  { id: 'admin', pattern: '/admin', label: 'Admin console' },
  { id: 'admin-member', pattern: '/admin/members/:accountId', label: "A member's record (admin)" },
  { id: 'admin-inbox-thread', pattern: '/admin/inbox/:threadId', label: 'A membership inbox conversation (admin)' },
  { id: 'admin-team', pattern: '/admin/teams/:teamId', label: 'A team (admin)' },
  { id: 'admin-forum-post', pattern: '/admin/forum/posts/:postId', label: 'A forum post (moderators)' },
  { id: 'admin-election-preview', pattern: '/admin/elections/:id/preview', label: 'Ballot preview (admin)' },
  { id: 'admin-election', pattern: '/admin/elections/:id', label: 'Election editor' },
];

const BY_ID = new Map(TRACKED_PAGES.map((p) => [p.id, p]));

export function trackedPageById(id: string): TrackedPage | undefined {
  return BY_ID.get(id);
}

/** The most a recorded path may hold, and the characters it may have (a URL path's, percent-encoded). */
export const PAGE_PATH_MAX = 200;
const PATH_CHARS = /^\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/]*$/;

function patternRegex(pattern: string): RegExp {
  if (pattern === '/') return /^\/$/;
  const parts = pattern
    .split('/')
    .slice(1)
    .map((segment) => (segment.startsWith(':') ? (segment.endsWith('?') ? '(?:/[^/]+)?' : '/[^/]+') : `/${segment}`));
  return new RegExp(`^${parts.join('')}$`);
}

const MATCHERS = TRACKED_PAGES.map((page) => ({ page, regex: patternRegex(page.pattern) }));

/**
 * The tracked page a path is, with the path as recorded (no trailing slash), or null: an untracked page (the ballot,
 * the receipt check), a path the app has no page for, or one too long or with characters a path cannot have. A query
 * string or fragment is never part of a path, as they can carry sign-in links' codes.
 */
export function trackedPage(path: string): { readonly page: TrackedPage; readonly path: string } | null {
  if (path.length > PAGE_PATH_MAX || !PATH_CHARS.test(path) || path.includes('//')) return null;
  const tidy = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  if (PAGE_VISITS_UNTRACKED.some((p) => tidy === p || tidy.startsWith(`${p}/`))) return null;
  const match = MATCHERS.find((m) => m.regex.test(tidy));
  return match ? { page: match.page, path: match.page.recordAs ?? tidy } : null;
}

/** `POST /v1/page-visits` and `POST /v1/public/page-visits`: the path of the page opened. */
export const pageVisitSchema = z.object({ path: z.string().min(1).max(PAGE_PATH_MAX) });
export type PageVisitInput = z.infer<typeof pageVisitSchema>;

/** At most this many visits a minute from one account or address, per api instance; more are refused (429). */
export const PAGE_VISIT_RATE = { visits: 60, windowMs: 60_000 } as const;

/** A UTC day, `YYYY-MM-DD`: hits are counted per day. */
export function visitDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * `page_hits/{page}`: every hit on a page, per UTC day, and those by people signed in to an account. Nothing about
 * who, so it is kept for good, as the hub's click counts are.
 */
export interface PageHitsRecord {
  readonly total: number;
  readonly days: Readonly<Record<string, number>>;
  readonly signedIn: Readonly<Record<string, number>>;
}

/**
 * `page_visits/{visitId}`: one visit by someone signed in to an account. A System Admin acting as a test persona
 * (design §10.4) is recorded as themself.
 */
export interface PageVisitRecord {
  readonly accountId: string;
  readonly page: string;
  readonly path: string;
  /** When the page was opened, ISO 8601. */
  readonly at: string;
}

/** The periods the report covers, in UTC days ending today, and the most visits one report reads. */
export const PAGE_VISIT_PERIODS = [1, 7, 30, 90, 180] as const;
export const PAGE_VISIT_LOG_MAX = 20_000;

/** The `days` UTC days ending `today`, oldest first. */
export function periodDays(today: string, days: number): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** A page's hits in the report's period: in all, by people signed in, and per day (oldest first, as `PageVisitReport.dayList`). */
export interface PageHits {
  readonly page: string;
  readonly label: string;
  readonly pattern: string;
  readonly hits: number;
  readonly signedIn: number;
  readonly daily: readonly number[];
  readonly signedInDaily: readonly number[];
  /** Different accounts that opened it in the period (from the visits read). */
  readonly visitors: number;
}

/** One person's visits to one page in the period. */
export interface PageVisitor {
  readonly accountId: string;
  /** The name they go by as a member, else their legal name, else their account's display name; else null. */
  readonly name: string | null;
  readonly email: string | null;
  readonly page: string;
  readonly visits: number;
  readonly firstAt: string;
  readonly lastAt: string;
  /** The paths opened, most visits first: for pages like a candidate's, which one. */
  readonly paths: readonly { readonly path: string; readonly visits: number }[];
}

/** `GET /v1/admin/page-visits?days=`: hits per page over the period, and who opened each page. */
export interface PageVisitReport {
  readonly days: number;
  /** Each UTC day of the period, oldest first; `daily` counts line up with it. */
  readonly dayList: readonly string[];
  /** Pages hit in the period, busiest first. */
  readonly pages: readonly PageHits[];
  /** Per page and person, most visits first. */
  readonly visitors: readonly PageVisitor[];
  /** More visits naming people happened in the period than `PAGE_VISIT_LOG_MAX` (the oldest are left out). */
  readonly truncated: boolean;
}

const countsOn = (days: Readonly<Record<string, number>> | undefined, dayList: readonly string[]) =>
  dayList.map((day) => (typeof days?.[day] === 'number' ? days[day] : 0));
const sum = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0);

/**
 * The report from the pages' counters, the visits read for the period (any order) and the visitors' names. A page
 * no longer tracked keeps its counts, under its ID.
 */
export function pageVisitReport(input: {
  readonly days: number;
  readonly today: string;
  readonly hits: ReadonlyMap<string, Partial<PageHitsRecord>>;
  readonly visits: readonly PageVisitRecord[];
  readonly people: ReadonlyMap<string, { readonly name: string | null; readonly email: string | null }>;
  readonly truncated: boolean;
}): PageVisitReport {
  const dayList = periodDays(input.today, input.days);
  const byPageAndPerson = new Map<string, PageVisitRecord[]>();
  for (const v of input.visits) {
    const key = `${v.page}\u0000${v.accountId}`;
    byPageAndPerson.set(key, [...(byPageAndPerson.get(key) ?? []), v]);
  }
  const visitors: PageVisitor[] = [...byPageAndPerson.values()].map((visits) => {
    const { page, accountId } = visits[0]!;
    const times = visits.map((v) => v.at).sort();
    const paths = new Map<string, number>();
    for (const v of visits) paths.set(v.path, (paths.get(v.path) ?? 0) + 1);
    const person = input.people.get(accountId);
    return {
      accountId,
      name: person?.name ?? null,
      email: person?.email ?? null,
      page,
      visits: visits.length,
      firstAt: times[0]!,
      lastAt: times[times.length - 1]!,
      paths: [...paths].map(([path, n]) => ({ path, visits: n })).sort((a, b) => b.visits - a.visits || a.path.localeCompare(b.path)),
    };
  });
  visitors.sort((a, b) => b.visits - a.visits || b.lastAt.localeCompare(a.lastAt));

  const visitorCount = new Map<string, number>();
  for (const v of visitors) visitorCount.set(v.page, (visitorCount.get(v.page) ?? 0) + 1);
  const pages: PageHits[] = [...new Set([...input.hits.keys(), ...visitorCount.keys()])]
    .map((id) => {
      const page = trackedPageById(id);
      const record = input.hits.get(id);
      const daily = countsOn(record?.days, dayList);
      const signedInDaily = countsOn(record?.signedIn, dayList);
      return {
        page: id,
        label: page?.label ?? id,
        pattern: page?.pattern ?? '',
        hits: sum(daily),
        signedIn: sum(signedInDaily),
        daily,
        signedInDaily,
        visitors: visitorCount.get(id) ?? 0,
      };
    })
    .filter((p) => p.hits > 0 || p.visitors > 0)
    .sort((a, b) => b.hits - a.hits || a.label.localeCompare(b.label));
  return { days: input.days, dayList, pages, visitors, truncated: input.truncated };
}
