import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  APP_NOTIFICATIONS_SHOWN,
  appNotificationId,
  appNotificationView,
  inboxPreference,
  nextAppNotification,
  type AppNotificationKind,
  type MyNotificationsView,
  type NotificationEmailChoice,
  type NotificationEmailView,
} from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { MailRecords } from '../notifications/mail-records.js';
import { NoticeSettingsService } from '../notifications/notice-settings.js';
import { InboxRepository } from './inbox.repository.js';
import { MembershipInboxRepository } from './membership-inbox.repository.js';

/** What a notification says, and where it leads. */
export interface NotificationInput {
  readonly kind: AppNotificationKind;
  /** What it is about: several events about one thing make one notification while it is unread. */
  readonly ref: string;
  readonly title: string;
  readonly link: string;
  /** More to say in its own email, for the kinds that are always emailed. */
  readonly detail?: string;
}

/** Unread notifications marked read at once at most; the rest stay for the next "mark all read". */
const READ_ALL_LIMIT = 500;

/**
 * In-app notifications (design §10.13). Other contexts notify an account through `notify`, and an account reads, marks
 * and chooses how it gets its own. Notifications are never ledgered: they only say where to look.
 */
@Injectable()
export class InboxNotices {
  constructor(
    private readonly firebase: Firebase,
    private readonly inbox: InboxRepository,
  ) {}

  /**
   * Reads what `notify` needs in `tx`, before the transaction's writes; the function it returns writes it. For a
   * transaction that also writes the thing notified about.
   */
  async prepare(tx: Transaction, accountId: string, input: NotificationInput, at: string): Promise<() => void> {
    const current = await this.inbox.notification(appNotificationId(accountId, input.kind, input.ref), tx);
    return () => this.inbox.setNotification(tx, nextAppNotification(current, { ...input, accountId, at }));
  }

  /** Notifies each account, one transaction each. */
  async notify(accountIds: readonly string[], input: NotificationInput): Promise<void> {
    const at = new Date().toISOString();
    await Promise.all(
      [...new Set(accountIds)].map((accountId) =>
        this.firebase.db.runTransaction(async (tx) => {
          (await this.prepare(tx, accountId, input, at))();
        }),
      ),
    );
  }

  /** Marks every account's notifications about one thing read: it was decided, so they ask nothing more. */
  async readAboutAll(kind: AppNotificationKind, ref: string): Promise<void> {
    const records = (await this.inbox.notificationsAbout(ref)).filter((n) => n.kind === kind && !n.readAt);
    if (records.length) await this.inbox.markRead(records, new Date().toISOString());
  }

  /** Marks one thing's notification read, if the account has one unread (they opened what it was about). */
  async readAbout(accountId: string, kind: AppNotificationKind, ref: string): Promise<void> {
    const record = await this.inbox.notification(appNotificationId(accountId, kind, ref));
    if (record && !record.readAt) await this.inbox.markRead([record], new Date().toISOString());
  }
}

/** The caller's own notifications, and how they have them by email. */
@Injectable()
export class MyNotificationsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly inbox: InboxRepository,
    private readonly mail: MailRecords,
    private readonly settings: NoticeSettingsService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async view(accountId: string): Promise<MyNotificationsView> {
    const [records, unread] = await Promise.all([this.inbox.notificationsOf(accountId, APP_NOTIFICATIONS_SHOWN), this.inbox.unreadCount(accountId)]);
    return { unread, notifications: records.map(appNotificationView) };
  }

  async unread(accountId: string): Promise<{ unread: number }> {
    return { unread: await this.inbox.unreadCount(accountId) };
  }

  async read(accountId: string, notificationId: string): Promise<void> {
    const record = await this.inbox.notification(notificationId);
    if (!record) throw new NotFoundException('no such notification');
    if (record.accountId !== accountId) throw new ForbiddenException('this notification is someone else’s');
    await this.inbox.markRead([record], new Date().toISOString());
  }

  async readAll(accountId: string): Promise<MyNotificationsView> {
    const records = await this.inbox.notificationsOf(accountId, READ_ALL_LIMIT);
    await this.inbox.markRead(records, new Date().toISOString());
    return this.view(accountId);
  }

  async emailView(accountId: string): Promise<NotificationEmailView> {
    const [preference, mail, settings] = await Promise.all([this.inbox.preference(accountId), this.mail.state(accountId), this.settings.current()]);
    return {
      notificationEmail: preference?.notificationEmail ?? 'off',
      digestDueAt: preference?.digestDueAt ?? null,
      mail: mail.state,
      sending: this.config.mailTransport !== 'off' && settings.allEmails && settings.emails.notifications,
    };
  }

  async setEmail(accountId: string, choice: NotificationEmailChoice): Promise<NotificationEmailView> {
    await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.inbox.preference(accountId, tx);
      this.inbox.setPreference(tx, inboxPreference(current, accountId, choice, new Date()));
    });
    return this.emailView(accountId);
  }
}

/** What other contexts may ask of the inbox: forgetting a deleted account's (design §4). */
@Injectable()
export class InboxRecords {
  constructor(
    private readonly inbox: InboxRepository,
    private readonly membership: MembershipInboxRepository,
  ) {}

  /**
   * Its notifications, messages and the rest (`InboxRepository.forgetAccount`), and its conversations with the membership
   * team, with the Membership Admins' notifications about them. What it wrote as a Membership Admin stays, in the
   * conversations of the members it wrote to.
   */
  async forgetAccount(accountId: string): Promise<void> {
    const threads = await this.membership.forgetMember(accountId);
    await Promise.all([this.inbox.forgetAccount(accountId), this.inbox.deleteNotificationsAbout(threads)]);
  }
}
