import type { Provider } from '@nestjs/common';
import { DiscordAdminService, DiscordTokenAdminService } from './discord-admin.js';
import { discordApiProvider } from './discord-api.js';
import { DiscordFeed } from './discord-feed.js';
import { DiscordSettingsService } from './discord-settings.js';
import { DiscordToken } from './discord-token.js';

/** What the api needs of the Discord bot (design §10.18): its settings, its token's status, and trying a new token. */
export const DISCORD_PROVIDERS: Provider[] = [DiscordSettingsService, DiscordToken, DiscordAdminService, DiscordTokenAdminService, discordApiProvider];

/** What the worker's tick needs: the settings, the token itself, and the feed that posts (design §13). */
export const DISCORD_WORKER_PROVIDERS: Provider[] = [DiscordSettingsService, DiscordToken, DiscordFeed, discordApiProvider];
