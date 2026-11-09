import { z } from 'zod';
import type { MailKind, MailMessageRecord, MailStatus } from './mail.js';

/**
 * Daily counts of the email log (design §10.12, asked 2026-11-09): how many emails the site sent each day, and on one day
 * how many went to each person and to which address, for System and Site Admins to keep track of what goes out. Days are
 * the admin's own: their browser names its time zone, and each day runs from that zone's midnight to the next.
 */

/** How many days back the list of totals goes at most, and by default. */
export const MAIL_DAYS_MAX = 90;
export const MAIL_DAYS_DEFAULT = 30;

/** At most this many records are read for one day's breakdown; the day's total is counted by Firestore all the same. */
export const MAIL_DAY_SCAN = 20_000;

/** At most this many people are listed for one day, those sent the most first; how many there were is said. */
export const MAIL_DAY_PEOPLE = 1_000;

/** Whether this is a time zone the platform knows (an IANA name, such as `America/New_York`, or `UTC`). */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** A time zone as a query names it: the admin's browser's, `UTC` when none is given. */
export const timeZoneSchema = z.string().trim().min(1).max(64).refine(isTimeZone, 'a time zone, such as America/New_York');

const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'a date, YYYY-MM-DD')
  .refine((d) => new Date(`${d}T00:00:00.000Z`).toISOString().startsWith(d), 'a date that exists');

/** `GET /v1/admin/mail/days`: the total of each of the last `days` days, today included. */
export const mailDaysQuerySchema = z.strictObject({
  days: z.coerce.number().int().min(1).max(MAIL_DAYS_MAX).default(MAIL_DAYS_DEFAULT),
  tz: timeZoneSchema.default('UTC'),
});
export type MailDaysQuery = z.infer<typeof mailDaysQuerySchema>;

/** `GET /v1/admin/mail/day`: one day's emails, by person, kind and what became of them. */
export const mailDayQuerySchema = z.strictObject({
  day: daySchema,
  tz: timeZoneSchema.default('UTC'),
});
export type MailDayQuery = z.infer<typeof mailDayQuerySchema>;

