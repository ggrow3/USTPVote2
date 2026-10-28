import { csvCell, MEMBER_STATUSES, type MemberRecord, type MemberStatus, type PositionsView } from 'ustp-domain';

/**
 * View logic for the Members tab (design §5.2): every member with the offices they hold, filtered, counted, sorted and
 * exported in the browser from what the list endpoint and the offices endpoint already return.
 */

export const STATUS_LABELS: Readonly<Record<MemberStatus, string>> = {
  applicant: 'Applicant',
  active: 'Active',
  lapsed: 'Lapsed',
  suspended: 'Suspended',
  resigned: 'Resigned',
  rejected: 'Rejected',
};

/** An office someone holds now: its title and description. */
export interface HeldOffice {
  readonly title: string;
  readonly description: string;
}

export interface MemberRow {
  readonly member: MemberRecord;
  /** Active terms of office tied to the member's account, by office title. */
  readonly offices: readonly HeldOffice[];
}

/**
 * The offices each account holds now, by title, keyed by account ID; a term entered without an account names nobody
 * here. The Members tab and the People tab (design §10.3) both show them.
 */
export function heldOffices(view: PositionsView): Map<string, HeldOffice[]> {
  const titles = new Map(view.positions.map((p) => [p.positionId, p]));
  const held = new Map<string, HeldOffice[]>();
  for (const t of view.terms) {
    const position = titles.get(t.positionId);
    if (t.status !== 'active' || !t.accountId || !position) continue;
    held.set(t.accountId, [...(held.get(t.accountId) ?? []), { title: position.title, description: position.description }]);
  }
  for (const offices of held.values()) offices.sort((a, b) => compare(a.title, b.title));
  return held;
}

/** Each member with the offices their account holds now. */
export function memberRows(members: readonly MemberRecord[], view: PositionsView): MemberRow[] {
  const held = heldOffices(view);
  return members.map((member) => ({ member, offices: held.get(member.accountId) ?? [] }));
}

/** What the Position column says for someone with no office: "Member" while they have a membership, else nothing. */
export function noOfficeText(status: MemberStatus): string {
  return ['active', 'lapsed', 'suspended'].includes(status) ? 'Member' : '—';
}

/** "Ada Brooks" → "AB": the first letters of the first and last words that start with a letter. */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export interface MemberFilter {
  /** Part of the legal or preferred name, in any case and with or without accents. */
  readonly search: string;
  /** A two-letter state code, or '' for every state. */
  readonly state: string;
}

const folded = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The rows matching the search and state; the status pills then count and filter these. */
export function filterRows(rows: readonly MemberRow[], filter: MemberFilter): MemberRow[] {
  const search = folded(filter.search.trim());
  return rows.filter(
    ({ member: m }) =>
      (!filter.state || m.state === filter.state) &&
      (!search || folded(m.legalName).includes(search) || (m.preferredName !== null && folded(m.preferredName).includes(search))),
  );
}

/** How many rows have each status. */
export function statusCounts(rows: readonly MemberRow[]): Record<MemberStatus, number> {
  const counts = Object.fromEntries(MEMBER_STATUSES.map((s) => [s, 0])) as Record<MemberStatus, number>;
  for (const { member } of rows) counts[member.status]++;
  return counts;
}

/**
 * The status pills after "All", in the domain's order: Active, Lapsed, Suspended and Resigned always, Applicant and
 * Rejected only while someone has that status (applications are decided on their own tab) or the pill is selected.
 */
export function statusFilters(counts: Readonly<Record<MemberStatus, number>>, selected: MemberStatus | null): MemberStatus[] {
  return MEMBER_STATUSES.filter((s) => (s !== 'applicant' && s !== 'rejected') || counts[s] > 0 || s === selected);
}

export type SortKey = 'name' | 'position' | 'state' | 'status' | 'since';

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const compare = (a: string, b: string) => collator.compare(a, b);

/**
 * The rows in column order, ties by name. Members without an office, and without a member-since date, come after the
 * others in either direction.
 */
export function sortRows(rows: readonly MemberRow[], key: SortKey, descending: boolean): MemberRow[] {
  const sign = descending ? -1 : 1;
  const byName = (a: MemberRow, b: MemberRow) =>
    compare(a.member.legalName, b.member.legalName) || compare(a.member.accountId, b.member.accountId);
  const byKey = (a: MemberRow, b: MemberRow): number => {
    switch (key) {
      case 'name':
        return 0;
      case 'position': {
        const [x, y] = [a.offices[0]?.title, b.offices[0]?.title];
        if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
        return sign * compare(x, y);
      }
      case 'state':
        return sign * compare(a.member.state, b.member.state);
      case 'status':
        return sign * compare(STATUS_LABELS[a.member.status], STATUS_LABELS[b.member.status]);
      case 'since': {
        const [x, y] = [a.member.memberSince, b.member.memberSince];
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
        return sign * x.localeCompare(y);
      }
    }
  };
  return [...rows].sort((a, b) => byKey(a, b) || (key === 'name' ? sign : 1) * byName(a, b));
}

const DAY = 86_400_000;

/** "Oct 22, 2026" and "4 days ago" (in the reader's language), or null for someone who has never been Active. */
export function sinceText(iso: string | null, now: Date, locale?: string): { readonly date: string; readonly ago: string } | null {
  if (!iso) return null;
  const then = new Date(iso);
  const days = Math.max(0, Math.floor((now.getTime() - then.getTime()) / DAY));
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const ago =
    days < 30
      ? relative.format(-days, 'day')
      : days < 365
        ? relative.format(-Math.floor(days / 30.44), 'month')
        : relative.format(-Math.floor(days / 365.25), 'year');
  return { date: then.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }), ago };
}

/** `2026-10-26`: the reader's own date, as the table shows it. */
function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The rows as CSV for a spreadsheet: the table's own columns and the account ID, nothing from the member's contact
 * details. RFC 4180 with CRLF line ends; cells a spreadsheet would read as a formula start with `'`. Member since is
 * the reader's own date, as the table shows it.
 */
export function membersCsv(rows: readonly MemberRow[]): string {
  const lines = [
    ['Name', 'Account ID', 'Offices', 'State', 'Status', 'Member since'],
    ...rows.map(({ member: m, offices }) => [
      m.legalName,
      m.accountId,
      offices.map((o) => o.title).join('; '),
      m.state,
      STATUS_LABELS[m.status],
      m.memberSince ? localDate(new Date(m.memberSince)) : '',
    ]),
  ];
  return lines.map((cells) => cells.map(csvCell).join(',') + '\r\n').join('');
}

/** `ustp-members-2026-10-26.csv`, by the reader's own date. */
export function membersCsvFileName(now: Date): string {
  return `ustp-members-${localDate(now)}.csv`;
}
