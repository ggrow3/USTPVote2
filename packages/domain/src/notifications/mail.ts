import { sha256Hex } from 'ustp-audit';
import { NOTICE_KINDS, type NoticeDelivery, type NoticeKind, type RecipientStatus } from './notices.js';

/**
 * Delivery reports (design §6.8): what the mail service says became of each message after it took it. The worker keeps
 * one record per message the service took, without the address, the subject or the body, and moves it on as reports
 * arrive (delivered, delayed, bounced, marked as spam, rejected). It never learns whether a message was opened or a link
 * clicked: the emails carry no tracking image and their links go straight to the site. An address that bounced for good
 * or whose owner marked an email as spam is not mailed again (`mail_suppressions`), until its owner asks to try again.
 */

/**
 * What a message is: an election notice (`NoticeKind`), an Election Admin's test of one, a welcome email to an added
 * member (§5.13), the setup check's message to SES's mailbox simulator (`probe`, §10.12), a test email a member asked for
 * on their Account page (`member_test`, §10.12), a test email a System Admin asked for in Admin › Email (`admin_test`,
 * §10.12), a copy of an email an admin wrote to members (`broadcast`, §10.12), a member's in-app notification by email as
 * it came (`notification`) or a digest of them (`notification_digest`, §10.13), or an email Identity Platform sent about
 * the account through SES (§4):
 * a sign-in link, an address to confirm, a password reset, or another (`account_email`), which the worker learns of only
 * from its delivery reports.
 */
export const MAIL_KINDS = [
  ...NOTICE_KINDS,
  'notice_test',
  'welcome',
  'probe',
  'member_test',
  'admin_test',
  'broadcast',
  'membership_message',
  'notification',
  'notification_digest',
  'sign_in_link',
  'address_verification',
  'password_reset',
  'account_email',
] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

/** Who sent it: this app's worker, or Identity Platform through the same mail service. */
export type MailSender = 'app' | 'identity_platform';

/**
 * - `sent`: the mail service took it; no report yet.
 * - `delayed`: the recipient's mail server has not taken it yet, and the service keeps trying.
 * - `delivered`: the recipient's mail server took it. Whether it reached the inbox, or was read, nobody here knows.
 * - `bounced`: it could not be delivered (for good, or after the service stopped trying).
 * - `complained`: delivered, and the recipient marked it as spam.
 * - `rejected`: the service would not send it after all (a virus found, or a template that failed).
 * Later reports never move a message back: a status only gives way to one further down this list.
 */
export const MAIL_STATUSES = ['sent', 'delayed', 'delivered', 'bounced', 'complained', 'rejected'] as const;
export type MailStatus = (typeof MAIL_STATUSES)[number];

/** The reports the worker reads, as the mail service names them (SES event publishing). Opens and clicks are not among them. */
export const MAIL_EVENT_TYPES = ['send', 'delivery', 'delay', 'bounce', 'complaint', 'reject', 'rendering_failure'] as const;
export type MailEventType = (typeof MAIL_EVENT_TYPES)[number];

/** `permanent`: the address does not work. `transient`: it did not work this time, and the service has stopped trying. */
export type BounceType = 'permanent' | 'transient' | 'undetermined';

/** The bounce subtype SES gives an address on its account-level suppression list; it does not count toward the bounce rate. */
export const SUPPRESSED_BOUNCE = 'OnAccountSuppressionList';

/** One delivery report, read from the mail service's queue. */
export interface MailEvent {
  readonly type: MailEventType;
  /** The service's ID for the message, which the worker recorded when it sent it. */
  readonly messageId: string;
  /** When the message was sent, and when this report's event happened. */
  readonly sentAt: string;
  readonly at: string;
  /** This app's tags (`kind`, `ref`); null on mail Identity Platform sent. */
  readonly kind: string | null;
  readonly ref: string | null;
  /** The configuration set that published it, so one deployment never acts on another's reports. */
  readonly configurationSet: string | null;
  /**
   * The recipient's address, as the report names it. Used only to find whose it is and which address to stop mailing;
   * never stored or logged.
   */
  readonly destination: string | null;
  /** The subject, used only to tell Identity Platform's emails apart (`identityMailKind`); never stored or logged. */
  readonly subject: string | null;
  readonly bounce: { readonly type: BounceType; readonly subType: string } | null;
  readonly delay: { readonly type: string; readonly until: string | null } | null;
}

