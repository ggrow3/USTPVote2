import { deny, OK, refuse, type Check } from '../check.js';
import type { MailStatus } from './mail.js';
import { NOTICE_CLAIM_MINUTES, NOTICE_KINDS, type NoticeDelivery, type NoticeKind, type NoticeOutcome } from './notices.js';

/**
 * Send receipts and test emails (design §6.8). Each time the worker sends election email, a pass over a notice's
 * recipients or one test, it keeps a receipt: what went, who started it, how many the mail service took or refused,
 * and the service's message IDs. Never an address or a message body. An Election Admin can also have one email sent
 * to themselves alone, marked as a test, to see it in their own inbox; the api queues it and the worker sends it.
 */

/** `notice_receipts/{receiptId}`: one send, written once by the worker after it, never changed. */
export interface NoticeReceiptRecord {
  readonly receiptId: string;
  readonly electionId: string;
  readonly kind: NoticeKind;
  /** A test email to the Election Admin who asked for it, not to the roll. */
  readonly test: boolean;
  /** The notice and round this pass sent; null for a test. */
  readonly noticeId: string | null;
  readonly round: number | null;
  readonly delivery: NoticeDelivery;
  /**
   * Who started it: `system` for a notice's first round (the worker, when voting opened or the reminder fell due), else
   * the account that asked: the Election Admin who resent it, or who asked for the test.
   */
  readonly triggeredBy: string;
  /** For a test, the account it went to: the signed-in person who asked, also when they acted as a persona. */
  readonly recipientAccountId: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** The people this send handled: `accepted + failed + skipped`. */
  readonly recipients: number;
  /** Messages the mail service (or the outbox) took. */
  readonly accepted: number;
  /** Messages it did not take: refused, unavailable (even when tried again later), or an error. */
  readonly failed: number;
  /** People with nowhere to send it (no verified address), or who voted before their reminder went. */
  readonly skipped: number;
  /** The mail service's ID for each message it took, which its delivery reports name. */
  readonly messageIds: readonly string[];
}

/**
 * `pending`: queued by the api. `sending`: claimed by the worker. `done`: sent or not, with a receipt (`receiptId`)
 * and, if it did not go, why (`outcome`).
 */
export const NOTICE_TEST_STATUSES = ['pending', 'sending', 'done'] as const;
export type NoticeTestStatus = (typeof NOTICE_TEST_STATUSES)[number];

/** `notice_tests/{testId}`: an Election Admin's request for a test email to themselves. Deleted with its election. */
export interface NoticeTestRecord {
  readonly testId: string;
  readonly electionId: string;
  readonly kind: NoticeKind;
  /** The account that asked: the persona, when a System Admin acts as one (design §10.4). */
  readonly requestedBy: string;
  /**
   * Whose address it goes to: always the signed-in person who asked (the System Admin, not the persona they act
   * as). The worker reads the address from that account when it sends; the request names no address.
   */
  readonly accountId: string;
  readonly requestedAt: string;
  readonly status: NoticeTestStatus;
  readonly claimedAt: string | null;
  /** When the worker finished it; null until then. */
  readonly doneAt: string | null;
  /** Null when it was sent; else why not, as for a roll member's notice. */
  readonly outcome: NoticeOutcome | null;
  readonly receiptId: string | null;
  /** What the mail service has reported of it since it took it (design §6.8); null until a report, absent on older tests. */
  readonly delivery?: MailStatus | null;
}

/** An Election Admin may ask for this many test emails of an election a day; one at a time. */
export const MAX_NOTICE_TESTS_PER_DAY = 10;

/** Marks a test email, at the start of its subject. */
export const TEST_SUBJECT_PREFIX = '[TEST] ';

/** What was sent of one email of an election, from its receipts: to the roll, or as tests. */
export interface NoticeSendTotals {
  readonly kind: NoticeKind;
  /** Receipts: the sends it took. */
  readonly sends: number;
  readonly accepted: number;
  readonly failed: number;
  readonly skipped: number;
  /** When the last send finished; null when there has been none. */
  readonly lastSentAt: string | null;
}

/** `GET /v1/admin/elections/{id}/notices`, `receipts`: what the election's receipts add up to, per email. */
export interface NoticeReceiptTotals {
  /** Sent to the roll, one entry per email in `NOTICE_KINDS` order. */
  readonly roll: readonly NoticeSendTotals[];
  /** Test emails to Election Admins, counted apart: they never reach the roll. */
  readonly tests: readonly NoticeSendTotals[];
}

/** One of the caller's own test emails of the election, newest first. */
export interface NoticeTestSummary {
  readonly testId: string;
  readonly kind: NoticeKind;
  readonly status: NoticeTestStatus;
  readonly requestedAt: string;
  readonly claimedAt: string | null;
  readonly doneAt: string | null;
  /** Null once sent; else why it was not. */
  readonly outcome: NoticeOutcome | null;
  /** Whether the mail service took it: `done` with no outcome. */
  readonly sent: boolean;
  /** What the mail service has reported of it since: delivered, bounced, marked as spam; null with no report yet. */
  readonly delivery: MailStatus | null;
}

