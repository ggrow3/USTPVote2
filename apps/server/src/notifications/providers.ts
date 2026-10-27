import type { Provider } from '@nestjs/common';
import { mailTransportProvider } from './mail-transport.js';
import { NoticeSender } from './notice-sender.js';
import { NoticeRepository } from './notice.repository.js';
import { NoticesService } from './notices.service.js';

/**
 * The notifications context (design §6.7). The api reads counts and starts resends; only the worker sends, so only it
 * gets the mail transport and its credentials. Elections use `NoticeRepository.deleteForElection` when one is deleted.
 */
export const NOTIFICATION_API_PROVIDERS: Provider[] = [NoticeRepository, NoticesService];

export const NOTIFICATION_WORKER_PROVIDERS: Provider[] = [NoticeRepository, NoticeSender, mailTransportProvider];