/** `mail_messages/{messageId}`: one message the mail service took, and what its reports said. Kept 180 days. */
export interface MailMessageRecord {
  readonly messageId: string;
  /** Whose it is; null when Identity Platform mailed an address no account has. */
  readonly accountId: string | null;
  readonly kind: MailKind;
  /** What it belongs to: the notice, the test email or the added member; null for Identity Platform's mail. */
  readonly ref: string | null;
  readonly electionId: string | null;
  readonly sender: MailSender;
  /**
   * Who caused it to be sent (design §10.12, the email log): the account that asked (an admin who wrote to members,
   * resent a notice, added a member or asked for a test, or a member who asked for a test), `system` for what the
   * worker sends by itself (a notice's first round, a vote confirmation, the setup check), or null for Identity
   * Platform's mail, which the member asked for, and for records made before 2026-11-08.
   */
  readonly causedBy?: string | null;
  /**
   * True on a welcome sign-in link that a Membership Admin's browser asked Identity Platform to send (design §5.13),
   * recorded when the browser said Identity Platform took it. No mail service gave it an ID, so no report reaches it,
   * unless Identity Platform sends through SES: then its first report takes its place (`asWelcomeLink`). Absent
   * otherwise.
   */
  readonly handOff?: boolean;
  readonly delivery: NoticeDelivery;
  readonly status: MailStatus;
  /** The first bounce's type and subtype (a code, never the mail server's text). */
  readonly bounce: { readonly type: BounceType; readonly subType: string } | null;
  /** The last delay's type, and until when the service keeps trying. */
  readonly delay: { readonly type: string; readonly until: string | null } | null;
  /**
   * Whether it counts toward this deployment's bounce and complaint rates: mail the service really sent, not the
   * outbox's, nor one SES did not try because the address is on its suppression list.
   */
  readonly counted: boolean;
  readonly sentAt: string;
  readonly delayedAt: string | null;
  readonly deliveredAt: string | null;
  readonly bouncedAt: string | null;
  readonly complainedAt: string | null;
  readonly rejectedAt: string | null;
  readonly updatedAt: string;
}

/** Why an address is not mailed. */
export type MailSuppressionReason = 'bounced' | 'complained';

/**
 * `mail_suppressions/{addressKey}`: an address not to mail, because it bounced for good or its owner marked an email as
 * spam. Keyed by a hash of the address, so it applies to whoever has it and never stores it. Kept a year from its last
 * report.
 */
export interface MailSuppressionRecord {
  readonly addressKey: string;
  readonly reason: MailSuppressionReason;
  /** The bounce subtype, for a bounce. */
  readonly subType: string | null;
  /** The account whose message it was, when known. */
  readonly accountId: string | null;
  readonly since: string;
  readonly lastEventAt: string;
  /** The message whose report started it. */
  readonly messageId: string;
}

/** `mail_messages` are kept this long after the message was sent. */
export const MAIL_MESSAGE_RETENTION_DAYS = 180;

/** A suppression lapses this long after its last report. */
export const MAIL_SUPPRESSION_DAYS = 365;

/** How long after a notice's round finished its delivery reports are added up and ledgered (`notice.delivery_reported`). */
export const NOTICE_REPORT_HOURS = 72;

const RANK: Readonly<Record<MailStatus, number>> = { sent: 0, delayed: 1, delivered: 2, bounced: 3, complained: 4, rejected: 5 };

const EVENT_STATUS: Readonly<Record<MailEventType, MailStatus>> = {
  send: 'sent',
  delay: 'delayed',
  delivery: 'delivered',
  bounce: 'bounced',
  complaint: 'complained',
  reject: 'rejected',
  rendering_failure: 'rejected',
};

const STATUS_TIME: Readonly<Partial<Record<MailStatus, keyof MailMessageRecord>>> = {
  delayed: 'delayedAt',
  delivered: 'deliveredAt',
  bounced: 'bouncedAt',
  complained: 'complainedAt',
  rejected: 'rejectedAt',
};

