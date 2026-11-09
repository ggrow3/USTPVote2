import { Inject, Injectable } from '@nestjs/common';
import {
  DIGEST_ITEMS,
  MAIL_CAUSED_BY_SYSTEM,
  nextDigestAt,
  notificationEmailMessage,
  type AppNotificationRecord,
  type NotificationEmailPeriod,
} from 'ustp-domain';
import { DirectoryService } from '../auth/directory.service.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { MAIL_TRANSPORT, type MailTransport } from '../notifications/mail-transport.js';
import { Mailer } from '../notifications/mailer.js';
import { NoticeSettingsService } from '../notifications/notice-settings.js';
import { InboxRepository } from './inbox.repository.js';

/** At most this long a tick, after the election emails and admins' emails, which come first. */
export const NOTIFICATION_MAIL_BUDGET_MS = 10_000;
const BATCH = 50;
/** A notification by email as it comes is not worth sending after this long; it is on the site. */
const STALE_MS = 24 * 3_600_000;
/** A first digest covers this far back. */
const PERIOD_MS = { daily: 86_400_000, weekly: 7 * 86_400_000 } as const;

type Delivered = 'sent' | 'not_sent' | 'retry';

/**
 * Members' in-app notifications by email (design §10.13), a step of the worker's tick: an email as each comes for those
 * who chose that, and a digest of what is unread for those who chose daily or weekly. Each goes through `Mailer`, the
 * gate of all the site's email (§10.12), so nobody who unsubscribed or whose email an admin stopped gets one. While all
 * email, or these emails, are switched off, or no contact for questions is set, nothing goes and nothing waits: the
 * notifications are on the site, and an email about one a day later would only be noise. Each is claimed before it is
 * sent, so none goes twice.
 */
@Injectable()
export class NotificationMailer {
  constructor(
    private readonly inbox: InboxRepository,
    private readonly mailer: Mailer,
    private readonly settings: NoticeSettingsService,
    private readonly directory: DirectoryService,
    private readonly members: MemberDirectory,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Returns how many emails went. */
  async sendDue(budgetMs: number = NOTIFICATION_MAIL_BUDGET_MS): Promise<number> {
    const settings = await this.settings.current();
    const contact = settings.contact ?? this.config.noticeContact;
    const sending =
      !!this.transport && !!this.config.webOrigin && settings.allEmails && settings.emails.notifications && (this.transport.delivery !== 'mail' || !!contact);
    const deadline = Date.now() + budgetMs;
    return (await this.eachAsItComes(sending, contact, deadline)) + (await this.digests(sending, contact, deadline));
  }

  private async eachAsItComes(sending: boolean, contact: string | null, deadline: number): Promise<number> {
    const pending = await this.inbox.emailPending(BATCH);
    if (!pending.length) return 0;
    const preferences = await this.inbox.preferences([...new Set(pending.map((n) => n.accountId))]);
    let sent = 0;
    for (const notification of pending) {
      if (Date.now() >= deadline) break;
      // Claimed first: whatever comes of it, the next tick will not look at it again.
      if (!(await this.inbox.emailDone(notification, null))) continue;
      const wanted = preferences.get(notification.accountId)?.notificationEmail === 'each';
      const stale = Date.now() - Date.parse(notification.updatedAt) > STALE_MS;
      if (!wanted || notification.readAt || !sending || stale) continue;
      const result = await this.deliver(notification.accountId, contact, 'each', [notification], 0);
      if (result === 'sent') {
        await this.inbox.markEmailed([notification], new Date().toISOString());
        sent++;
      } else if (result === 'retry') {
        await this.inbox.reopenEmail(notification);
      }
    }
    return sent;
  }

  private async digests(sending: boolean, contact: string | null, deadline: number): Promise<number> {
    const now = new Date();
    const due = await this.inbox.digestsDue(now.toISOString(), BATCH);
    let sent = 0;
    for (const preference of due) {
      if (Date.now() >= deadline) break;
      const period = preference.notificationEmail;
      if (period !== 'daily' && period !== 'weekly') continue;
      // Moved on to the next time first, so two workers never both send it, and a failed one is not repeated.
      if (!(await this.inbox.claimDigest(preference, nextDigestAt(period, now), now.toISOString()))) continue;
      if (!sending) continue;
      const since = preference.digestSentAt ?? new Date(now.getTime() - PERIOD_MS[period]).toISOString();
      const { records, total } = await this.inbox.unreadSince(preference.accountId, since, DIGEST_ITEMS);
      if (!records.length) continue;
      if ((await this.deliver(preference.accountId, contact, period, records, total - records.length)) === 'sent') {
        await this.inbox.markEmailed(records, new Date().toISOString());
        sent++;
      }
    }
    return sent;
  }

  /** Sends one email to the account's confirmed address, read here and stored nowhere else. */
  private async deliver(accountId: string, contact: string | null, period: NotificationEmailPeriod, items: readonly AppNotificationRecord[], more: number): Promise<Delivered> {
    const mailbox = (await this.directory.mailboxes([accountId])).get(accountId);
    if (!mailbox?.email || !mailbox.verified) return 'not_sent';
    const [[member], links] = await Promise.all([this.members.findMany([accountId]), this.mailer.links(accountId)]);
    const message = notificationEmailMessage({
      origin: this.config.webOrigin!,
      name: member?.preferredName || member?.legalName || null,
      contact,
      unsubscribe: links.page,
      period,
      // A conversation's address names both accounts in it, so an email, which passes through the mail service and the
      // member's mail provider, links to the Messages page instead.
      items: items.map((n) => ({ title: n.title, link: n.kind === 'message' ? '/messages' : n.link })),
      more,
    });
    const result = await this.mailer.send(this.transport!, {
      to: mailbox.email,
      replyTo: this.config.mailReplyTo,
      listUnsubscribe: links.oneClick,
      ...message,
      meta: {
        kind: period === 'each' ? 'notification' : 'notification_digest',
        ref: period === 'each' ? items[0]!.notificationId : null,
        electionId: null,
        accountId,
        causedBy: MAIL_CAUSED_BY_SYSTEM,
      },
    });
    if (result.status === 'sent') return 'sent';
    return result.status === 'failed' && result.outcome === 'unavailable' ? 'retry' : 'not_sent';
  }
}
