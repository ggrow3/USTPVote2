import type { Provider } from '@nestjs/common';
import { InboxRepository } from './inbox.repository.js';
import { InboxNotices, InboxRecords, MyNotificationsService } from './inbox.service.js';
import { MembershipInboxRepository } from './membership-inbox.repository.js';
import { MembershipInboxService } from './membership-inbox.service.js';
import { MembershipMailer } from './membership-mailer.js';
import { MessagesService } from './messages.service.js';
import { NotificationMailer } from './notification-mailer.js';

/**
 * The inbox context (design §10.13): in-app notifications, messages between members, and notifications by email. Other
 * contexts notify an account through `InboxNotices`, and accounts forget a deleted one's through `InboxRecords`. Also the
 * membership inbox, the membership team's conversations with each member. Only the worker emails notifications and the
 * team's messages, through the notifications context's `Mailer`.
 */
export const INBOX_API_PROVIDERS: Provider[] = [
  InboxRepository,
  MembershipInboxRepository,
  InboxNotices,
  InboxRecords,
  MyNotificationsService,
  MessagesService,
  MembershipInboxService,
];

export const INBOX_WORKER_PROVIDERS: Provider[] = [InboxRepository, MembershipInboxRepository, NotificationMailer, MembershipMailer];
