import type { Provider } from '@nestjs/common';
import { InboxRepository } from './inbox.repository.js';
import { InboxNotices, InboxRecords, MyNotificationsService } from './inbox.service.js';
import { MessagesService } from './messages.service.js';
import { NotificationMailer } from './notification-mailer.js';

/**
 * The inbox context (design §10.13): in-app notifications, messages between members, and notifications by email. Other
 * contexts notify an account through `InboxNotices`, and accounts forget a deleted one's through `InboxRecords`. Only
 * the worker emails notifications, through the notifications context's `Mailer`.
 */
export const INBOX_API_PROVIDERS: Provider[] = [InboxRepository, InboxNotices, InboxRecords, MyNotificationsService, MessagesService];

export const INBOX_WORKER_PROVIDERS: Provider[] = [InboxRepository, NotificationMailer];
