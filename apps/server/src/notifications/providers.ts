import type { Provider } from '@nestjs/common';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { BOUNCE_SOURCE, MAIL_TRANSPORT, OutboxBounces, OutboxTransport, type BounceSource, type MailTransport } from './mail-transport.js';
import { NoticeSettingsService } from './notice-settings.js';
import { NoticeSender } from './notice-sender.js';
import { NoticeRepository } from './notice.repository.js';
import { NoticesService } from './notices.service.js';
import { SesBounceQueue, SesTransport } from './ses.js';
import { WelcomeEmails } from './welcome-emails.js';
import { WelcomeSender } from './welcome-sender.js';

/**
 * The notifications context (design §6.8). The api reads counts and starts resends; only the worker sends, so only it
 * gets the mail transport and its credentials. Elections use `NoticesService.forgetElection` when one is deleted, and
 * membership `WelcomeEmails` when a Membership Admin adds a member (§5.13).
 */
export const NOTIFICATION_API_PROVIDERS: Provider[] = [NoticeRepository, NoticeSettingsService, NoticesService, WelcomeEmails];

export const NOTIFICATION_WORKER_PROVIDERS: Provider[] = [
  NoticeRepository,
  NoticeSettingsService,
  NoticeSender,
  WelcomeSender,
  {
    provide: MAIL_TRANSPORT,
    inject: [CONFIG, Firebase],
    useFactory: (config: ServerConfig, firebase: Firebase): MailTransport | null =>
      config.mailTransport === 'ses'
        ? SesTransport.fromConfig(config)
        : config.mailTransport === 'outbox'
          ? new OutboxTransport(firebase.db)
          : null,
  },
  {
    provide: BOUNCE_SOURCE,
    inject: [CONFIG, Firebase],
    useFactory: (config: ServerConfig, firebase: Firebase): BounceSource | null =>
      config.mailTransport === 'ses'
        ? SesBounceQueue.fromConfig(config)
        : config.mailTransport === 'outbox'
          ? new OutboxBounces(firebase.db)
          : null,
  },
];
