import type { Provider } from '@nestjs/common';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { MailEventRecorder } from './mail-events.js';
import { MailRecords } from './mail-records.js';
import { MAIL_EVENT_SOURCE, MAIL_TRANSPORT, OutboxMailEvents, OutboxTransport, type MailEventSource, type MailTransport } from './mail-transport.js';
import { MailRepository } from './mail.repository.js';
import { Mailer } from './mailer.js';
import { NoticeSettingsService } from './notice-settings.js';
import { NoticeSender } from './notice-sender.js';
import { NoticeRepository } from './notice.repository.js';
import { NoticesService } from './notices.service.js';
import { SesEventQueue, sesMailEvent, SesTransport } from './ses.js';
import { WelcomeEmails } from './welcome-emails.js';
import { WelcomeSender } from './welcome-sender.js';

/**
 * The notifications context (design §6.8). The api reads counts and starts resends; only the worker sends and reads the
 * provider's delivery reports, so only it gets the mail transport and its credentials. Elections use
 * `NoticesService.forgetElection` when one is deleted, membership `WelcomeEmails` when a Membership Admin adds a member
 * (§5.13), and accounts `MailRecords` when one is deleted (§4).
 */
export const NOTIFICATION_API_PROVIDERS: Provider[] = [
  NoticeRepository,
  MailRepository,
  MailRecords,
  NoticeSettingsService,
  NoticesService,
  WelcomeEmails,
];

export const NOTIFICATION_WORKER_PROVIDERS: Provider[] = [
  NoticeRepository,
  MailRepository,
  NoticeSettingsService,
  Mailer,
  MailEventRecorder,
  NoticeSender,
  WelcomeSender,
  {
    provide: MAIL_TRANSPORT,
    inject: [CONFIG, Firebase],
    useFactory: (config: ServerConfig, firebase: Firebase): MailTransport | null =>
      config.mailTransport === 'ses'
        ? SesTransport.fromConfig(config)
        : config.mailTransport === 'outbox'
          ? new OutboxTransport(firebase.db, { actOut: true, configurationSet: config.ses.configurationSet })
          : null,
  },
  {
    provide: MAIL_EVENT_SOURCE,
    inject: [CONFIG, Firebase],
    useFactory: (config: ServerConfig, firebase: Firebase): MailEventSource | null =>
      config.mailTransport === 'ses'
        ? SesEventQueue.fromConfig(config)
        : config.mailTransport === 'outbox'
          ? new OutboxMailEvents(firebase.db, sesMailEvent)
          : null,
  },
];
