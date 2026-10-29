import type { Provider } from '@nestjs/common';
import { ForumRepository } from './forum.repository.js';
import { ForumService } from './forum.service.js';

/** Everything the forum context provides, for the API module to register (design §3.3, §5.9). */
export const FORUM_PROVIDERS: Provider[] = [ForumRepository, ForumService];
