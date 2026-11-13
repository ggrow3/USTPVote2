import type { AnthropicKeyStatus, ApiKeyName, ApiKeysStatus, DiscordTokenStatus } from 'ustp-domain';
import { api } from '../api.js';

/** The Anthropic API key for the Claude checks (design §5.6). System Admins only; no route ever returns the key. */
const ROUTE = '/v1/admin/anthropic-key';

export function anthropicKeyStatus(): Promise<AnthropicKeyStatus> {
  return api<AnthropicKeyStatus>('GET', ROUTE);
}

/** Tries the key with Anthropic and keeps it in place of any before it; refused (422, 502) if Anthropic will not take it. */
export function addAnthropicKey(key: string): Promise<AnthropicKeyStatus> {
  return api<AnthropicKeyStatus>('PUT', ROUTE, { key });
}

export function removeAnthropicKey(): Promise<AnthropicKeyStatus> {
  return api<AnthropicKeyStatus>('DELETE', ROUTE);
}

/** The public-records services' keys (design §5.6). System Admins only; no route ever returns a key. */
const KEYS = '/v1/admin/api-keys';

export function apiKeysStatus(): Promise<ApiKeysStatus> {
  return api<ApiKeysStatus>('GET', KEYS);
}

/** Tries the key with its service and keeps it in place of any added before; refused (422, 502) if the service will not take it. */
export function addApiKey(name: ApiKeyName, key: string): Promise<ApiKeysStatus> {
  return api<ApiKeysStatus>('PUT', `${KEYS}/${name}`, { key });
}

export function removeApiKey(name: ApiKeyName): Promise<ApiKeysStatus> {
  return api<ApiKeysStatus>('DELETE', `${KEYS}/${name}`);
}

/** The Discord bot's token (design §10.18). System Admins only; no route ever returns the token. */
const DISCORD_TOKEN = '/v1/admin/discord-token';

export function discordTokenStatus(): Promise<DiscordTokenStatus> {
  return api<DiscordTokenStatus>('GET', DISCORD_TOKEN);
}

/** Tries the token with Discord and keeps it in place of any before it; refused (422, 502) if Discord will not take it. */
export function addDiscordToken(token: string): Promise<DiscordTokenStatus> {
  return api<DiscordTokenStatus>('PUT', DISCORD_TOKEN, { token });
}

export function removeDiscordToken(): Promise<DiscordTokenStatus> {
  return api<DiscordTokenStatus>('DELETE', DISCORD_TOKEN);
}