/** The key an address is suppressed under: the same for any spelling of it that mail servers treat alike. */
export function mailAddressKey(address: string): string {
  return sha256Hex(`ustp-mail:${address.trim().toLowerCase()}`);
}

export function isMailKind(value: string): value is MailKind {
  return (MAIL_KINDS as readonly string[]).includes(value);
}

/** Whether a message is a roll member's election notice, whose recipient record follows its reports. */
export function isNoticeMail(kind: MailKind): kind is NoticeKind {
  return (NOTICE_KINDS as readonly string[]).includes(kind);
}

/** The record of a message the worker just sent. */
export function mailMessageRecord(input: {
  readonly messageId: string;
  readonly kind: MailKind;
  readonly ref: string | null;
  readonly electionId: string | null;
  readonly accountId: string | null;
  readonly causedBy: string | null;
  readonly delivery: NoticeDelivery;
  readonly at: string;
}): MailMessageRecord {
  const { messageId, kind, ref, electionId, accountId, causedBy, delivery, at } = input;
  return {
    messageId,
    accountId,
    kind,
    ref,
    electionId,
    sender: 'app',
    causedBy,
    delivery,
    status: 'sent',
    bounce: null,
    delay: null,
    counted: delivery === 'mail' && kind !== 'probe',
    sentAt: at,
    delayedAt: null,
    deliveredAt: null,
    bouncedAt: null,
    complainedAt: null,
    rejectedAt: null,
    updatedAt: at,
  };
}

/**
 * What an email Identity Platform sent is, from its subject (its templates' own words, which name the app): a sign-in
 * link, an address to confirm, a password reset, or another account email (a changed address, a second factor added).
 */
export function identityMailKind(subject: string | null): MailKind {
  const s = (subject ?? '').toLowerCase();
  if (/reset (your )?password|password reset/.test(s)) return 'password_reset';
  if (/(verify|confirm) (your )?email/.test(s)) return 'address_verification';
  if (/^sign in to|sign-in link|sign in link/.test(s) && !/changed/.test(s)) return 'sign_in_link';
  return 'account_email';
}

/** The record of a message Identity Platform sent, from its first report; `accountId` is whose address it went to. */
export function identityMailRecord(event: MailEvent, accountId: string | null): MailMessageRecord {
  const kind = identityMailKind(event.subject);
  return {
    ...mailMessageRecord({ messageId: event.messageId, kind, ref: null, electionId: null, accountId, causedBy: null, delivery: 'mail', at: event.sentAt }),
    sender: 'identity_platform',
  };
}

/**
 * Welcome sign-in links (design §5.13): where the site sends no welcome email of its own, the adding Membership Admin's
 * browser asks Identity Platform to send its sign-in link, then tells the api, which records it in the email log as the
 * admin's (`welcomeLinkRecord`). When Identity Platform sends through SES, the same email also has a report of its own:
 * whichever of the two comes second is matched to the first, within this many minutes, so the log shows it once, as the
 * welcome it is, caused by the admin, with what its reports said.
 */
export const WELCOME_LINK_MATCH_MINUTES = 15;

/** The log's record of a welcome sign-in link the admin's browser says Identity Platform took. */
export function welcomeLinkRecord(input: { readonly messageId: string; readonly accountId: string; readonly causedBy: string; readonly at: string }): MailMessageRecord {
  const { messageId, accountId, causedBy, at } = input;
  return {
    ...mailMessageRecord({ messageId, kind: 'welcome', ref: accountId, electionId: null, accountId, causedBy, delivery: 'mail', at }),
    sender: 'identity_platform',
    handOff: true,
    // Not a message of this deployment's SES configuration set: its rates count only those.
    counted: false,
  };
}

/** A welcome link the browser reported, not yet matched to a report. */
export function isUnmatchedWelcomeLink(record: MailMessageRecord): boolean {
  return record.handOff === true && record.kind === 'welcome';
}

/** A sign-in link Identity Platform sent through SES, not yet known to be anyone's welcome. */
export function isUnclaimedSignInLink(record: MailMessageRecord): boolean {
  return record.sender === 'identity_platform' && record.kind === 'sign_in_link' && !record.causedBy && !record.handOff;
}

