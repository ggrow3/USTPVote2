import type { Provider } from '@nestjs/common';
import { DiscordAdminService, DiscordTokenAdminService } from './discord-admin.js';
import { discordApiProvider } from './discord-api.js';
import { DiscordCommandSync } from './discord-commands.js';
import { DiscordFeed } from './discord-feed.js';
import { DiscordKeepWarm } from './discord-keep-warm.js';
import { DiscordLinkRecords, DiscordLinks } from './discord-links.js';
import { DiscordLoops } from './discord-loops.js';
import { DiscordRoles } from './discord-roles.js';
import { DiscordPublic } from './discord-public.js';
import { DiscordSettingsService } from './discord-settings.js';
import { DiscordToken } from './discord-token.js';

/** What the api needs of the Discord bot (design §10.18): its settings, its token's status, trying a new token, and what the commands service reads. */
export const DISCORD_PROVIDERS: Provider[] = [DiscordSettingsService, DiscordToken, DiscordAdminService, DiscordTokenAdminService, DiscordPublic, DiscordLinkRecords, DiscordLinks, discordApiProvider];

/** What the worker's tick needs: the settings, the token itself, the feed that posts, telling Discord of the commands, and keeping their service awake (design §13). */
export const DISCORD_WORKER_PROVIDERS: Provider[] = [DiscordSettingsService, DiscordToken, DiscordFeed, DiscordCommandSync, DiscordKeepWarm, DiscordRoles, DiscordLoops, discordApiProvider];
