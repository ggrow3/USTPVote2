import type { Firestore } from 'firebase-admin/firestore';
import { Collections, type MailEvent, type MailKind, type NoticeDelivery, type NoticeOutcome, type OutboxMessageRecord } from 'ustp-domain';

/** What a message is, for its record and the outbox. Only `kind` and `ref` go to the mail provider, as tags. */
export interface MailMeta {
  readonly kind: MailKind;
  /** The notice, test email or added member it belongs to. */
  readonly ref: string | null;
  readonly electionId: string | null;
  readonly accountId: string | null;
  /**
   * Who caused it (the email log, design §10.12): the account that asked for it, or `system` for what the worker sends
   * by itself. Kept in the message's record; never sent to the provider.
   */
  readonly causedBy: string;
}

/** One email. `to` is null only in the outbox, for a test voter, who has no address. */
export interface MailMessage {
  readonly to: string | null;
  readonly from: string;
  readonly replyTo: string | null;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** Where its `List-Unsubscribe` header points (design §10.12); absent for a message to nobody or to Amazon's simulator. */
  readonly listUnsubscribe?: string | null;
  readonly meta: MailMeta;
}

/** Sends the app's email: election notices, test emails, welcome emails (design §6.8, §5.13). */
export interface MailTransport {
  readonly delivery: NoticeDelivery;
  /** Resolves with the provider's ID for the message once it has taken it; throws `MailNotSent` when it has not. */
  send(message: MailMessage): Promise<{ readonly messageId: string }>;
}

/** The provider did not take the message, and the message was certainly not sent. */
export class MailNotSent extends Error {
  constructor(
    readonly outcome: Extract<NoticeOutcome, 'refused' | 'unavailable'>,
    message: string,
  ) {
    super(message);
  }
}

/** Where the provider's delivery reports wait until the worker reads them. */
export interface MailEventSource {
  /**
   * Up to a batch of reports, each with the receipt that removes it once handled; `event` is null for one that is not a
   * delivery report this worker reads (an open, a click, anything unreadable), which is removed unread.
   */
  receive(): Promise<readonly { readonly receipt: string; readonly event: MailEvent | null }[]>;
  /** Removes handled reports. One never acknowledged comes back, and after a few tries goes to the dead-letter queue. */
  acknowledge(receipts: readonly string[]): Promise<void>;
}

/** The mail provider, or null when this deployment sends no email (`MAIL_TRANSPORT=off`). */
export const MAIL_TRANSPORT = Symbol('MailTransport');

/** Where delivery reports come from, or null when there is no such feed. */
export const MAIL_EVENT_SOURCE = Symbol('MailEventSource');

/** Emulator-only: the delivery reports the outbox acts out, as SES would publish them. */
const EMULATOR_MAIL_EVENTS = 'emulator_mail_events';

/** SES's mailbox simulator, whose addresses answer as their names say without mailing anyone. */
const SIMULATOR_DOMAIN = 'simulator.amazonses.com';

type ActedOut = { readonly eventType: string; readonly detail?: Record<string, unknown> };

const bounce = (bounceType: string, bounceSubType: string): ActedOut => ({ eventType: 'Bounce', detail: { bounce: { bounceType, bounceSubType } } });
const DELIVERY: ActedOut = { eventType: 'Delivery' };
const COMPLAINT: ActedOut = { eventType: 'Complaint', detail: { complaint: { complaintFeedbackType: 'abuse' } } };

/**
 * The reports the outbox acts out for a message to `to`, after its Send: delivered, unless the address is at one of the
 * test domains (`bounce.test` bounces for good, `soft.test` bounces after the provider stopped trying, `complaint.test`
 * is marked as spam, `delay.test` is delayed then delivered, `suppressed.test` is on SES's suppression list) or is one
 * of the SES mailbox simulator's, which answer as SES's do. None for a message to nobody (a test voter's).
 */
export function actedOutReports(to: string | null): readonly ActedOut[] {
  if (!to) return [];
  const [local = '', domain = ''] = to.toLowerCase().split('@');
  const name = domain === SIMULATOR_DOMAIN ? local.split('+')[0] : domain.replace(/\.test$/, '');
  switch (name) {
    case 'bounce':
      return [bounce('Permanent', 'General')];
    case 'soft':
      return [bounce('Transient', 'MailboxFull')];
    case 'complaint':
      return [DELIVERY, COMPLAINT];
    case 'delay':
      return [{ eventType: 'DeliveryDelay', detail: { deliveryDelay: { delayType: 'MailboxFull', expirationTime: null } } }, DELIVERY];
    case 'suppressed':
    case 'suppressionlist':
      return [bounce('Permanent', 'OnAccountSuppressionList')];
    default:
      return [DELIVERY];
  }
}

