import { z } from 'zod';
import { deny, OK, refuse, type Check } from '../check.js';
import { NOTICE_CLAIM_MINUTES } from './notices.js';
import type { MailKind, MailStatus, MailSuppressionReason } from './mail.js';
import { mailStop, type MailPreferenceRecord } from './mail-preferences.js';

/**
 * A member's own email (design §10.12): what was sent to them and what became of it, whether their address can be
 * mailed, and two things they can ask for: a test email, and, after their address bounced or they marked an email as
 * spam, trying the address again. Membership Admins see only whether each member can be emailed, never the messages.
 */

/**
 * - `ok`: a verified address that has not bounced for good or been marked as spam.
 * - `bounced`, `complained`: not mailed until its owner asks to try it again.
 * - `unverified`: the address was never confirmed, so election email skips it.
 * - `no_address`: the account has none.
 * - `unsubscribed`: the member unsubscribed from all email, until they turn it back on.
 * - `email_stopped`: an admin stopped email to them, until an admin restores it.
 */
export const MAIL_ADDRESS_STATES = ['ok', 'bounced', 'complained', 'unverified', 'no_address', 'unsubscribed', 'email_stopped'] as const;
export type MailAddressState = (typeof MAIL_ADDRESS_STATES)[number];

/** `GET /v1/me`: whether the caller's address can be mailed, and since when it cannot. */
export interface MyMailState {
  readonly state: MailAddressState;
  readonly since: string | null;
}

/** The state of an address from the account, its suppression and the member's preference, if any. */
export function mailAddressState(
  account: { readonly primaryEmail: string | null; readonly emailVerified: boolean },
  suppression: { readonly reason: MailSuppressionReason; readonly since: string } | null,
  preference?: Pick<MailPreferenceRecord, 'unsubscribedAt' | 'stoppedAt'> | null,
): MyMailState {
  const stop = mailStop(preference);
  if (stop) return { state: stop, since: stop === 'email_stopped' ? preference!.stoppedAt : preference!.unsubscribedAt };
  if (!account.primaryEmail) return { state: 'no_address', since: null };
  if (suppression) return { state: suppression.reason, since: suppression.since };
  if (!account.emailVerified) return { state: 'unverified', since: null };
  return { state: 'ok', since: null };
}

/** One email sent to the member, as they see it: no message body, no address. */
export interface MyEmailMessage {
  readonly messageId: string;
  readonly kind: MailKind;
  /** The election it was about, if any. */
  readonly electionTitle: string | null;
  readonly status: MailStatus;
  readonly sentAt: string;
  readonly deliveredAt: string | null;
  readonly bouncedAt: string | null;
  readonly complainedAt: string | null;
}

/** The member's emails shown: the last `MY_EMAIL_SHOWN` of the last `MY_EMAIL_DAYS` days. */
export const MY_EMAIL_DAYS = 90;
export const MY_EMAIL_SHOWN = 50;

/**
 * `test`: an email to the member's own address. `retry`: take it off the lists of addresses not to mail, then a test.
 * `admin_test`: a System Admin's test in Admin › Email, to their own address or another System Admin's, which goes even
 * while all email is off.
 */
export const MAIL_REQUEST_KINDS = ['test', 'retry', 'admin_test'] as const;
export type MailRequestKind = (typeof MAIL_REQUEST_KINDS)[number];

/** Why a requested email did not go. */
export const MAIL_REQUEST_OUTCOMES = ['refused', 'unavailable', 'interrupted', 'error', 'undeliverable', 'no_address', 'unsubscribed', 'email_stopped'] as const;
export type MailRequestOutcome = (typeof MAIL_REQUEST_OUTCOMES)[number];

/** `mail_requests/{requestId}`: a member's request, queued by the api for the worker. Kept 30 days. */
export interface MailRequestRecord {
  readonly requestId: string;
  /** Who asked. */
  readonly accountId: string;
  /** A System Admin's test to another System Admin: who it goes to. Absent when it goes to who asked. */
  readonly to?: string | null;
  readonly kind: MailRequestKind;
  readonly requestedAt: string;
  readonly status: 'pending' | 'sending' | 'done';
  readonly claimedAt: string | null;
  readonly doneAt: string | null;
  /** Null when its email was sent; else why not. */
  readonly outcome: MailRequestOutcome | null;
  /** The provider's ID for the test email, once sent, which its delivery reports name. */
  readonly messageId: string | null;
}

