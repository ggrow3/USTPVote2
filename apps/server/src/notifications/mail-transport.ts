import type { Firestore } from 'firebase-admin/firestore';
import { Collections, type NoticeDelivery, type NoticeOutcome, type OutboxMessageRecord } from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';

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

/** The mail provider, or null when this deployment sends no email (`MAIL_TRANSPORT=off`). */
export const MAIL_TRANSPORT = Symbol('MailTransport');

export const mailTransportProvider = {
  provide: MAIL_TRANSPORT,
  inject: [CONFIG, Firebase],
  useFactory: (config: ServerConfig, firebase: Firebase): MailTransport | null =>
    config.mailTransport === 'outbox' ? new OutboxTransport(firebase.db) : null,
};

/**
 * Records each message in `notice_outbox` instead of mailing it. The mail stand-in with the emulators (refused
 * elsewhere, like the other stand-ins), and the delivery of a rehearsal's notice in testing mode, whose test voters have
 * no address. With the emulators it acts out a provider's answers for tests: an address at `refused.test` is refused
 * and one at `unavailable.test` meets a provider that is down.
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
    return { messageId: ref.id };
  }
}
