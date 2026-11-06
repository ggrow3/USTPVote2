import type { Provider } from '@nestjs/common';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { MailHealthService } from './mail-admin.controller.js';
import { MailEventRecorder } from './mail-events.js';
import { MailRequestSender } from './mail-requests.js';
import { DNS_TXT, dnsTxt, IDENTITY_PLATFORM, MailHealthChecker, SES_ACCOUNT } from './mail-health.js';
import { MailRecords } from './mail-records.js';
import { MAIL_EVENT_SOURCE, MAIL_TRANSPORT, OutboxMailEvents, OutboxTransport, type MailEventSource, type MailTransport } from './mail-transport.js';
import { MailRepository } from './mail.repository.js';
import { Mailer } from './mailer.js';
import { NoticeSettingsService } from './notice-settings.js';
import { NoticeSender } from './notice-sender.js';
import { NoticeRepository } from './notice.repository.js';
import { NoticesService } from './notices.service.js';
import { SendVerifier } from './send-verification.js';
import { MyEmailService } from './my-email.js';
import { IdentityPlatformReader, SesAccountReader } from './ses-account.js';
import { SesEventQueue, sesMailEvent, SesTransport } from './ses.js';
import { WelcomeEmails } from './welcome-emails.js';
import { WelcomeSender } from './welcome-sender.js';

/**
 * The notifications context (design §6.8). The api reads counts and starts resends; only the worker sends, reads the
 * provider's delivery reports and checks how SES is set up (§10.12), so only it gets the mail transport and its
 * credentials. Elections use
 * `NoticesService.forgetElection` when one is deleted, membership `WelcomeEmails` when a Membership Admin adds a member
 * (§5.13), and accounts `MailRecords` when one is deleted (§4).
 */
export const NOTIFICATION_API_PROVIDERS: Provider[] = [
  NoticeRepository,
  MailRepository,
  MailRecords,
  MailHealthService,
  MyEmailService,
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
  MailHealthChecker,
  MailRequestSender,
  NoticeSender,
  SendVerifier,
  WelcomeSender,
  { provide: SES_ACCOUNT, inject: [CONFIG], useFactory: (config: ServerConfig) => SesAccountReader.fromConfig(config) },
  { provide: IDENTITY_PLATFORM, inject: [CONFIG], useFactory: (config: ServerConfig) => IdentityPlatformReader.fromConfig(config) },
  { provide: DNS_TXT, useValue: dnsTxt },
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
