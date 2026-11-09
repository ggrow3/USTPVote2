import { Inject, Injectable } from '@nestjs/common';
import { membershipMessageEmail, type InboxEmail, type InboxEmailSkip, type MembershipMessageRecord } from 'ustp-domain';
import { DirectoryService } from '../auth/directory.service.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { MAIL_TRANSPORT, type MailTransport } from '../notifications/mail-transport.js';
import { Mailer } from '../notifications/mailer.js';
import { NoticeSettingsService } from '../notifications/notice-settings.js';
import { MembershipInboxRepository } from './membership-inbox.repository.js';
import { memberThreadPath } from './membership-inbox.service.js';

/** At most this long a tick, after the notifications by email. */
export const MEMBERSHIP_MAIL_BUDGET_MS = 10_000;
const BATCH = 50;
/** The mail service failing for this long is a failure, not a wait. */
const GIVE_UP_MS = 24 * 3_600_000;

/**
 * The membership team's messages by email (design §10.13), a step of the worker's tick: each message the team wrote to a
 * member, as it is, to the member's confirmed address. They are membership business, so they do not wait on the member
 * having chosen news and announcements, but they go through `Mailer`, the gate of all the site's email (§10.12): nothing
 * while all email is off, nothing to a member who unsubscribed or whose email an admin stopped, nor to an address that
 * bounced. What happened is kept on the message, for the team to see; nothing waits for email to be switched on, since
 * the member has it on the site. Each is claimed before it is sent, so none goes twice.
 */
@Injectable()
export class MembershipMailer {
  constructor(
    private readonly inbox: MembershipInboxRepository,
    private readonly mailer: Mailer,
    private readonly settings: NoticeSettingsService,
    private readonly directory: DirectoryService,
    private readonly members: MemberDirectory,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Returns how many emails went. */
  async sendDue(budgetMs: number = MEMBERSHIP_MAIL_BUDGET_MS): Promise<number> {
    const pending = await this.inbox.emailPending(BATCH);
    if (!pending.length) return 0;
    const settings = await this.settings.current();
    const contact = settings.contact ?? this.config.noticeContact;
    const sending = !!this.transport && !!this.config.webOrigin && settings.allEmails && (this.transport.delivery !== 'mail' || !!contact);
    const deadline = Date.now() + budgetMs;
    let sent = 0;
    for (const message of pending) {
      if (Date.now() >= deadline) break;
      if (!(await this.inbox.claimEmail(message.messageId))) continue;
      const result = sending ? await this.deliver(message, contact) : { skip: 'email_off' as const };
      const at = new Date().toISOString();
      if ('sent' in result) {
        await this.inbox.setEmail(message.messageId, { status: 'sent', reason: null, at });
        sent++;
      } else if (result.skip === 'retry' && Date.now() - Date.parse(message.sentAt) < GIVE_UP_MS) {
        await this.inbox.setEmail(message.messageId, message.email ?? { status: 'pending', reason: null, at: null }, true);
      } else {
        const reason: InboxEmailSkip = result.skip === 'retry' ? 'failed' : result.skip;
        await this.inbox.setEmail(message.messageId, { status: 'not_sent', reason, at } satisfies InboxEmail);
      }
    }
    return sent;
  }

  private async deliver(message: MembershipMessageRecord, contact: string | null): Promise<{ sent: true } | { skip: InboxEmailSkip | 'retry' }> {
    const thread = await this.inbox.thread(message.threadId);
    // The conversation went with the member's account.
    if (!thread) return { skip: 'no_address' };
    const mailbox = (await this.directory.mailboxes([thread.accountId])).get(thread.accountId);
    if (!mailbox?.email) return { skip: 'no_address' };
    if (!mailbox.verified) return { skip: 'unverified' };
    const [[member], links] = await Promise.all([this.members.findMany([thread.accountId]), this.mailer.links(thread.accountId)]);
    const email = membershipMessageEmail({
      origin: this.config.webOrigin!,
      name: member?.preferredName || member?.legalName || null,
      contact,
      subject: thread.subject,
      reply: message.sentAt !== thread.createdAt,
      body: message.body,
      link: memberThreadPath(thread.threadId),
      unsubscribe: links.page,
    });
    const result = await this.mailer.send(this.transport!, {
      to: mailbox.email,
      replyTo: this.config.mailReplyTo,
      listUnsubscribe: links.oneClick,
      ...email,
      meta: { kind: 'membership_message', ref: thread.threadId, electionId: null, accountId: thread.accountId, causedBy: message.authorId },
    });
    if (result.status === 'sent') return { sent: true };
    if (result.status === 'skipped') return { skip: result.outcome };
    return { skip: result.outcome === 'unavailable' ? 'retry' : 'failed' };
  }
}
