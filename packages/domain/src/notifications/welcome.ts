import type { MailStatus } from './mail.js';
import { NOTICE_CLAIM_MINUTES } from './notices.js';

/**
 * The welcome email a member a Membership Admin added gets (design §5.13), where the deployment sends mail: the worker
 * sends it through the same transport as election notices, once per request, to the address the admin entered. Where
 * no mail is sent, the admin's browser asks Identity Platform to send its sign-in link instead, then tells the api,
 * which records it here (`welcomeLinkSent`) and in the email log.
 */

export const WELCOME_STATUSES = ['pending', 'sending', 'done'] as const;
export type WelcomeStatus = (typeof WELCOME_STATUSES)[number];

/**
 * Why a welcome email did not go: as for a notice (`undeliverable`: the address bounced for good or was marked as spam),
 * or the member had already signed in.
 */
export const WELCOME_OUTCOMES = ['refused', 'unavailable', 'interrupted', 'error', 'no_address', 'undeliverable', 'signed_in', 'unsubscribed', 'email_stopped'] as const;
export type WelcomeOutcome = (typeof WELCOME_OUTCOMES)[number];

/** `welcome_emails/{accountId}`: the latest welcome email asked for an added member; asking again starts it over. */
export interface WelcomeEmailRecord {
  readonly accountId: string;
  /** The Membership Admin who added the member, or asked again. */
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly status: WelcomeStatus;
  readonly claimedAt: string | null;
  readonly doneAt: string | null;
  /** Null when it was sent; else why not. */
  readonly outcome: WelcomeOutcome | null;
  /** The provider's ID for the message, once sent. */
  readonly messageId: string | null;
  /** What the provider has reported of it since it took it (design §6.8); null until a report, absent on older records. */
  readonly delivery?: MailStatus | null;
  /**
   * How it went: the site's own email (`mail`, also when absent), or Identity Platform's sign-in link, which the admin's
   * browser asked for and said was taken (`identity_platform`). Its `messageId` is then its record in the email log.
   */
  readonly via?: WelcomeVia;
}

export type WelcomeVia = 'mail' | 'identity_platform';

/** A welcome email waiting for the worker. */
export function welcomeEmailRecord(accountId: string, requestedBy: string, at: string): WelcomeEmailRecord {
  return { accountId, requestedBy, requestedAt: at, status: 'pending', claimedAt: null, doneAt: null, outcome: null, messageId: null, delivery: null };
}

/** A welcome sign-in link the admin's browser says Identity Platform took: done when recorded. */
export function welcomeLinkSent(input: {
  readonly accountId: string;
  readonly requestedBy: string;
  readonly at: string;
  /** Its record in the email log. */
  readonly messageId: string;
  /** What its reports said, when it was matched to Identity Platform's report of it. */
  readonly delivery: MailStatus | null;
}): WelcomeEmailRecord {
  const { accountId, requestedBy, at, messageId, delivery } = input;
  return { accountId, requestedBy, requestedAt: at, status: 'done', claimedAt: null, doneAt: at, outcome: null, messageId, delivery, via: 'identity_platform' };
}

/** Waiting, or claimed by a worker that may still be sending it: asking again now could send two. */
export function isWelcomeInFlight(record: Pick<WelcomeEmailRecord, 'status' | 'claimedAt'>, now: Date): boolean {
  if (record.status === 'pending') return true;
  return record.status === 'sending' && !!record.claimedAt && Date.parse(record.claimedAt) > now.getTime() - NOTICE_CLAIM_MINUTES * 60_000;
}

/** The page where an added member sets their password, and where the welcome emails lead. */
export const SET_PASSWORD_PATH = '/set-password';
