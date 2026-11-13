import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Collections,
  isWelcomeInFlight,
  welcomeMessage,
  type AccountRecord,
  type WelcomeEmailRecord,
  type WelcomeOutcome,
} from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { MAIL_TRANSPORT, type MailTransport } from './mail-transport.js';
import { Mailer } from './mailer.js';
import { NoticeSettingsService } from './notice-settings.js';

/** Welcome emails a tick sends at most, one after another. */
const WELCOMES_PER_TICK = 20;

/**
 * Sends the welcome emails the api queued for members a Membership Admin added (design §5.13), a step of the
 * worker's tick, through the election notices' mail transport. Each is claimed in a transaction (`pending` →
 * `sending`) before it goes, so overlapping ticks never both send it, and one a worker claimed and never finished is
 * failed as `interrupted` rather than risk a second copy; a Membership Admin can ask again. It goes to the address the
 * admin entered, which is not verified yet: proving it is what the email leads to. One for a member who has signed
 * in meanwhile is not sent.
 */
@Injectable()
export class WelcomeSender {
  private readonly logger = new Logger(WelcomeSender.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly members: MemberDirectory,
    private readonly settings: NoticeSettingsService,
    private readonly mailer: Mailer,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Sends what is waiting and closes interrupted claims. Returns how many went. */
  async sendDue(): Promise<number> {
    if (!this.transport) return 0;
    if (!this.config.webOrigin) {
      this.logger.warn('welcome emails are not sent: WEB_ORIGIN is not set');
      return 0;
    }
    const waiting = await this.firebase.db
      .collection(Collections.welcomeEmails)
      .where('status', 'in', ['pending', 'sending'])
      .limit(WELCOMES_PER_TICK)
      .get();
    if (waiting.empty) return 0;
    const settings = await this.settings.current();
    // All email switched off: what is waiting goes if it comes back on.
    if (!settings.allEmails) return 0;
    const contact = settings.contact ?? this.config.noticeContact;
    let sent = 0;
    for (const doc of waiting.docs) {
      const record = doc.data() as WelcomeEmailRecord;
      if (record.status === 'pending') {
        if (await this.send(record, contact)) sent++;
      } else if (!isWelcomeInFlight(record, new Date())) {
        await this.move(record, 'sending', { status: 'done', claimedAt: null, doneAt: new Date().toISOString(), outcome: 'interrupted' });
      }
    }
    return sent;
  }

  /** Claims, sends and records one welcome email. */
  private async send(record: WelcomeEmailRecord, contact: string | null): Promise<boolean> {
    const claimedAt = new Date().toISOString();
    if (!(await this.move(record, 'pending', { status: 'sending', claimedAt }))) return false;
    const result = await this.deliver(record.accountId, record.requestedBy, contact);
    await this.ref(record.accountId).update({
      status: 'done',
      claimedAt: null,
      doneAt: new Date().toISOString(),
      outcome: 'outcome' in result ? result.outcome : null,
      messageId: 'messageId' in result ? result.messageId : null,
    });
    return 'messageId' in result;
  }

  /** Sends to the account's address, read here and stored nowhere else. */
  private async deliver(accountId: string, requestedBy: string, contact: string | null): Promise<{ messageId: string } | { outcome: WelcomeOutcome }> {
    const account = (await this.firebase.db.collection(Collections.accounts).doc(accountId).get()).data() as AccountRecord | undefined;
    if (!account?.primaryEmail) return { outcome: 'no_address' };
    if (account.claimedAt) return { outcome: 'signed_in' };
    const [[member], links] = await Promise.all([this.members.findMany([accountId]), this.mailer.links(accountId)]);
    const message = welcomeMessage({
      origin: this.config.webOrigin!,
      name: member?.preferredName || member?.legalName || null,
      contact,
      unsubscribe: links.page,
    });
    const result = await this.mailer.send(this.transport!, {
      to: account.primaryEmail,
      replyTo: this.config.mailReplyTo,
      listUnsubscribe: links.oneClick,
      ...message,
      meta: { kind: 'welcome', ref: accountId, electionId: null, accountId, causedBy: requestedBy },
    });
    if (result.status === 'sent') return { messageId: result.messageId };
    return { outcome: result.outcome };
  }

  /**
   * Moves a welcome email on from `from` in a transaction: one waiting, or a claim that was interrupted. False when it
   * is no longer there, because another worker got to it first or a Membership Admin asked again.
   */
  private move(record: WelcomeEmailRecord, from: WelcomeEmailRecord['status'], next: Partial<WelcomeEmailRecord>): Promise<boolean> {
    const ref = this.ref(record.accountId);
    return this.firebase.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as WelcomeEmailRecord | undefined;
      if (current?.status !== from || current.requestedAt !== record.requestedAt) return false;
      if (from === 'sending' && isWelcomeInFlight(current, new Date())) return false;
      tx.update(ref, next);
      return true;
    });
  }

  private ref(accountId: string) {
    return this.firebase.db.collection(Collections.welcomeEmails).doc(accountId);
  }
}
