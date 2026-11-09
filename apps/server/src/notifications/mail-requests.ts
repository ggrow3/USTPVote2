import { Inject, Injectable, Logger } from '@nestjs/common';
import { adminTestMessage, isMailRequestInFlight, mailAddressKey, memberTestMessage, type MailRequestOutcome, type MailRequestRecord } from 'ustp-domain';
import { DirectoryService } from '../auth/directory.service.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { SES_ACCOUNT } from './mail-health.js';
import { MAIL_TRANSPORT, type MailTransport } from './mail-transport.js';
import { MailRepository } from './mail.repository.js';
import { Mailer } from './mailer.js';
import { NoticeSettingsService } from './notice-settings.js';
import type { SesAccountReader } from './ses-account.js';

/** Requests a tick does at most. */
const REQUESTS_PER_TICK = 10;

/**
 * Does what members asked for on their Account page (design §10.12), a step of the worker's tick: a test email to
 * their own address, or trying an address that bounced or was marked as spam again, which takes it off SES's
 * suppression list and the app's, then sends the test; and a System Admin's test to themselves, from Admin › Email. Each
 * is claimed in a transaction first, so overlapping ticks never both send it; one a worker claimed and never finished is
 * failed as `interrupted`. While all email is off only System Admins' tests go; the rest wait.
 */
@Injectable()
export class MailRequestSender {
  private readonly logger = new Logger(MailRequestSender.name);

  constructor(
    private readonly mail: MailRepository,
    private readonly mailer: Mailer,
    private readonly directory: DirectoryService,
    private readonly members: MemberDirectory,
    private readonly settings: NoticeSettingsService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
    @Inject(SES_ACCOUNT) private readonly ses: SesAccountReader | null,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Returns how many test emails went. */
  async sendDue(): Promise<number> {
    if (!this.transport || !this.config.webOrigin) return 0;
    const { allEmails } = await this.settings.current();
    const waiting = allEmails ? await this.mail.unfinishedRequests(REQUESTS_PER_TICK) : await this.mail.unfinishedAdminTests();
    let sent = 0;
    for (const request of waiting) {
      if (request.status === 'pending') {
        if (await this.send(request)) sent++;
      } else if (!isMailRequestInFlight(request, new Date())) {
        await this.mail.moveRequest(request.requestId, 'sending', { status: 'done', claimedAt: null, doneAt: new Date().toISOString(), outcome: 'interrupted' });
      }
    }
    return sent;
  }

  private async send(request: MailRequestRecord): Promise<boolean> {
    if (!(await this.mail.moveRequest(request.requestId, 'pending', { status: 'sending', claimedAt: new Date().toISOString() }))) return false;
    const result = await this.deliver(request);
    await this.mail.moveRequest(request.requestId, 'sending', {
      status: 'done',
      claimedAt: null,
      doneAt: new Date().toISOString(),
      outcome: 'outcome' in result ? result.outcome : null,
      messageId: 'messageId' in result ? result.messageId : null,
    });
    return 'messageId' in result;
  }

  /** The address is read here and stored nowhere else. */
  private async deliver(request: MailRequestRecord): Promise<{ messageId: string } | { outcome: MailRequestOutcome }> {
    // A System Admin's test may be to another System Admin; everything else goes to who asked.
    const to = request.to ?? request.accountId;
    const mailbox = (await this.directory.mailboxes([to])).get(to);
    if (!mailbox?.email) return { outcome: 'no_address' };
    if (request.kind === 'retry') {
      try {
        await this.ses?.unsuppress(mailbox.email);
      } catch (e) {
        this.logger.warn(`request ${request.requestId}: SES's suppression list could not be changed (${e instanceof Error ? e.name : 'error'})`);
        return { outcome: 'unavailable' };
      }
      await this.mail.deleteSuppression(mailAddressKey(mailbox.email));
    }
    const [[member], settings, links] = await Promise.all([
      this.members.findMany([to]),
      this.settings.current(),
      this.mailer.links(to),
    ]);
    const message = (request.kind === 'admin_test' ? adminTestMessage : memberTestMessage)({
      origin: this.config.webOrigin!,
      name: member?.preferredName || member?.legalName || null,
      contact: settings.contact ?? this.config.noticeContact,
      unsubscribe: links.page,
    });
    const result = await this.mailer.send(this.transport!, {
      to: mailbox.email,
      from: this.config.mailFrom,
      replyTo: this.config.mailReplyTo,
      listUnsubscribe: links.oneClick,
      ...message,
      meta: { kind: request.kind === 'admin_test' ? 'admin_test' : 'member_test', ref: request.requestId, electionId: null, accountId: to, causedBy: request.accountId },
    });
    return result.status === 'sent' ? { messageId: result.messageId } : { outcome: result.outcome };
  }
}