/** How one message of a send went: the mail service's ID for it, or why it did not go. */
export type SendResult =
  | { readonly status: 'sent'; readonly messageId: string }
  | { readonly status: 'failed' | 'skipped'; readonly outcome: NoticeOutcome };

/**
 * The receipt of one send, from how each of its messages went; null when it handled nobody, so a pass that found
 * nothing to send leaves no receipt. A message the service could not take yet (`unavailable`) counts as failed here,
 * even when a later pass sends it: each receipt says what that send did.
 */
export function noticeReceipt(input: {
  readonly receiptId: string;
  readonly electionId: string;
  readonly kind: NoticeKind;
  readonly test: boolean;
  readonly noticeId: string | null;
  readonly round: number | null;
  readonly delivery: NoticeDelivery;
  readonly triggeredBy: string;
  readonly recipientAccountId: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly results: readonly SendResult[];
}): NoticeReceiptRecord | null {
  const { results, ...rest } = input;
  if (!results.length) return null;
  const messageIds = results.flatMap((r) => (r.status === 'sent' ? [r.messageId] : []));
  return {
    ...rest,
    recipients: results.length,
    accepted: messageIds.length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    messageIds,
  };
}

/** The receipt fields the totals need, so the server can leave the message IDs unread. */
export type ReceiptCounts = Pick<NoticeReceiptRecord, 'kind' | 'test' | 'accepted' | 'failed' | 'skipped' | 'finishedAt'>;

/** Adds an election's receipts up per email, the roll's apart from the tests. */
export function noticeReceiptTotals(receipts: readonly ReceiptCounts[]): NoticeReceiptTotals {
  const totals = (test: boolean) =>
    NOTICE_KINDS.map((kind): NoticeSendTotals => {
      const mine = receipts.filter((r) => r.kind === kind && r.test === test);
      const sum = (field: 'accepted' | 'failed' | 'skipped') => mine.reduce((n, r) => n + r[field], 0);
      const last = mine.reduce<string | null>((at, r) => (at === null || r.finishedAt > at ? r.finishedAt : at), null);
      return { kind, sends: mine.length, accepted: sum('accepted'), failed: sum('failed'), skipped: sum('skipped'), lastSentAt: last };
    });
  return { roll: totals(false), tests: totals(true) };
}

/** A test request still on its way: queued, or claimed by a worker that has not been interrupted. */
export function isTestInFlight(test: Pick<NoticeTestRecord, 'status' | 'claimedAt'>, now: Date): boolean {
  if (test.status === 'pending') return true;
  return test.status === 'sending' && !!test.claimedAt && Date.parse(test.claimedAt) > now.getTime() - NOTICE_CLAIM_MINUTES * 60_000;
}

export function noticeTestSummary(test: NoticeTestRecord): NoticeTestSummary {
  const { testId, kind, status, requestedAt, claimedAt, doneAt, outcome } = test;
  const sent = status === 'done' && outcome === null;
  return { testId, kind, status, requestedAt, claimedAt, doneAt, outcome, sent, delivery: sent ? (test.delivery ?? null) : null };
}

/**
 * Whether the caller may have a test email sent to themselves: only where the deployment mails (or records in the
 * outbox) and the emails have a contact for questions, as for the real ones; one at a time, and at most
 * `MAX_NOTICE_TESTS_PER_DAY` of the election a day. `theirs` are the caller's earlier test requests of the election.
 */
export function checkNoticeTest(input: {
  readonly delivery: NoticeDelivery | 'none';
  readonly contact: string | null;
  readonly theirs: readonly Pick<NoticeTestRecord, 'status' | 'claimedAt' | 'requestedAt'>[];
  readonly now: Date;
}): Check {
  const { delivery, contact, theirs, now } = input;
  if (delivery === 'none') return deny('this deployment sends no email (MAIL_TRANSPORT=off), so there is nothing to test');
  if (delivery === 'mail' && !contact) {
    return deny('no contact for election questions is set (Admin › Email), and no email goes without one');
  }
  if (theirs.some((t) => isTestInFlight(t, now))) return deny('your last test email has not gone yet; wait for it first');
  const today = theirs.filter((t) => Date.parse(t.requestedAt) > now.getTime() - 86_400_000).length;
  if (today >= MAX_NOTICE_TESTS_PER_DAY) {
    return refuse('rate_limited', `you have asked for ${MAX_NOTICE_TESTS_PER_DAY} test emails of this election in the last day`);
  }
  return OK;
}

/**
 * The test request for a caller. The address is never theirs to choose: it goes to the account of the signed-in person
 * (`operator` when a System Admin acts as a persona), read by the worker when it sends.
 */
export function noticeTestRecord(input: {
  readonly testId: string;
  readonly electionId: string;
  readonly kind: NoticeKind;
  readonly caller: { readonly accountId: string; readonly operator: string | null };
  readonly now: Date;
}): NoticeTestRecord {
  const { testId, electionId, kind, caller, now } = input;
  return {
    testId,
    electionId,
    kind,
    requestedBy: caller.accountId,
    accountId: caller.operator ?? caller.accountId,
    requestedAt: now.toISOString(),
    status: 'pending',
    claimedAt: null,
    doneAt: null,
    outcome: null,
    receiptId: null,
    delivery: null,
  };
}
