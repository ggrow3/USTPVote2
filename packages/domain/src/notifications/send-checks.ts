import type { MailCheckId, MailHealthRecord } from './mail-health.js';
import { MAIL_CHECK_INTERVAL_MINUTES } from './mail-health.js';
import type { MailStatus } from './mail.js';
import { NOTICE_KINDS, type NoticeKind } from './notices.js';

/**
 * Each send of election email checked before and after (design §6.8). Before: it goes only on an email setup check
 * (§10.12) from the last hour in which nothing that keeps mail from arriving, or from being verified, is failing;
 * otherwise it is held, and the System Admins are alerted. After: 30 minutes after the send finished, the delivery
 * reports of its messages are added up, and a send whose messages did not all reach their mail servers is a warning,
 * on the election's email card and to the System Admins.
 */

/** Checks whose failure does not hold election email: how mail did over 30 days, and Identity Platform's own mail. */
export const NOT_SEND_BLOCKING: readonly MailCheckId[] = ['bounce_rate', 'complaint_rate', 'identity_platform'];

/** How old a setup check may be for a send of election email to rely on it. */
export const SEND_CHECK_MINUTES = MAIL_CHECK_INTERVAL_MINUTES;

/** How long after a send finished its delivery reports are added up. */
export const SEND_VERIFY_MINUTES = 30;

/** Whether a send may go: `stale` asks for a fresh setup check first; `failing` are the checks that hold it. */
export interface SendGate {
  readonly stale: boolean;
  readonly failing: readonly MailCheckId[];
}

/**
 * Whether a send of election email may go now. Mailed through SES (`mail`), it needs a setup check from the last hour,
 * and holds while any check but those in `NOT_SEND_BLOCKING` fails. Recorded in the outbox, there is no SES to check,
 * so only a recent failing check holds it, and the contact for questions, which outbox mail does not need, never does.
 */
export function sendGate(health: Pick<MailHealthRecord, 'checkedAt' | 'checks'> | null, now: Date, mail: boolean): SendGate {
  const fresh = !!health && Date.parse(health.checkedAt) > now.getTime() - SEND_CHECK_MINUTES * 60_000;
  if (!fresh) return { stale: mail, failing: [] };
  const failing = health.checks
    .filter((c) => c.status === 'fail' && !NOT_SEND_BLOCKING.includes(c.id) && (mail || c.id !== 'contact'))
    .map((c) => c.id);
  return { stale: false, failing };
}

/** Why a notice is held: the failing checks, and since when. */
export interface NoticeHold {
  readonly checks: readonly MailCheckId[];
  readonly since: string;
}

/**
 * `notice_verifications/{receiptId}`: one send of a notice to the roll, checked `SEND_VERIFY_MINUTES` after it
 * finished: `pending` until then, then `ok` when every message reached its mail server (delivered, or delivered and
 * marked as spam), else `short`. Counts only, never who. Deleted with its election.
 */
export interface SendVerificationRecord {
  readonly receiptId: string;
  readonly electionId: string;
  readonly kind: NoticeKind;
  readonly noticeId: string;
  readonly round: number;
  readonly finishedAt: string;
  readonly dueAt: string;
  readonly status: 'pending' | 'ok' | 'short';
  readonly checkedAt: string | null;
  /** Messages the mail service took in the send. */
  readonly messages: number;
  readonly delivered: number;
  readonly complained: number;
  /** Not confirmed to have reached a mail server: still delayed, bounced, rejected, or no report at all. */
  readonly delayed: number;
  readonly bounced: number;
  readonly rejected: number;
  readonly noReport: number;
}

/** The record of a send to check later. */
export function pendingVerification(input: {
  readonly receiptId: string;
  readonly electionId: string;
  readonly kind: NoticeKind;
  readonly noticeId: string;
  readonly round: number;
  readonly finishedAt: string;
  readonly messages: number;
}): SendVerificationRecord {
  const dueAt = new Date(Date.parse(input.finishedAt) + SEND_VERIFY_MINUTES * 60_000).toISOString();
  return { ...input, dueAt, status: 'pending', checkedAt: null, delivered: 0, complained: 0, delayed: 0, bounced: 0, rejected: 0, noReport: 0 };
}

/** Messages of a checked send not confirmed to have reached a mail server. */
export function shortOf(v: Pick<SendVerificationRecord, 'delayed' | 'bounced' | 'rejected' | 'noReport'>): number {
  return v.delayed + v.bounced + v.rejected + v.noReport;
}

/** Adds up a send's delivery reports: each message's status, or null for one with no record. */
export function verifySend(pending: SendVerificationRecord, statuses: readonly (MailStatus | null)[], now: Date): SendVerificationRecord {
  const count = (...s: (MailStatus | null)[]) => statuses.filter((x) => s.includes(x)).length;
  const counts = {
    messages: statuses.length,
    delivered: count('delivered'),
    complained: count('complained'),
    delayed: count('delayed'),
    bounced: count('bounced'),
    rejected: count('rejected'),
    noReport: count('sent', null),
  };
  return { ...pending, ...counts, status: shortOf(counts) > 0 ? 'short' : 'ok', checkedAt: now.toISOString() };
}

/** What the checks of an email's sends to the roll add up to, for the election's email card. */
export interface NoticeVerificationTotals {
  readonly kind: NoticeKind;
  /** Sends checked, and those still waiting for their 30 minutes. */
  readonly checked: number;
  readonly pending: number;
  /** Checked sends with messages not confirmed delivered. */
  readonly shortSends: number;
  readonly messages: number;
  readonly delivered: number;
  readonly delayed: number;
  readonly bounced: number;
  readonly rejected: number;
  readonly noReport: number;
  /** When the last check was made; null before the first. */
  readonly lastCheckedAt: string | null;
}

export function noticeVerificationTotals(records: readonly SendVerificationRecord[]): NoticeVerificationTotals[] {
  return NOTICE_KINDS.map((kind) => {
    const mine = records.filter((r) => r.kind === kind);
    const checked = mine.filter((r) => r.status !== 'pending');
    const sum = (field: 'messages' | 'delivered' | 'complained' | 'delayed' | 'bounced' | 'rejected' | 'noReport') =>
      checked.reduce((n, r) => n + r[field], 0);
    return {
      kind,
      checked: checked.length,
      pending: mine.length - checked.length,
      shortSends: checked.filter((r) => r.status === 'short').length,
      messages: sum('messages'),
      delivered: sum('delivered') + sum('complained'),
      delayed: sum('delayed'),
      bounced: sum('bounced'),
      rejected: sum('rejected'),
      noReport: sum('noReport'),
      lastCheckedAt: checked.reduce<string | null>((at, r) => (at === null || r.checkedAt! > at ? r.checkedAt : at), null),
    };
  });
}
