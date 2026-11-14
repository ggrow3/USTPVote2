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

/** The bot's application, as Discord gives it: its ID and the key Discord signs each command with. */
export type DiscordApplication = { readonly ok: true; readonly applicationId: string; readonly publicKey: string } | { readonly ok: false; readonly problem: string };

/** Whether Discord took a change to the application. */
export type DiscordDone = { readonly ok: true } | { readonly ok: false; readonly problem: string };

/**
 * What the app asks of Discord (design §10.18): whose a token is, to post a message in a channel, and, for the slash
 * commands, what the application is, where to send its commands, and which commands it has.
 */
export interface DiscordApi {
  whoAmI(token: string): Promise<DiscordTrial>;
  send(token: string, channelId: string, message: Readonly<Record<string, unknown>>): Promise<DiscordSend>;
  application(token: string): Promise<DiscordApplication>;
  /** Discord calls the address before it answers, and refuses one that does not check its signature. */
  setInteractionsUrl(token: string, url: string): Promise<DiscordDone>;
  /** Replaces the application's commands, everywhere it is installed. */
  setCommands(token: string, applicationId: string, commands: readonly unknown[]): Promise<DiscordDone>;
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

  async application(token: string): Promise<DiscordApplication> {
    const res = await this.call(token, 'GET', '/applications/@me');
    if (!res) return { ok: false, problem: 'Discord could not be reached' };
    if (!res.ok) return { ok: false, problem: res.status === 401 ? "Discord did not accept the bot's token" : `Discord would not describe the application (${res.status})` };
    const body = (await res.json().catch(() => null)) as { id?: unknown; verify_key?: unknown } | null;
    if (typeof body?.id !== 'string' || typeof body.verify_key !== 'string' || !/^[0-9a-f]{64}$/i.test(body.verify_key)) {
      return { ok: false, problem: 'Discord described the application without its ID or key' };
    }
    return { ok: true, applicationId: body.id, publicKey: body.verify_key.toLowerCase() };
  }

  async setInteractionsUrl(token: string, url: string): Promise<DiscordDone> {
    const res = await this.call(token, 'PATCH', '/applications/@me', { interactions_endpoint_url: url });
    if (!res) return { ok: false, problem: 'Discord could not be reached' };
    if (res.ok) return { ok: true };
    // Discord calls the address with a signed and a wrongly signed request before it accepts it.
    if (res.status === 400) return { ok: false, problem: 'Discord called the commands address and did not get the answers it checks for' };
    return { ok: false, problem: `Discord would not take the commands address (${res.status})` };
  }

  async setCommands(token: string, applicationId: string, commands: readonly unknown[]): Promise<DiscordDone> {
    const res = await this.call(token, 'PUT', `/applications/${encodeURIComponent(applicationId)}/commands`, commands);
    if (!res) return { ok: false, problem: 'Discord could not be reached' };
    return res.ok ? { ok: true } : { ok: false, problem: `Discord would not take the list of commands (${res.status})` };
  }

  /** The response, or null when Discord could not be reached in time. */
  private async call(token: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown): Promise<Response | null> {
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

/** The stand-in's application: an ID and a key no real application has. */
export const STUB_APPLICATION = { applicationId: '100000000000000001', publicKey: '0f'.repeat(32) } as const;

/**
 * Emulator-only stand-in: each post is recorded in `discord_outbox` instead of sent, and the commands are taken
 * without a word. Refused outside the emulators.
 */
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

  async application(): Promise<DiscordApplication> {
    return { ok: true, ...STUB_APPLICATION };
  }

  async setInteractionsUrl(): Promise<DiscordDone> {
    return { ok: true };
  }

  async setCommands(): Promise<DiscordDone> {
    return { ok: true };
  }
}

/** Null when the deployment has the bot off (`DISCORD=off`). */
export const discordApiProvider = {
  provide: DISCORD_API,
  inject: [CONFIG, Firebase],
  useFactory: (config: ServerConfig, firebase: Firebase): DiscordApi | null =>
    config.discord === 'live' ? new HttpDiscordApi(config.webOrigin) : config.discord === 'stub' ? new RecordingDiscordApi(firebase.db) : null,
};