/** Of these records (one account's), the one sent nearest `at`, within `WELCOME_LINK_MATCH_MINUTES` either side; else null. */
export function nearestWelcomeLink(records: readonly MailMessageRecord[], at: string): MailMessageRecord | null {
  const t = Date.parse(at);
  let best: { record: MailMessageRecord; gap: number } | null = null;
  for (const record of records) {
    const gap = Math.abs(Date.parse(record.sentAt) - t);
    if (gap <= WELCOME_LINK_MATCH_MINUTES * 60_000 && (!best || gap < best.gap)) best = { record, gap };
  }
  return best?.record ?? null;
}

/**
 * Identity Platform's record of a sign-in link (from its report) as the welcome an admin's browser asked for: the
 * report's message, status and times, the welcome's kind, member and admin.
 */
export function asWelcomeLink(record: MailMessageRecord, link: { readonly accountId: string; readonly causedBy: string | null | undefined }): MailMessageRecord {
  const { handOff: _, ...reported } = record;
  return { ...reported, kind: 'welcome', ref: link.accountId, accountId: link.accountId, causedBy: link.causedBy ?? null };
}

/** What one report does: the message's record after it, whether that changed, and whether to stop mailing the address. */
export interface MailEventEffect {
  readonly record: MailMessageRecord;
  readonly changed: boolean;
  readonly suppress: MailSuppressionReason | null;
}

/**
 * Applies one report to a message's record. Reports may come late, twice or out of order: a status only moves further
 * down `MAIL_STATUSES`, each time is kept from its first report, so applying a report again changes nothing. A permanent
 * bounce or a complaint stops mail to the address, except on the setup check's own messages to the simulator.
 */
export function applyMailEvent(record: MailMessageRecord, event: MailEvent): MailEventEffect {
  const target = EVENT_STATUS[event.type];
  const timeField = STATUS_TIME[target];
  const next: Record<string, unknown> = { ...record };
  if (RANK[target] > RANK[record.status]) next.status = target;
  if (timeField && record[timeField] === null) next[timeField] = event.at;
  if (event.bounce && !record.bounce) next.bounce = event.bounce;
  if (event.delay) next.delay = event.delay;
  if (event.bounce?.subType === SUPPRESSED_BOUNCE) next.counted = false;
  const changed = Object.keys(next).some((k) => JSON.stringify(next[k]) !== JSON.stringify(record[k as keyof MailMessageRecord]));
  const suppress =
    record.kind === 'probe' ? null : event.type === 'complaint' ? 'complained' : event.bounce?.type === 'permanent' ? 'bounced' : null;
  return {
    record: (changed ? { ...next, updatedAt: event.at } : record) as MailMessageRecord,
    changed,
    suppress,
  };
}

/**
 * What a notice's recipient record says of a message: sent with no report yet (also while delayed), delivered, marked as
 * spam, or bounced (also a message the service rejected).
 */
export function recipientStatusOf(status: MailStatus): Extract<RecipientStatus, 'sent' | 'delivered' | 'bounced' | 'complained'> {
  if (status === 'delivered' || status === 'complained') return status;
  if (status === 'bounced' || status === 'rejected') return 'bounced';
  return 'sent';
}

/** A suppression after another report about the same address: a complaint outweighs a bounce, and it lasts from the last one. */
export function nextSuppression(
  current: MailSuppressionRecord | null,
  input: { readonly addressKey: string; readonly reason: MailSuppressionReason; readonly event: MailEvent; readonly accountId: string | null },
): MailSuppressionRecord {
  const { addressKey, reason, event, accountId } = input;
  const subType = reason === 'bounced' ? (event.bounce?.subType ?? null) : null;
  if (!current) return { addressKey, reason, subType, accountId, since: event.at, lastEventAt: event.at, messageId: event.messageId };
  const upgrade = current.reason === 'bounced' && reason === 'complained';
  return {
    ...current,
    ...(upgrade && { reason, subType }),
    accountId: current.accountId ?? accountId,
    lastEventAt: event.at > current.lastEventAt ? event.at : current.lastEventAt,
  };
}
