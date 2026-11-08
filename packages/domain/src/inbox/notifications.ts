import { sha256Hex } from 'ustp-audit';
import { z } from 'zod';
import type { MailAddressState } from '../notifications/my-email.js';

/**
 * In-app notifications (design §10.13): what the bell in the header counts and lists, for any signed-in account. One
 * notification stands for one thing (a conversation, a report): something more about it while it is unread adds to it
 * ("3 new messages"), and after it was read starts it afresh. A member can have them collected by email, as each comes
 * or in a daily or weekly digest; that email goes through the same gate as all the site's email (§10.12), so nothing
 * goes while all email is off, after they unsubscribed, or while an admin has stopped their email.
 */

/** `message`: a member wrote to them (§10.13). `message_report`: for Membership Admins, a member reported a message. */
export const APP_NOTIFICATION_KINDS = ['message', 'message_report'] as const;
export type AppNotificationKind = (typeof APP_NOTIFICATION_KINDS)[number];

/** `app_notifications/{notificationId}`: one account's notification. Kept 90 days after it last changed. */
export interface AppNotificationRecord {
  readonly notificationId: string;
  /** Whose it is. */
  readonly accountId: string;
  readonly kind: AppNotificationKind;
  /** One line of plain text, e.g. "Ada Brooks sent you a message". */
  readonly title: string;
  /** Where it leads in the app: a path, e.g. `/messages/{threadId}`. */
  readonly link: string;
  /** What it is about: a conversation, a report. */
  readonly ref: string;
  /** How many times it happened while unread. */
  readonly count: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly readAt: string | null;
  /** True until the email step has looked at it, for whoever gets each by email (and then false whatever it found). */
  readonly emailPending: boolean;
  /** When it went by email, as it came or in a digest; null while it has not. */
  readonly emailedAt: string | null;
}

export const APP_NOTIFICATION_RETENTION_DAYS = 90;
/** The latest shown in the bell's list and on the Notifications page. */
export const APP_NOTIFICATIONS_SHOWN = 30;
export const MAX_NOTIFICATION_TITLE = 200;

/**
 * One notification per account and thing, so another event about it finds the one there is: a hash, short enough for
 * a path (a conversation's ID alone holds two account IDs).
 */
export function appNotificationId(accountId: string, kind: AppNotificationKind, ref: string): string {
  return sha256Hex(`ustp-notification:${kind}:${ref}:${accountId}`).slice(0, 40);
}

/**
 * The notification after one more event: added to the one there is while it is unread (its email, if any, has gone or
 * is still to go: one email per thing until it is read), else a new one, unread and due by email.
 */
export function nextAppNotification(
  current: AppNotificationRecord | null,
  input: { readonly accountId: string; readonly kind: AppNotificationKind; readonly ref: string; readonly title: string; readonly link: string; readonly at: string },
): AppNotificationRecord {
  const title = oneLine(input.title).slice(0, MAX_NOTIFICATION_TITLE);
  if (current && !current.readAt) return { ...current, title, link: input.link, count: current.count + 1, updatedAt: input.at };
  return {
    notificationId: appNotificationId(input.accountId, input.kind, input.ref),
    accountId: input.accountId,
    kind: input.kind,
    title,
    link: input.link,
    ref: input.ref,
    count: 1,
    createdAt: input.at,
    updatedAt: input.at,
    readAt: null,
    emailPending: true,
    emailedAt: null,
  };
}

function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** As the bell and the Notifications page show it. */
export type AppNotificationView = Pick<AppNotificationRecord, 'notificationId' | 'kind' | 'title' | 'link' | 'count' | 'createdAt' | 'updatedAt' | 'readAt'>;

export function appNotificationView(record: AppNotificationRecord): AppNotificationView {
  const { notificationId, kind, title, link, count, createdAt, updatedAt, readAt } = record;
  return { notificationId, kind, title, link, count, createdAt, updatedAt, readAt };
}

/** `GET /v1/me/notifications`: newest first. */
export interface MyNotificationsView {
  readonly unread: number;
  readonly notifications: readonly AppNotificationView[];
}

// --- collected by email ---------------------------------------------------------------------------------------------

/** `off`: none by email (the default). `each`: an email as each comes. `daily`, `weekly`: a digest of what is unread. */
export const NOTIFICATION_EMAIL_CHOICES = ['off', 'each', 'daily', 'weekly'] as const;
export type NotificationEmailChoice = (typeof NOTIFICATION_EMAIL_CHOICES)[number];

/** `inbox_preferences/{accountId}`: how an account has its notifications by email. Absent is `off`. */
export interface InboxPreferenceRecord {
  readonly accountId: string;
  readonly notificationEmail: NotificationEmailChoice;
  /** When the next digest is due; null unless daily or weekly. */
  readonly digestDueAt: string | null;
  /** When the last digest went (or was due with nothing in it); null before the first. */
  readonly digestSentAt: string | null;
  readonly updatedAt: string;
}

/** `PUT /v1/me/notification-email`. */
export const notificationEmailSchema = z.strictObject({ notificationEmail: z.enum(NOTIFICATION_EMAIL_CHOICES) });
export type NotificationEmailInput = z.infer<typeof notificationEmailSchema>;

/** Digests go at 13:00 UTC: 8 in the morning Eastern Time in winter, 9 in summer. Weekly ones on Mondays. */
export const DIGEST_HOUR_UTC = 13;
/** A digest lists at most this many; the rest are on the Notifications page it links to. */
export const DIGEST_ITEMS = 20;

/** When the next digest after `now` is due; null when the choice has none. */
export function nextDigestAt(choice: NotificationEmailChoice, now: Date): string | null {
  if (choice !== 'daily' && choice !== 'weekly') return null;
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DIGEST_HOUR_UTC));
  if (at.getTime() <= now.getTime()) at.setUTCDate(at.getUTCDate() + 1);
  if (choice === 'weekly') while (at.getUTCDay() !== 1) at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString();
}

/** The preference after the member chose, keeping when the last digest went. */
export function inboxPreference(current: InboxPreferenceRecord | null, accountId: string, choice: NotificationEmailChoice, now: Date): InboxPreferenceRecord {
  const keepsDue = current?.notificationEmail === choice && current.digestDueAt;
  return {
    accountId,
    notificationEmail: choice,
    digestDueAt: keepsDue ? current.digestDueAt : nextDigestAt(choice, now),
    digestSentAt: current?.digestSentAt ?? null,
    updatedAt: now.toISOString(),
  };
}

/** `GET /v1/me/notification-email`: the member's choice, and whether email reaches them at all just now. */
export interface NotificationEmailView {
  readonly notificationEmail: NotificationEmailChoice;
  readonly digestDueAt: string | null;
  /** Whether their address can be mailed (§10.12). */
  readonly mail: MailAddressState;
  /** False while a System Admin has all of the site's email, or these emails, switched off. */
  readonly sending: boolean;
}