/** How far `zone`'s clock is ahead of UTC at this instant, in milliseconds. */
function zoneOffsetMs(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** When a day (`YYYY-MM-DD`) begins in a time zone, as an ISO time: its midnight there. */
export function zoneDayStart(day: string, zone: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const midnight = Date.UTC(y, m - 1, d);
  // The offset at midnight UTC, then again at the instant that gives, which settles a change of clocks between the two.
  const first = midnight - zoneOffsetMs(midnight, zone);
  return new Date(midnight - zoneOffsetMs(first, zone)).toISOString();
}

/** The day after (or `n` days after, or before for a negative `n`) a day, as `YYYY-MM-DD`. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The day an instant falls on in a time zone, as `YYYY-MM-DD`. */
export function zoneDay(instant: Date, zone: string): string {
  return new Date(instant.getTime() + zoneOffsetMs(instant.getTime(), zone)).toISOString().slice(0, 10);
}

/** A day's bounds in a time zone: from its midnight up to (not including) the next. */
export function zoneDayBounds(day: string, zone: string): { readonly start: string; readonly end: string } {
  return { start: zoneDayStart(day, zone), end: zoneDayStart(addDays(day, 1), zone) };
}

/** One day's total. */
export interface MailDayTotal {
  readonly day: string;
  readonly start: string;
  readonly end: string;
  readonly emails: number;
}

/** `GET /v1/admin/mail/days`: oldest day first, today last. */
export interface MailDaysView {
  readonly zone: string;
  readonly days: readonly MailDayTotal[];
}

export interface MailKindCount {
  readonly kind: MailKind;
  readonly count: number;
}

export interface MailStatusCount {
  readonly status: MailStatus;
  readonly count: number;
}

/**
 * One person's emails on the day: an account, or an address no account has (Identity Platform's mail to it, the setup
 * check's to Amazon's simulator).
 */
export interface MailDayPerson {
  readonly accountId: string | null;
  /** The account's name now; null for an address no account has. */
  readonly name: string | null;
  /** The addresses the emails went to, as the records keep them. */
  readonly addresses: readonly string[];
  /** For an account whose emails that day were all sent before addresses were kept: its address now. */
  readonly addressNow: string | null;
  readonly emails: number;
  /** Reached the recipient's mail server (the test outbox's acted-out reports included). */
  readonly delivered: number;
  /** No report yet, or delayed. */
  readonly waiting: number;
  /** Bounced, marked as spam, or not sent after all. */
  readonly problems: number;
  /** What they were, the commonest first. */
  readonly kinds: readonly MailKindCount[];
}

/** `GET /v1/admin/mail/day`. */
export interface MailDayView {
  readonly day: string;
  readonly zone: string;
  readonly start: string;
  readonly end: string;
  /** Every email sent that day, counted by Firestore. */
  readonly emails: number;
  /** The records read for the breakdown below; fewer than `emails` when `MAIL_DAY_SCAN` stopped it. */
  readonly read: number;
  readonly scanLimited: boolean;
  /** How many different addresses the emails read went to (those with no address kept left out). */
  readonly addresses: number;
  readonly byKind: readonly MailKindCount[];
  readonly byStatus: readonly MailStatusCount[];
  /** Those sent the most first, at most `MAIL_DAY_PEOPLE`. */
  readonly people: readonly MailDayPerson[];
  /** How many people there were in all. */
  readonly peopleCount: number;
}

/** The fields of a record the breakdown reads. */
export type MailDayRecord = Pick<MailMessageRecord, 'accountId' | 'to' | 'kind' | 'status'>;

/** One person's tally, before their name is looked up. */
export interface MailDayTally {
  readonly accountId: string | null;
  readonly addresses: readonly string[];
  readonly emails: number;
  readonly delivered: number;
  readonly waiting: number;
  readonly problems: number;
  readonly kinds: readonly MailKindCount[];
}

const DELIVERED: readonly MailStatus[] = ['delivered'];
const WAITING: readonly MailStatus[] = ['sent', 'delayed'];

/**
 * Counts one day's records: by kind, by status, and by person, an account by its ID and an address no account has by the
 * address, those sent the most first (then by account or address, so the order is stable).
 */
export function tallyMailDay(records: readonly MailDayRecord[]): {
  readonly addresses: number;
  readonly byKind: readonly MailKindCount[];
  readonly byStatus: readonly MailStatusCount[];
  readonly people: readonly MailDayTally[];
} {
  const byKind = new Map<MailKind, number>();
  const byStatus = new Map<MailStatus, number>();
  const addresses = new Set<string>();
  const people = new Map<string, { accountId: string | null; addresses: Set<string>; emails: number; delivered: number; waiting: number; problems: number; kinds: Map<MailKind, number> }>();
  for (const r of records) {
    const to = r.to ? r.to.trim().toLowerCase() : null;
    byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    if (to) addresses.add(to);
    const key = r.accountId ? `account:${r.accountId}` : `address:${to ?? ''}`;
    let person = people.get(key);
    if (!person) people.set(key, (person = { accountId: r.accountId, addresses: new Set(), emails: 0, delivered: 0, waiting: 0, problems: 0, kinds: new Map() }));
    if (r.to) person.addresses.add(r.to.trim());
    person.emails++;
    if (DELIVERED.includes(r.status)) person.delivered++;
    else if (WAITING.includes(r.status)) person.waiting++;
    else person.problems++;
    person.kinds.set(r.kind, (person.kinds.get(r.kind) ?? 0) + 1);
  }
  const counts = <K extends string>(map: Map<K, number>) => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const sortKey = (p: { accountId: string | null; addresses: Set<string> }) => p.accountId ?? [...p.addresses][0] ?? '';
  return {
    addresses: addresses.size,
    byKind: counts(byKind).map(([kind, count]) => ({ kind, count })),
    byStatus: counts(byStatus).map(([status, count]) => ({ status, count })),
    people: [...people.values()]
      .sort((a, b) => b.emails - a.emails || sortKey(a).localeCompare(sortKey(b)))
      .map((p) => ({
        accountId: p.accountId,
        addresses: [...p.addresses].sort(),
        emails: p.emails,
        delivered: p.delivered,
        waiting: p.waiting,
        problems: p.problems,
        kinds: counts(p.kinds).map(([kind, count]) => ({ kind, count })),
      })),
  };
}