/** `GET /v1/me/email`. */
export interface MyEmailView {
  /** The account's primary address, the member's own. */
  readonly address: string | null;
  readonly state: MailAddressState;
  readonly since: string | null;
  /** When they unsubscribed; null while they have not. They can turn email back on. */
  readonly unsubscribedAt: string | null;
  /** When an admin stopped email to them; null while none has. Only an admin can restore it. */
  readonly stoppedAt: string | null;
  /** Newest first. */
  readonly messages: readonly MyEmailMessage[];
  /** Whether they may ask for a test email, or to try their address again, at all: System Admins can switch it off. */
  readonly requestsEnabled: boolean;
  /** The member's requests of the last day, newest first. */
  readonly requests: readonly Pick<MailRequestRecord, 'requestId' | 'kind' | 'requestedAt' | 'status' | 'doneAt' | 'outcome' | 'messageId'>[];
}

/** Each kind of request a member may make this many times a day. */
export const MAIL_REQUESTS_PER_DAY = 3;
/** A System Admin checking a new setup tries more often. */
export const ADMIN_TESTS_PER_DAY = 10;

export const MAIL_REQUEST_RETENTION_DAYS = 30;

/** Queued, or claimed by a worker that may still be sending it. */
export function isMailRequestInFlight(request: Pick<MailRequestRecord, 'status' | 'claimedAt'>, now: Date): boolean {
  if (request.status === 'pending') return true;
  return request.status === 'sending' && !!request.claimedAt && Date.parse(request.claimedAt) > now.getTime() - NOTICE_CLAIM_MINUTES * 60_000;
}

/**
 * Whether the member may ask for this now: one request at a time, a few a day; a test only to an address that can be
 * mailed, and trying again only an address that cannot because it bounced or was marked as spam.
 */
export function checkMailRequest(input: {
  readonly kind: MailRequestKind;
  readonly state: MailAddressState;
  readonly mailing: boolean;
  /** Whether System Admins have members' test emails switched on (Admin › Email); a System Admin's own test always is. */
  readonly enabled: boolean;
  readonly theirs: readonly Pick<MailRequestRecord, 'kind' | 'status' | 'claimedAt' | 'requestedAt'>[];
  readonly now: Date;
}): Check {
  const { kind, state, mailing, theirs, now } = input;
  if (!mailing) return deny('this deployment sends no email');
  if (!input.enabled) return deny('a System Admin has switched these emails off for now');
  // A System Admin's test may be to another System Admin, so it speaks of the account rather than of "you".
  const test = kind === 'admin_test';
  if (state === 'email_stopped') return deny(test ? 'an administrator has stopped email to that account' : 'an administrator has stopped email to you');
  if (state === 'unsubscribed') return deny(test ? 'that account has unsubscribed from email' : 'you have unsubscribed from email; turn it back on first');
  if (state === 'no_address') return deny(test ? 'that account has no email address' : 'your account has no email address');
  if (state === 'unverified') return deny(test ? 'that account’s email address is not confirmed yet' : 'your email address is not confirmed yet');
  if (kind !== 'retry' && (state === 'bounced' || state === 'complained')) {
    return deny(test ? 'that address is not mailed now: it bounced or was marked as spam' : 'your address is not mailed now; ask to try it again instead');
  }
  if (kind === 'retry' && state === 'ok') return deny('your address can be mailed already');
  if (theirs.some((r) => isMailRequestInFlight(r, now))) return deny('your last request has not been done yet; wait for it first');
  const today = theirs.filter((r) => r.kind === kind && Date.parse(r.requestedAt) > now.getTime() - 86_400_000).length;
  const limit = kind === 'admin_test' ? ADMIN_TESTS_PER_DAY : MAIL_REQUESTS_PER_DAY;
  if (today >= limit) return refuse('rate_limited', `you have asked for this ${limit} times in the last day`);
  return OK;
}

/** `POST /v1/admin/mail/test`: which System Admin it goes to; the caller when left out. */
export const adminTestSchema = z.strictObject({ to: z.string().min(1).max(64).optional() }).optional();
export type AdminTestInput = z.infer<typeof adminTestSchema>;

/** `GET /v1/admin/mail/test`: who a System Admin's test can go to, and how their last one went. */
export interface AdminTestView {
  /** Those who hold the role now, the caller first. */
  readonly systemAdmins: readonly { readonly accountId: string; readonly name: string; readonly email: string | null }[];
  readonly last: {
    readonly toName: string | null;
    readonly status: MailRequestRecord['status'];
    readonly outcome: MailRequestOutcome | null;
    readonly doneAt: string | null;
    /** What the mail service reported of it, once it took it. */
    readonly delivery: MailStatus | null;
  } | null;
}

/** `GET /v1/admin/mail/members`: a member who cannot be emailed, and why. */
export interface MemberMailFlag {
  readonly accountId: string;
  readonly state: Exclude<MailAddressState, 'ok'>;
  readonly since: string | null;
}
