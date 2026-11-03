import { deny, OK, refuse, type Check } from '../check.js';
import type { ElectionRecord } from '../elections.js';
import type { NoticeSettings } from './notice-settings.js';
import type { MailCheckStatus } from './mail-health.js';
import type { NoticeHold, NoticeVerificationTotals } from './send-checks.js';
import type { NoticeReceiptTotals, NoticeTestSummary } from './receipts.js';

/**
 * Election notices (design §6.8): the emails telling everyone on an election's roll that voting is open, a day before
 * it closes reminding those who have not voted, and telling each voter their ballot was recorded. The worker sends each once per voter per election and keeps
 * one record per recipient, without the address, which it reads from the account only when sending. Official election
 * notices, not marketing: they go out whatever the member's newsletter and announcement choices.
 */

/**
 * `voting_open`: everyone on the roll, at opening. `closing_soon`: those who have not voted, a day before the close.
 * `voted`: each voter, soon after their ballot was cast, that it was recorded (and when, never how).
 */
export const NOTICE_KINDS = ['voting_open', 'closing_soon', 'voted'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/**
 * The reminder goes this long before voting closes, and only where voting is open longer than that, unless a System
 * Admin sets another lead time (`NoticeSettings.reminderHours`).
 */
export const REMINDER_HOURS_BEFORE_CLOSE = 24;

/**
 * `mail`: through the mail provider. `outbox`: recorded in `notice_outbox`, never mailed: the mail stand-in with the
 * emulators, and a rehearsal's notice in testing mode, since test voters have no address.
 */
export type NoticeDelivery = 'mail' | 'outbox';

/**
 * - `pending`: to be sent in the current round (also after a send the provider could not take yet, until
 *   `MAX_SEND_ATTEMPTS`).
 * - `sending`: a worker has claimed it and is sending it now.
 * - `sent`: the provider (or the outbox) accepted it, and has not reported on it since.
 * - `delivered`: the provider reported that the recipient's mail server took it.
 * - `complained`: delivered, and the recipient marked it as spam.
 * - `failed`: not sent; an Election Admin can resend it while voting is open.
 * - `bounced`: accepted, then reported undeliverable by the provider (or rejected by it after all). Not resent: the
 *   address does not work.
 * - `skipped`: never sent, because there is nowhere to send it (see `NoticeOutcome`).
 */
export const RECIPIENT_STATUSES = ['pending', 'sending', 'sent', 'delivered', 'complained', 'failed', 'bounced', 'skipped'] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

/**
 * Why a recipient failed or was skipped, as a code (never the provider's text, which can quote the address).
 * Failures: `refused` (the provider will not take it), `unavailable` (the provider was down for every attempt),
 * `interrupted` (the worker stopped while sending, so whether it went is unknown; never resent automatically, so
 * nobody gets it twice), `error` (anything else, the outcome unknown), `voting_closed` (voting ended before it was
 * sent, so it was not). Skips: `no_address` (the account has no email), `unverified_address`, `undeliverable` (the
 * address bounced for good, or its owner marked an email as spam, and is not mailed until they ask to try again),
 * `voted` (a reminder to someone who voted after it was prepared).
 */
export const NOTICE_OUTCOMES = [
  'refused',
  'unavailable',
  'interrupted',
  'error',
  'voting_closed',
  'no_address',
  'unverified_address',
  'undeliverable',
  'voted',
] as const;
export type NoticeOutcome = (typeof NOTICE_OUTCOMES)[number];

/** Vote confirmations still go this long after voting closed, for ballots cast just before. */
export const VOTED_GRACE_HOURS = 24;

/** Each look for new voters reaches back this far before the last, for ballots whose record committed late. */
export const VOTED_SCAN_OVERLAP_MINUTES = 10;

/** Sends a provider could not take (`unavailable`) are tried this many times per round, a tick apart. */
export const MAX_SEND_ATTEMPTS = 3;

/** A claim older than this was interrupted: the worker gives a send far less than this. */
export const NOTICE_CLAIM_MINUTES = 5;

/** `notices/{noticeId}`: one per election and kind, created by the worker once the election is open. */
export interface NoticeRecord {
  /** `{electionId}_{kind}`, so each election has at most one notice of each kind. */
  readonly noticeId: string;
  readonly electionId: string;
  readonly kind: NoticeKind;
  readonly delivery: NoticeDelivery;
  /** The roll is test voters only (design §10.4). */
  readonly rehearsal: boolean;
  /**
   * One recipient record each: everyone on the roll for `voting_open`; for `closing_soon`, those who had not voted
   * when the reminder was prepared.
   */
  readonly recipients: number;
  /**
   * `preparing` while the worker writes the recipient records, `sending` until every recipient of the round has an
   * outcome, then `done` (ledgered as `notice.sent`).
   */
  readonly status: 'preparing' | 'sending' | 'done';
  /** 1 for the first sending; each resend to the recipients it failed for starts the next round. */
  readonly round: number;
  /** `system` for the first round, else the Election Admin who asked for the resend. */
  readonly roundRequestedBy: string;
  readonly createdAt: string;
  readonly roundStartedAt: string;
  /** When the current round finished; null while it runs. */
  readonly completedAt: string | null;
  /**
   * Set while the notice is held because the email setup check is failing (design §6.8); cleared when it goes on.
   */
  readonly held?: NoticeHold | null;
  /**
   * For vote confirmations: when the worker last looked for voters, so the next look starts a little before it; the
   * notice finishes once a look has been made after voting closed.
   */
  readonly scannedTo?: string;
  /**
   * The last round whose delivery reports were added up and ledgered (`notice.delivery_reported`), `NOTICE_REPORT_HOURS`
   * after it finished; absent until the first.
   */
  readonly reportedRound?: number;
}

/** `notices/{noticeId}/recipients/{accountId}`: one person's notice. No address: the account holds it. */
export interface NoticeRecipientRecord {
  readonly accountId: string;
  readonly status: RecipientStatus;
  /** The round that last tried, or will try, to send it. */
  readonly round: number;
  /** Sends tried in that round. */
  readonly attempts: number;
  /** When a worker claimed it for sending; null when it is not being sent. */
  readonly claimedAt: string | null;
  readonly sentAt: string | null;
  /** The provider's ID for the message, which bounce reports name. */
  readonly messageId: string | null;
  readonly outcome: NoticeOutcome | null;
  readonly updatedAt: string;
}

/** `notice_outbox/{id}`: a message recorded instead of mailed (emulators; rehearsals in testing mode). */
export interface OutboxMessageRecord {
  readonly id: string;
  /** What it is (`MailKind`), and the notice, test email or added member it belongs to. */
  readonly kind: string;
  readonly ref: string | null;
  readonly electionId: string | null;
  readonly accountId: string | null;
  /** Null for a test voter, who has no address. */
  readonly to: string | null;
  readonly from: string;
  readonly replyTo: string | null;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly recordedAt: string;
}

/** Recipients by status; `pending` includes those being sent right now. */
export type RecipientCounts = Readonly<Record<Exclude<RecipientStatus, 'sending'>, number>>;

/**
 * `GET /v1/admin/elections/{id}/notices`: whether the notice went out and how it went, as counts. Never addresses or
 * who it failed for.
 */
export interface NoticeSummary {
  readonly kind: NoticeKind;
  readonly delivery: NoticeDelivery;
  readonly rehearsal: boolean;
  readonly status: NoticeRecord['status'];
  readonly round: number;
  readonly recipients: number;
  readonly counts: RecipientCounts;
  readonly createdAt: string;
  readonly completedAt: string | null;
  /** Why nothing more of it goes for now, when the email setup check is failing; null otherwise. */
  readonly held: NoticeHold | null;
}

/** `GET /v1/admin/elections/{id}/notices`. */
export interface NoticesView {
  /** How this deployment sends notices: `none` when email is off (`MAIL_TRANSPORT=off`). */
  readonly delivery: NoticeDelivery | 'none';
  /**
   * Where the emails tell members to ask questions: the System Admins' setting, else the deployment's
   * `NOTICE_CONTACT`; null when neither is set, and then nothing is mailed.
   */
  readonly contact: string | null;
  /** What System Admins have set about the emails (design §6.8). */
  readonly settings: NoticeSettings;
  readonly notices: readonly NoticeSummary[];
  /** What the election's send receipts add up to, per email: to the roll, and the test emails apart. */
  readonly receipts: NoticeReceiptTotals;
  /** The caller's own test emails of the election, newest first (the last few). */
  readonly tests: readonly NoticeTestSummary[];
  /** How the email setup check's last run went (design §10.12), in a word; null before its first run. */
  readonly setup: MailCheckStatus | null;
  /** What the checks of each email's sends, 30 minutes after each, found (design §6.8). */
  readonly verifications: readonly NoticeVerificationTotals[];
}

/** The `notice.sent` payload: a round finished. Counts only. */
export interface NoticeSentPayload {
  readonly electionId: string;
  readonly kind: NoticeKind;
  readonly round: number;
  readonly delivery: NoticeDelivery;
  readonly recipients: number;
  /** Messages the provider took, whatever it has reported of them since. */
  readonly sent: number;
  readonly failed: number;
  readonly bounced: number;
  readonly skipped: number;
}

/**
 * The `notice.delivery_reported` payload: what the provider's reports said of a round's messages, `NOTICE_REPORT_HOURS`
 * after it finished, since bounces and complaints can come after `notice.sent`. Counts only.
 */
export interface NoticeDeliveryReportedPayload {
  readonly electionId: string;
  readonly kind: NoticeKind;
  readonly round: number;
  readonly recipients: number;
  readonly delivered: number;
  readonly bounced: number;
  readonly complained: number;
  /** Messages the provider took and has said nothing more about. */
  readonly noReport: number;
}

/** The `notice.resend_requested` payload. */
export interface NoticeResendPayload {
  readonly electionId: string;
  readonly kind: NoticeKind;
  readonly round: number;
  /** Recipients it had failed for, whom the new round tries again. */
  readonly failed: number;
}

export function noticeId(electionId: string, kind: NoticeKind): string {
  return `${electionId}_${kind}`;
}

export function isNoticeKind(value: string): value is NoticeKind {
  return (NOTICE_KINDS as readonly string[]).includes(value);
}

export function noticeSummary(notice: NoticeRecord, counts: RecipientCounts): NoticeSummary {
  const { kind, delivery, rehearsal, status, round, recipients, createdAt, completedAt } = notice;
  return { kind, delivery, rehearsal, status, round, recipients, counts, createdAt, completedAt, held: notice.held ?? null };
}

/** Who gets a notice: real members always (where email is set up); a rehearsal's test voters only in testing mode. */
export function noticeDelivery(input: {
  readonly rehearsal: boolean;
  readonly testingMode: boolean;
  readonly transport: NoticeDelivery | 'none';
}): NoticeDelivery | null {
  if (input.rehearsal) return input.testingMode ? 'outbox' : null;
  return input.transport === 'none' ? null : input.transport;
}

/**
 * Whether a worker may claim a recipient for sending in `round`: one still to send, or, in a resend round, one an
 * earlier round failed for. Claiming moves it to `sending` in the same transaction, so two workers never both send.
 */
export function isClaimable(recipient: Pick<NoticeRecipientRecord, 'status' | 'round'>, round: number): boolean {
  return recipient.status === 'pending' || (recipient.status === 'failed' && recipient.round < round);
}

/** A claim the worker never finished: whether the message went is unknown, so it fails rather than risk a second copy. */
export function isStaleClaim(recipient: Pick<NoticeRecipientRecord, 'status' | 'claimedAt'>, now: Date): boolean {
  return (
    recipient.status === 'sending' &&
    (!recipient.claimedAt || Date.parse(recipient.claimedAt) <= now.getTime() - NOTICE_CLAIM_MINUTES * 60_000)
  );
}

/**
 * Whether a vote confirmation may still go: while the election is open or closed, up to `VOTED_GRACE_HOURS` after the
 * close; never for a cancelled election.
 */
export function canConfirmVote(election: Pick<ElectionRecord, 'state' | 'closesAt'>, now: Date): boolean {
  if (election.state !== 'open' && election.state !== 'closed' && election.state !== 'certified') return false;
  return now.getTime() < Date.parse(election.closesAt) + VOTED_GRACE_HOURS * 3_600_000;
}

/** The election is open and its window has not ended: the only time "voting is open" is true. */
export function isVotingOpen(election: Pick<ElectionRecord, 'state' | 'closesAt'>, now: Date): boolean {
  return election.state === 'open' && Date.parse(election.closesAt) > now.getTime();
}

/** When the reminder is due: `hours` (by default a day) before the close. */
export function reminderTime(election: Pick<ElectionRecord, 'closesAt'>, hours: number = REMINDER_HOURS_BEFORE_CLOSE): Date {
  return new Date(Date.parse(election.closesAt) - hours * 3_600_000);
}

/**
 * Whether an election gets a reminder at all: only when voting is open for longer than the lead time, so the reminder
 * never comes with, or before, the notice that voting is open.
 */
export function hasReminder(election: Pick<ElectionRecord, 'opensAt' | 'closesAt'>, hours: number = REMINDER_HOURS_BEFORE_CLOSE): boolean {
  return reminderTime(election, hours).getTime() > Date.parse(election.opensAt);
}

/** Whether the reminder is due now: the election has one, voting is open, and the reminder time has come. */
export function isReminderDue(
  election: Pick<ElectionRecord, 'state' | 'opensAt' | 'closesAt'>,
  now: Date,
  hours: number = REMINDER_HOURS_BEFORE_CLOSE,
): boolean {
  return hasReminder(election, hours) && isVotingOpen(election, now) && now.getTime() >= reminderTime(election, hours).getTime();
}

/**
 * Whether an Election Admin may resend the notice to the recipients it failed for: only while voting is open, once the
 * current round has finished, and when it failed for someone; never a vote confirmation.
 */
export function checkNoticeResend(
  election: Pick<ElectionRecord, 'state' | 'closesAt'>,
  notice: Pick<NoticeRecord, 'status' | 'kind'> | null,
  failed: number,
  now: Date,
): Check {
  if (!notice) return refuse('not_found', 'this election has no notice yet');
  if (notice.kind === 'voted') return deny('each voter is told their ballot was recorded once, and it is never sent again');
  if (!isVotingOpen(election, now)) return deny('voting is not open, so the notice that it is would be wrong');
  if (notice.status !== 'done') return deny('the notice is still being sent; resend once it has finished');
  if (failed === 0) return deny('the notice failed for nobody, so there is nothing to resend');
  return OK;
}
