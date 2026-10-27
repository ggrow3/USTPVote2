import type { Firestore } from 'firebase-admin/firestore';
import { Collections, type NoticeDelivery, type NoticeOutcome, type OutboxMessageRecord } from 'ustp-domain';

/** One email. `to` is null only in the outbox, for a test voter, who has no address. */
export interface MailMessage {
  readonly to: string | null;
  readonly from: string;
  readonly replyTo: string | null;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** What the message is, for the provider's reports and the outbox; no personal data. */
  readonly tags: { readonly noticeId: string; readonly electionId: string; readonly accountId: string };
}

/** Sends election notices (design §6.8). */
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

/** A message the provider took and later reported undeliverable (a permanent bounce). */
export interface BounceReport {
  readonly noticeId: string;
  readonly messageId: string;
}

/** Where bounce reports wait until the worker reads them. */
export interface BounceSource {
  /** Up to a batch of reports, with the receipts that remove them once handled. */
  receive(): Promise<{ readonly bounces: BounceReport[]; readonly receipts: string[] }>;
  acknowledge(receipts: readonly string[]): Promise<void>;
}

/** The mail provider, or null when this deployment sends no email (`MAIL_TRANSPORT=off`). */
export const MAIL_TRANSPORT = Symbol('MailTransport');

/** Where bounce reports come from, or null when there is no such feed. */
export const BOUNCE_SOURCE = Symbol('BounceSource');

/** Emulator-only: the bounces the outbox acts out, as SES would report them. */
const EMULATOR_BOUNCES = 'emulator_bounces';

/**
 * Records each message in `notice_outbox` instead of mailing it. The mail stand-in with the emulators (refused
 * elsewhere, like the other stand-ins), and the delivery of a rehearsal's notice in testing mode, whose test voters have
 * no address. With the emulators it acts out a provider's answers for tests: an address at `refused.test` is refused,
 * one at `unavailable.test` meets a provider that is down, and one at `bounce.test` is taken and then bounces.
 */
export class OutboxTransport implements MailTransport {
  readonly delivery = 'outbox';

  constructor(private readonly db: Firestore) {}

  async send(message: MailMessage): Promise<{ messageId: string }> {
    const domain = message.to?.split('@').pop()?.toLowerCase();
    if (domain === 'refused.test') throw new MailNotSent('refused', 'the outbox refuses addresses at refused.test');
    if (domain === 'unavailable.test') throw new MailNotSent('unavailable', 'the outbox is unavailable to addresses at unavailable.test');
    const ref = this.db.collection(Collections.noticeOutbox).doc();
    const record: OutboxMessageRecord = {
      id: ref.id,
      noticeId: message.tags.noticeId,
      electionId: message.tags.electionId,
      accountId: message.tags.accountId,
      to: message.to,
      from: message.from,
      replyTo: message.replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
      recordedAt: new Date().toISOString(),
    };
    await ref.create(record);
    if (domain === 'bounce.test') {
      const report: BounceReport = { noticeId: message.tags.noticeId, messageId: ref.id };
      await this.db.collection(EMULATOR_BOUNCES).add(report);
    }
    return { messageId: ref.id };
  }
}

/** The bounces `OutboxTransport` acts out, read like SES's queue. Emulators only. */
export class OutboxBounces implements BounceSource {
  constructor(private readonly db: Firestore) {}

  async receive(): Promise<{ bounces: BounceReport[]; receipts: string[] }> {
    const snap = await this.db.collection(EMULATOR_BOUNCES).limit(10).get();
    return { bounces: snap.docs.map((d) => d.data() as BounceReport), receipts: snap.docs.map((d) => d.id) };
  }

  async acknowledge(receipts: readonly string[]): Promise<void> {
    await Promise.all(receipts.map((id) => this.db.collection(EMULATOR_BOUNCES).doc(id).delete()));
  }
}
