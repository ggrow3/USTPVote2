import { csvCell, trackedPageById, type PageHits, type PageVisitor, type PageVisitReport } from 'ustp-domain';

/** What the report shows about a person: their name, else their email, else their account ID. */
export function personLabel(v: Pick<PageVisitor, 'name' | 'email' | 'accountId'>): string {
  return v.name ?? v.email ?? v.accountId;
}

/** What the report calls a page: its label, or its ID for a page the app no longer has. */
export function pageLabel(page: string): string {
  return trackedPageById(page)?.label ?? page;
}

export interface VisitTotals {
  readonly hits: number;
  readonly signedIn: number;
  readonly signedOut: number;
  /** Different people signed in who opened any page. */
  readonly people: number;
}

export function visitTotals(report: PageVisitReport): VisitTotals {
  const hits = report.pages.reduce((n, p) => n + p.hits, 0);
  const signedIn = report.pages.reduce((n, p) => n + p.signedIn, 0);
  return { hits, signedIn, signedOut: hits - signedIn, people: new Set(report.visitors.map((v) => v.accountId)).size };
}

/** One day's column in the chart. */
export interface DayHits {
  readonly day: string;
  readonly signedIn: number;
  readonly signedOut: number;
}

/** Hits per day for one page, or the whole site when `pages` lists them all. */
export function dailyHits(dayList: readonly string[], pages: readonly PageHits[]): DayHits[] {
  return dayList.map((day, i) => {
    const all = pages.reduce((n, p) => n + (p.daily[i] ?? 0), 0);
    const signedIn = pages.reduce((n, p) => n + (p.signedInDaily[i] ?? 0), 0);
    return { day, signedIn, signedOut: all - signedIn };
  });
}

/** A clean top for the chart's scale: 1, 2 or 5 times a power of ten, at least the busiest day. */
export function niceMax(n: number): number {
  if (n <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((m) => m * power).find((m) => m >= n)!;
}

const matches = (q: string, ...values: (string | null | undefined)[]) => values.some((v) => v?.toLowerCase().includes(q));

/** Pages whose name or route contains the search, or that someone matching it opened. */
export function filterPages(report: PageVisitReport, search: string): PageHits[] {
  const q = search.trim().toLowerCase();
  if (!q) return [...report.pages];
  const visited = new Set(report.visitors.filter((v) => matches(q, v.name, v.email, v.accountId)).map((v) => v.page));
  return report.pages.filter((p) => visited.has(p.page) || matches(q, p.label, p.pattern));
}

/** Who opened `page`, most visits first, narrowed to people matching the search if it names any. */
export function visitorsOf(report: PageVisitReport, page: string, search: string): PageVisitor[] {
  const q = search.trim().toLowerCase();
  const all = report.visitors.filter((v) => v.page === page);
  const people = all.filter((v) => matches(q, v.name, v.email, v.accountId));
  return q && people.length ? people : all;
}

/** One person's visits in the period, across pages. */
export interface PersonVisits {
  readonly accountId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly visits: number;
  readonly lastAt: string;
  /** Their pages, most visits first. */
  readonly pages: readonly { readonly page: string; readonly visits: number; readonly lastAt: string }[];
}

/** Everyone signed in who opened a page in the period, most visits first, narrowed by the search. */
export function people(report: PageVisitReport, search: string): PersonVisits[] {
  const q = search.trim().toLowerCase();
  const byPerson = new Map<string, PageVisitor[]>();
  for (const v of report.visitors) byPerson.set(v.accountId, [...(byPerson.get(v.accountId) ?? []), v]);
  return [...byPerson.values()]
    .map((rows) => ({
      accountId: rows[0]!.accountId,
      name: rows[0]!.name,
      email: rows[0]!.email,
      visits: rows.reduce((n, r) => n + r.visits, 0),
      lastAt: rows.map((r) => r.lastAt).sort().at(-1)!,
      pages: rows
        .map((r) => ({ page: r.page, visits: r.visits, lastAt: r.lastAt }))
        .sort((a, b) => b.visits - a.visits || b.lastAt.localeCompare(a.lastAt)),
    }))
    .filter((p) => !q || matches(q, p.name, p.email, p.accountId) || p.pages.some((r) => matches(q, pageLabel(r.page))))
    .sort((a, b) => b.visits - a.visits || b.lastAt.localeCompare(a.lastAt));
}

/** The report as a spreadsheet: a row per page and person, with the paths they opened. */
export function visitsCsv(report: PageVisitReport): string {
  const lines = [
    ['Page', 'Route', 'Name', 'Email', 'Account ID', 'Visits', 'First visit', 'Last visit', 'Paths'],
    ...report.visitors.map((v) => [
      pageLabel(v.page),
      trackedPageById(v.page)?.pattern ?? '',
      v.name ?? '',
      v.email ?? '',
      v.accountId,
      String(v.visits),
      v.firstAt,
      v.lastAt,
      v.paths.map((p) => `${p.path} (${p.visits})`).join('; '),
    ]),
  ];
  return lines.map((cells) => cells.map(csvCell).join(',') + '\r\n').join('');
}

/** `ustp-page-visits-2026-10-31.csv`, by the reader's own date. */
export function visitsCsvFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `ustp-page-visits-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
