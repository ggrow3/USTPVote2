import type { Provider } from '@nestjs/common';
import { BotsService } from './bots.service.js';
import { CalendarService } from './calendar.service.js';
import { CommunicationsRepository } from './communications.repository.js';
import { NewsService } from './news.service.js';
import { PressKitService } from './press-kit.service.js';
import { ShareKitService } from './share-kit.service.js';
import { SuggestionsService } from './suggestions.service.js';

/** Everything the communications context provides, for the API module to register (design §3.3, §10.7). */
export const COMMUNICATIONS_PROVIDERS: Provider[] = [
  CommunicationsRepository,
  NewsService,
  ShareKitService,
  CalendarService,
  SuggestionsService,
  PressKitService,
  BotsService,
];

/** What the worker's tick needs: deleting suggestions a year old (design §13). */
export const COMMUNICATIONS_WORKER_PROVIDERS: Provider[] = [CommunicationsRepository, SuggestionsService];
