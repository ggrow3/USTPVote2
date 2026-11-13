import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MAIL_CAUSED_BY_SYSTEM,
  NEWSLETTER_CONFIRM_ATTEMPTS,
  NEWSLETTER_PENDING_DAYS,
  newsletterConfirmLink,
  newsletterConfirmMessage,
  suggestionDay,
  type NewsletterSubscriberRecord,
} from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { MAIL_TRANSPORT, type MailTransport } from './mail-transport.js';
import { Mailer } from './mailer.js';
import { tokenHash } from './newsletter.js';
import { NewsletterRepository } from './newsletter.repository.js';
import { NoticeSettingsService } from './notice-settings.js';

/** Confirmations a tick sends at most. */
const CONFIRMATIONS_PER_TICK = 20;

/**
 * Emails the links that confirm newsletter sign-ups (design §10.15), a step of the worker's tick. The link's token is
 * made here, as the email goes, and only its hash is kept, so the link exists nowhere but in that email. Each is claimed
 * in a transaction first, so overlapping ticks never both send it. While all email is off, or no contact is set, they
 * wait (the form takes none meanwhile). Also deletes the sign-up limits of days gone.
 */
@Injectable()
export class NewsletterSender {
  private readonly logger = new Logger(NewsletterSender.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly list: NewsletterRepository,
    private readonly mailer: Mailer,
    private readonly settings: NoticeSettingsService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Returns how many confirmations went. */
  async sendDue(now: Date = new Date()): Promise<number> {
    await this.list.deleteLimitsBefore(suggestionDay(new Date(now.getTime() - 86_400_000)));
    if (!this.transport || !this.config.webOrigin) return 0;
    const settings = await this.settings.current();
    const contact = settings.contact ?? this.config.noticeContact;
    if (!settings.allEmails || !contact) return 0;
    let sent = 0;
    for (const due of await this.list.confirmationsDue(CONFIRMATIONS_PER_TICK)) {
      if (await this.send(due.subscriberId, contact)) sent++;
    }
    return sent;
  }

  private async send(subscriberId: string, contact: string): Promise<boolean> {
    const token = randomBytes(32).toString('base64url');
    const claimed = await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.list.get(tx, subscriberId);
      if (!current?.confirmDue || current.status !== 'pending') return null;
      const next: NewsletterSubscriberRecord = { ...current, confirmDue: false, confirmAttempts: current.confirmAttempts + 1, confirmTokenHash: tokenHash(token) };
      this.list.save(tx, next);
      return next;
    });
    if (!claimed) return false;
    const message = newsletterConfirmMessage({
      origin: this.config.webOrigin!,
      name: claimed.name,
      contact,
      confirm: newsletterConfirmLink(this.config.webOrigin!, token),
      pendingDays: NEWSLETTER_PENDING_DAYS,
    });
    const result = await this.mailer.send(this.transport!, {
      to: claimed.email,
      replyTo: this.config.mailReplyTo,
      ...message,
      // The person who signed up has no account: the site sent it, as they asked on the form.
      meta: { kind: 'newsletter_confirm', ref: subscriberId, electionId: null, accountId: null, causedBy: MAIL_CAUSED_BY_SYSTEM },
    });
    if (result.status === 'sent') {
      await this.firebase.db.runTransaction(async (tx) => {
        const current = await this.list.get(tx, subscriberId);
        if (current) this.list.save(tx, { ...current, confirmSentAt: new Date().toISOString() });
      });
      return true;
    }
    // The mail service could not take it yet: try again next tick, a few times. An address that bounced or was marked
    // as spam gets nothing, and the record lapses with the others never confirmed.
    if (result.status === 'failed' && result.outcome === 'unavailable' && claimed.confirmAttempts < NEWSLETTER_CONFIRM_ATTEMPTS) {
      await this.firebase.db.runTransaction(async (tx) => {
        const current = await this.list.get(tx, subscriberId);
        if (current?.status === 'pending') this.list.save(tx, { ...current, confirmDue: true });
      });
    } else {
      this.logger.warn(`newsletter confirmation ${subscriberId} not sent (${result.status === 'failed' ? result.outcome : result.outcome})`);
    }
    return false;
  }
}
