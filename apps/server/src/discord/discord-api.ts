import type { Firestore } from 'firebase-admin/firestore';
import { Collections } from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';

/** Whether Discord took a token: it did (and whose bot it is), it refused it, or it could not be asked. */
export type DiscordTrial =
  | { readonly ok: true; readonly botName: string | null }
  | { readonly ok: false; readonly refusal: 'rejected' | 'unreachable'; readonly reason: string };

/** Whether Discord took a post. `retry`: it may take it later (it was busy, or could not be reached). */
export type DiscordSend = { readonly ok: true; readonly messageId: string } | { readonly ok: false; readonly retry: boolean; readonly problem: string };

/** What the app asks of Discord (design §10.18): whose a token is, and to post a message in a channel. */
export interface DiscordApi {
  whoAmI(token: string): Promise<DiscordTrial>;
  send(token: string, channelId: string, message: Readonly<Record<string, unknown>>): Promise<DiscordSend>;
}

export const DISCORD_API = Symbol('DiscordApi');

const BASE = 'https://discord.com/api/v10';
const TIMEOUT_MS = 10_000;

/**
 * Discord's HTTP API, as the bot. Nothing but the token, the channel and the post is sent. Discord's own error text is
 * not passed on: the admin card says what to do instead.
 */
export class HttpDiscordApi implements DiscordApi {
  constructor(
    /** Discord asks every bot to name itself and where it is from. */
    private readonly site: string | null,
    /** For tests (a fake `fetch`). */
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async whoAmI(token: string): Promise<DiscordTrial> {
    const res = await this.call(token, 'GET', '/users/@me');
    if (!res) return { ok: false, refusal: 'unreachable', reason: 'Discord could not be asked about this token just now; nothing was saved, so try again shortly' };
    if (res.status === 401) return { ok: false, refusal: 'rejected', reason: 'Discord did not accept this token: check that it is complete, and that it was not reset since' };
    if (!res.ok) return { ok: false, refusal: 'unreachable', reason: 'Discord could not be asked about this token just now; nothing was saved, so try again shortly' };
    const body = (await res.json().catch(() => null)) as { username?: unknown; bot?: unknown } | null;
    if (body?.bot !== true) return { ok: false, refusal: 'rejected', reason: "this token is a person's, not a bot's: copy the token from the application's Bot page" };
    return { ok: true, botName: typeof body.username === 'string' ? body.username : null };
  }

  async send(token: string, channelId: string, message: Readonly<Record<string, unknown>>): Promise<DiscordSend> {
    const res = await this.call(token, 'POST', `/channels/${encodeURIComponent(channelId)}/messages`, message);
    if (!res) return { ok: false, retry: true, problem: 'Discord could not be reached' };
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
      return typeof body?.id === 'string' ? { ok: true, messageId: body.id } : { ok: false, retry: false, problem: 'Discord took the post but gave no message back' };
    }
    if (res.status === 429 || res.status >= 500) return { ok: false, retry: true, problem: `Discord is busy (${res.status})` };
    if (res.status === 401) return { ok: false, retry: false, problem: "Discord did not accept the bot's token: a System Admin adds a new one under Admin › API keys" };
    if (res.status === 403) {
      return { ok: false, retry: false, problem: 'the bot may not post in this channel: give it View Channel, Send Messages and Embed Links there' };
    }
    if (res.status === 404) return { ok: false, retry: false, problem: 'Discord knows no such channel: check the channel ID, and that the bot has joined the server' };
    return { ok: false, retry: false, problem: `Discord refused the post (${res.status})` };
  }

  /** The response, or null when Discord could not be reached in time. */
  private async call(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response | null> {
    try {
      return await this.fetcher(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bot ${token}`,
          'User-Agent': `DiscordBot (${this.site ?? 'https://discord.com'}, 1.0)`,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return null;
    }
  }
}

/** A channel the stand-in refuses as Discord refuses one it does not know, so that can be tried without Discord. */
export const STUB_UNKNOWN_CHANNEL = '000000000000000000';

/** Emulator-only stand-in: each post is recorded in `discord_outbox` instead of sent. Refused outside the emulators. */
export class RecordingDiscordApi implements DiscordApi {
  constructor(private readonly db: Firestore) {}

  async whoAmI(): Promise<DiscordTrial> {
    return { ok: true, botName: null };
  }

  async send(_token: string, channelId: string, message: Readonly<Record<string, unknown>>): Promise<DiscordSend> {
    if (channelId === STUB_UNKNOWN_CHANNEL) return { ok: false, retry: false, problem: 'Discord knows no such channel: check the channel ID, and that the bot has joined the server' };
    const ref = this.db.collection(Collections.discordOutbox).doc();
    await ref.create({ channelId, message, at: new Date().toISOString() });
    return { ok: true, messageId: ref.id };
  }
}

/** Null when the deployment has the bot off (`DISCORD=off`). */
export const discordApiProvider = {
  provide: DISCORD_API,
  inject: [CONFIG, Firebase],
  useFactory: (config: ServerConfig, firebase: Firebase): DiscordApi | null =>
    config.discord === 'live' ? new HttpDiscordApi(config.webOrigin) : config.discord === 'stub' ? new RecordingDiscordApi(firebase.db) : null,
};
