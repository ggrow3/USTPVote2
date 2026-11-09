import { z } from 'zod';
import { MAIL_KINDS, MAIL_STATUSES, type BounceType, type MailKind, type MailMessageRecord, type MailSender, type MailStatus } from './mail.js';
import type { NoticeDelivery } from './notices.js';

/**
 * The email log (design §10.12): every email the site sent, for System Admins in Admin › Email. It is the records the
 * worker already keeps of each message the mail service took (`mail_messages`, §6.8), the app's own and Identity
 * Platform's, read with whom each went to, who caused it and what its delivery reports said. Metadata only, the party's
 * decision (2026-11-08): no record holds an address, a subject or a body; a group email's words stay in its own record.
 * Kept 180 days, as the records are.
 */

/** Rows a page of the log holds. */
export const MAIL_LOG_PAGE = 50;

/** At most this many records are read for one page, so a filter that matches little never reads the whole log. */
export const MAIL_LOG_SCAN = 1_000;

/** `system`: the worker sent it by itself (a notice's first round, a vote confirmation, the setup check). */
export const MAIL_CAUSED_BY_SYSTEM = 'system';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date, YYYY-MM-DD');

/** `GET /v1/admin/mail/log`: each filter narrows the log; all are optional. */
export const mailLogQuerySchema = z
  .strictObject({
    /** Whom it went to. */
    account: z.string().trim().min(1).max(64).optional(),
    /** Who caused it: an account, or `system`. */
    causedBy: z.string().trim().min(1).max(64).optional(),
    kind: z.enum(MAIL_KINDS).optional(),
    status: z.enum(MAIL_STATUSES).optional(),
    /** Sent on or after this day, and on or before that one (UTC). */
    from: day.optional(),
    to: day.optional(),
    /** Where the last page stopped (`next` from it). */
    after: z.string().max(200).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'the first day comes after the last', path: ['from'] });
export type MailLogQuery = z.infer<typeof mailLogQuerySchema>;

/** One email in the log. Names are the accounts' as they are now; the address shown is the account's address now. */
export interface MailLogRow {
  readonly messageId: string;
  readonly kind: MailKind;
  readonly sender: MailSender;
  /** A welcome sign-in link the admin's browser says Identity Platform took, which no report reaches (`MailMessageRecord.handOff`). */
  readonly handOff: boolean;
  readonly delivery: NoticeDelivery;
  readonly status: MailStatus;
  readonly sentAt: string;
  /** When it reached the recipient's mail server, bounced, or was marked as spam. */
  readonly deliveredAt: string | null;
  readonly bouncedAt: string | null;
  readonly complainedAt: string | null;
  readonly bounce: { readonly type: BounceType; readonly subType: string } | null;
  /** Whom it went to; null for the setup check's messages, which go to Amazon's simulator, and for an address no account has. */
  readonly accountId: string | null;
  readonly accountName: string | null;
  readonly accountEmail: string | null;
  /** Who caused it (`MailMessageRecord.causedBy`), and their name now. */
  readonly causedBy: string | null;
  readonly causedByName: string | null;
  /** What it belongs to: a notice, a test, a group email (`broadcast`), an added member. */
  readonly ref: string | null;
  readonly electionId: string | null;
  readonly electionTitle: string | null;
}

/** `GET /v1/admin/mail/log`: newest first. */
export interface MailLogPage {
  readonly rows: readonly MailLogRow[];
  /** Pass as `after` for the next page; null at the end of the log. */
  readonly next: string | null;
  /** True when the page stopped at `MAIL_LOG_SCAN` records read: more may match further back. */
  readonly scanLimited: boolean;
}

/** The one field the log is read by in Firestore; the other filters are applied to what it returns. */
export type MailLogIndex = 'accountId' | 'causedBy' | 'kind' | 'status' | null;

/** Which filter to read by: the most selective one given, so as few records as possible are read. */
export function mailLogIndex(query: Pick<MailLogQuery, 'account' | 'causedBy' | 'kind' | 'status'>): MailLogIndex {
  if (query.account) return 'accountId';
  if (query.causedBy) return 'causedBy';
  if (query.kind) return 'kind';
  if (query.status) return 'status';
  return null;
}

/** Whether a record passes every filter of the query (those not read by in Firestore included). */
export function matchesMailLog(record: MailMessageRecord, query: MailLogQuery): boolean {
  if (query.account && record.accountId !== query.account) return false;
  if (query.causedBy && (record.causedBy ?? null) !== query.causedBy) return false;
  if (query.kind && record.kind !== query.kind) return false;
  if (query.status && record.status !== query.status) return false;
  const [from, to] = mailLogBounds(query);
  if (from && record.sentAt < from) return false;
  if (to && record.sentAt >= to) return false;
  return true;
}

/** The query's days as times: from the start of `from`, up to (not including) the day after `to`. */
export function mailLogBounds(query: Pick<MailLogQuery, 'from' | 'to'>): [string | null, string | null] {
  const from = query.from ? `${query.from}T00:00:00.000Z` : null;
  const to = query.to ? new Date(Date.parse(`${query.to}T00:00:00.000Z`) + 86_400_000).toISOString() : null;
  return [from, to];
}

/** Where a page stopped, as `after`: the last record read, by time and then ID, the order the log is read in. */
export function mailLogCursor(record: Pick<MailMessageRecord, 'sentAt' | 'messageId'>): string {
  return `${record.sentAt}|${record.messageId}`;
}

export function parseMailLogCursor(after: string): { readonly sentAt: string; readonly messageId: string } | null {
  const bar = after.indexOf('|');
  if (bar < 1) return null;
  const sentAt = after.slice(0, bar);
  const messageId = after.slice(bar + 1);
  return Number.isNaN(Date.parse(sentAt)) || !messageId ? null : { sentAt, messageId };
}
