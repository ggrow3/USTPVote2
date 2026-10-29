import type { Provider } from '@nestjs/common';
import { TeamRepository } from './team.repository.js';
import { TeamsService } from './teams.service.js';

/** Everything the teams context provides, for the API module to register (design §3.3, §5.7). */
export const TEAMS_PROVIDERS: Provider[] = [TeamRepository, TeamsService];