/**
 * One SES event-publishing report about a message, as JSON: what the outbox acts out, and tests put on the emulators'
 * queue. `tags` are the message's tags; Identity Platform's mail has none of this app's.
 */
export function sesEventBody(input: {
  readonly eventType: string;
  readonly messageId: string;
  readonly to: string | null;
  readonly sentAt: string;
  readonly at: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly detail?: Record<string, unknown>;
  readonly subject?: string;
}): string {
  const { eventType, messageId, to, sentAt, at, tags, detail, subject } = input;
  const key = { Bounce: 'bounce', Complaint: 'complaint', Delivery: 'delivery', DeliveryDelay: 'deliveryDelay', Send: 'send' }[eventType];
  const sub = key ? { ...((detail?.[key] as object | undefined) ?? {}), timestamp: at } : {};
  return JSON.stringify({
    eventType,
    mail: {
      timestamp: sentAt,
      messageId,
      destination: to ? [to] : [],
      tags: Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, [v]])),
      ...(subject !== undefined && { commonHeaders: { subject } }),
    },
    ...detail,
    ...(key && { [key]: sub }),
  });
}

/**
 * Records each message in `notice_outbox` instead of mailing it. The mail stand-in with the emulators (refused
 * elsewhere, like the other stand-ins), and the delivery of a rehearsal's notice in testing mode, whose test voters have
 * no address. As the emulators' stand-in (`actOut`) it acts out the provider: an address at `refused.test` is refused,
 * one at `unavailable.test` meets a provider that is down, and every message taken gets the delivery reports
 * `actedOutReports` gives it, on the emulators' own queue.
 */
export class OutboxTransport implements MailTransport {
  readonly delivery = 'outbox';

  constructor(
    private readonly db: Firestore,
    private readonly options: { readonly actOut: boolean; readonly configurationSet: string | null },
  ) {}

  async send(message: MailMessage): Promise<{ messageId: string }> {
    const domain = message.to?.split('@').pop()?.toLowerCase();
    if (domain === 'refused.test') throw new MailNotSent('refused', 'the outbox refuses addresses at refused.test');
    if (domain === 'unavailable.test') throw new MailNotSent('unavailable', 'the outbox is unavailable to addresses at unavailable.test');
    const ref = this.db.collection(Collections.noticeOutbox).doc();
    const { kind, ref: of, electionId, accountId } = message.meta;
    const recordedAt = new Date().toISOString();
    const record: OutboxMessageRecord = {
      id: ref.id,
      kind,
      ref: of,
      electionId,
      accountId,
      to: message.to,
      from: message.from,
      replyTo: message.replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
      listUnsubscribe: message.listUnsubscribe ?? null,
      recordedAt,
    };
    await ref.create(record);
    if (this.options.actOut) {
      const tags = {
        kind,
        ...(of && { ref: of }),
        ...(this.options.configurationSet && { 'ses:configuration-set': this.options.configurationSet }),
      };
      const reports = actedOutReports(message.to);
      const events = this.db.collection(EMULATOR_MAIL_EVENTS);
      await Promise.all(
        reports.map((r) => events.add({ body: sesEventBody({ ...r, messageId: ref.id, to: message.to, sentAt: recordedAt, at: recordedAt, tags }) })),
      );
    }
    return { messageId: ref.id };
  }
}

/** The delivery reports the outbox acts out (and tests add), read like SES's queue. Emulators only. */
export class OutboxMailEvents implements MailEventSource {
  constructor(
    private readonly db: Firestore,
    private readonly parse: (body: string) => MailEvent | null,
  ) {}

  async receive(): Promise<{ receipt: string; event: MailEvent | null }[]> {
    const snap = await this.db.collection(EMULATOR_MAIL_EVENTS).limit(10).get();
    return snap.docs.map((d) => ({ receipt: d.id, event: this.parse(String(d.get('body') ?? '')) }));
  }

  async acknowledge(receipts: readonly string[]): Promise<void> {
    await Promise.all(receipts.map((id) => this.db.collection(EMULATOR_MAIL_EVENTS).doc(id).delete()));
  }
}

/** Adds a report to the emulators' queue, as SES would publish it: for tests, such as mail Identity Platform sent. */
export function addEmulatorMailEvent(db: Firestore, body: string): Promise<unknown> {
  return db.collection(EMULATOR_MAIL_EVENTS).add({ body });
}
