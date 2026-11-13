import type { Provider } from '@nestjs/common';
import { DiscordAdminService, DiscordTokenAdminService } from './discord-admin.js';
import { discordApiProvider } from './discord-api.js';
import { DiscordCommandSync } from './discord-commands.js';
import { DiscordFeed } from './discord-feed.js';
import { DiscordPublic } from './discord-public.js';
import { DiscordSettingsService } from './discord-settings.js';
import { DiscordToken } from './discord-token.js';

/** What the api needs of the Discord bot (design §10.18): its settings, its token's status, trying a new token, and what the commands service reads. */
export const DISCORD_PROVIDERS: Provider[] = [DiscordSettingsService, DiscordToken, DiscordAdminService, DiscordTokenAdminService, DiscordPublic, discordApiProvider];

/** What the worker's tick needs: the settings, the token itself, the feed that posts, and telling Discord of the commands (design §13). */
export const DISCORD_WORKER_PROVIDERS: Provider[] = [DiscordSettingsService, DiscordToken, DiscordFeed, DiscordCommandSync, discordApiProvider];
