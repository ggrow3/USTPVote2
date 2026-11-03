import type { MailStatus } from './mail.js';
import { NOTICE_CLAIM_MINUTES } from './notices.js';

/**
 * The welcome email a member a Membership Admin added gets (design §5.13), where the deployment sends mail: the worker
 * sends it through the same transport as election notices, once per request, to the address the admin entered. Where
 * no mail is sent, the admin's browser asks Identity Platform to send its sign-in link instead, and nothing is stored.
 */

export const WELCOME_STATUSES = ['pending', 'sending', 'done'] as const;
export type WelcomeStatus = (typeof WELCOME_STATUSES)[number];

/**
 * Why a welcome email did not go: as for a notice (`undeliverable`: the address bounced for good or was marked as spam),
 * or the member had already signed in.
 */
export const WELCOME_OUTCOMES = ['refused', 'unavailable', 'interrupted', 'error', 'no_address', 'undeliverable', 'signed_in'] as const;
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
}

/** A welcome email waiting for the worker. */
export function welcomeEmailRecord(accountId: string, requestedBy: string, at: string): WelcomeEmailRecord {
  return { accountId, requestedBy, requestedAt: at, status: 'pending', claimedAt: null, doneAt: null, outcome: null, messageId: null, delivery: null };
}

/** Waiting, or claimed by a worker that may still be sending it: asking again now could send two. */
export function isWelcomeInFlight(record: Pick<WelcomeEmailRecord, 'status' | 'claimedAt'>, now: Date): boolean {
  if (record.status === 'pending') return true;
  return record.status === 'sending' && !!record.claimedAt && Date.parse(record.claimedAt) > now.getTime() - NOTICE_CLAIM_MINUTES * 60_000;
}

/** The page where an added member sets their password, and where the welcome emails lead. */
export const SET_PASSWORD_PATH = '/set-password';
