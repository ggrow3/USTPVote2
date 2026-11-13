import { z } from 'zod';

/**
 * Who gets none of the site's email (design §10.12): a member who unsubscribed, by the link in any email or on their
 * Account page, and a member a Membership or System Admin stopped email to. Either way the worker sends them nothing:
 * no election notice, reminder, vote confirmation, welcome or test email. Only the emails a member asks Identity Platform
 * for themselves (a sign-in link, a password reset, confirming their address) still go, since without them they could not
 * sign in. Only the member can undo their unsubscribing, and only an admin their stop.
 */

/** The web page the link in an email opens. The token is in the query, since page visits record the path (§10.7). */
export const UNSUBSCRIBE_PATH = '/unsubscribe';

/** 32 random bytes, base64url: what a link holds in place of the account. */
const UNSUBSCRIBE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function isUnsubscribeToken(value: unknown): value is string {
  return typeof value === 'string' && UNSUBSCRIBE_TOKEN.test(value);
}

/**
 * `mail_preferences/{accountId}`: made the first time an email goes to the account, or it unsubscribes or is stopped. The
 * token is the link's secret: anyone holding it can unsubscribe that account, and nothing else, so it says whose it is
 * to nobody and clients never read this collection.
 */
export interface MailPreferenceRecord {
  readonly accountId: string;
  readonly token: string;
  /** When the member unsubscribed; null while they have not. */
  readonly unsubscribedAt: string | null;
  /** When an admin stopped email to them; null while none has. */
  readonly stoppedAt: string | null;
  /** The admin's account. */
  readonly stoppedBy: string | null;
}

/** Why an account gets no email. An admin's stop comes first, since the member cannot undo it. */
export type MailStop = 'email_stopped' | 'unsubscribed';

export function mailStop(preference: Pick<MailPreferenceRecord, 'unsubscribedAt' | 'stoppedAt'> | null | undefined): MailStop | null {
  if (preference?.stoppedAt) return 'email_stopped';
  return preference?.unsubscribedAt ? 'unsubscribed' : null;
}

/** Where an email's unsubscribe links go: the page in its text, and the address in its `List-Unsubscribe` header. */
export interface UnsubscribeLinks {
  /** Opens a page with an Unsubscribe button. Opening it changes nothing, since mail scanners open links by themselves. */
  readonly page: string;
  /** A POST here unsubscribes at once (RFC 8058, the button mail clients show); a GET goes to the page. */
  readonly oneClick: string;
}

export function unsubscribeLinks(origin: string, token: string): UnsubscribeLinks {
  return {
    page: `${origin}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`,
    oneClick: `${origin}/v1/public/unsubscribe/${encodeURIComponent(token)}`,
  };
}

/** `GET` and `POST /v1/public/unsubscribe/{token}/…`: all a link's holder learns. Never whose it is. */
export interface UnsubscribeStatus {
  readonly unsubscribed: boolean;
  /** The link is a newsletter subscriber's (design §10.15), not a member's: unsubscribing deletes the address. */
  readonly newsletter?: boolean;
}

/** `GET /v1/admin/mail/stops`: a member who gets no email, and why. */
export interface MailStopRow {
  readonly accountId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly unsubscribedAt: string | null;
  readonly stoppedAt: string | null;
  /** The admin's name. */
  readonly stoppedBy: string | null;
}

const reason = z.string().trim().min(1, 'a written reason is required').max(2000);

/** `POST /v1/admin/mail/stops`: stop email to the account with this address or ID, with a written reason. */
export const mailStopSchema = z
  .strictObject({
    email: z.string().trim().min(1).max(254).optional(),
    accountId: z.string().min(1).max(64).optional(),
    reason,
  })
  .refine((v) => !!v.email !== !!v.accountId, 'give the member’s email address');
export type MailStopInput = z.infer<typeof mailStopSchema>;

/** `POST /v1/admin/mail/stops/{accountId}/restore`. */
export const mailRestoreSchema = z.strictObject({ reason });
export type MailRestoreInput = z.infer<typeof mailRestoreSchema>;

/** `member.email_stopped`: whether an admin stopped email to the member (the entry's subject) or restored it, and why. */
export interface MemberEmailStoppedPayload {
  readonly stopped: boolean;
  readonly reason: string;
}
