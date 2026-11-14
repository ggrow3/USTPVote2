import type { Firestore } from 'firebase-admin/firestore';
import { Collections, DISCORD_ID } from 'ustp-domain';
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
 * Whether Discord changed a member's role. `not_in_server`: the person has not joined the party's server.
 * `not_allowed`: the bot lacks Manage Roles, or its own role is below the one it should give. `retry`: try later.
 */
export type DiscordRoleChange =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not_in_server' | 'not_allowed' | 'no_such_role' | 'retry'; readonly problem: string };

/** Who signed in to Discord for a link: their ID there and the name they show. */
export type DiscordSignIn =
  | { readonly ok: true; readonly id: string; readonly name: string | null }
  | { readonly ok: false; readonly refusal: 'rejected' | 'unreachable'; readonly problem: string };

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
  /** Changes a message the bot posted. */
  edit(token: string, channelId: string, messageId: string, message: Readonly<Record<string, unknown>>): Promise<DiscordSend>;
  /** Pins a message in its channel (the bot needs Pin Messages there). */
  pin(token: string, channelId: string, messageId: string): Promise<DiscordDone>;
  /** Gives a member of the server a role (`held`), or takes it away. Giving a role already held is no error. */
  setRole(token: string, guildId: string, userId: string, roleId: string, held: boolean): Promise<DiscordRoleChange>;
  /**
   * Who a member signed in to Discord as (design §10.18, "Linking"): trades the code Discord sent them back with for a
   * pass, asks whose it is, and gives the pass up again. The bot's token plays no part; the client secret does.
   */
  signIn(applicationId: string, clientSecret: string, code: string, redirectUri: string): Promise<DiscordSignIn>;
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

  async edit(token: string, channelId: string, messageId: string, message: Readonly<Record<string, unknown>>): Promise<DiscordSend> {
    const res = await this.call(token, 'PATCH', `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, message);
    if (!res) return { ok: false, retry: true, problem: 'Discord could not be reached' };
    if (res.ok) return { ok: true, messageId };
    if (res.status === 429 || res.status >= 500) return { ok: false, retry: true, problem: `Discord is busy (${res.status})` };
    if (res.status === 404) return { ok: false, retry: false, problem: 'the message is no longer there' };
    return { ok: false, retry: false, problem: `Discord would not change the message (${res.status})` };
  }

  async pin(token: string, channelId: string, messageId: string): Promise<DiscordDone> {
    const res = await this.call(token, 'PUT', `/channels/${encodeURIComponent(channelId)}/messages/pins/${encodeURIComponent(messageId)}`);
    if (!res) return { ok: false, problem: 'Discord could not be reached' };
    if (res.ok) return { ok: true };
    if (res.status === 403) return { ok: false, problem: 'the bot may not pin in this channel: give it Pin Messages there' };
    return { ok: false, problem: `Discord would not pin the message (${res.status})` };
  }

  async setRole(token: string, guildId: string, userId: string, roleId: string, held: boolean): Promise<DiscordRoleChange> {
    const path = `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`;
    const res = await this.call(token, held ? 'PUT' : 'DELETE', path);
    if (!res) return { ok: false, reason: 'retry', problem: 'Discord could not be reached' };
    if (res.ok) return { ok: true };
    if (res.status === 429 || res.status >= 500) return { ok: false, reason: 'retry', problem: `Discord is busy (${res.status})` };
    // Discord's own code says which thing it does not know: 10007 the member, 10011 the role.
    const code = ((await res.json().catch(() => null)) as { code?: unknown } | null)?.code;
    if (code === 10007) return { ok: false, reason: 'not_in_server', problem: 'the person is not on the server' };
    if (code === 10011) return { ok: false, reason: 'no_such_role', problem: 'Discord knows no such role: check the role ID' };
    if (res.status === 403) {
      return { ok: false, reason: 'not_allowed', problem: 'the bot may not change this role: give it Manage Roles, and put its own role above the Member role' };
    }
    if (res.status === 401) return { ok: false, reason: 'not_allowed', problem: "Discord did not accept the bot's token" };
    return { ok: false, reason: 'no_such_role', problem: 'Discord knows no such server or role: check the server ID and the role ID' };
  }

  async signIn(applicationId: string, clientSecret: string, code: string, redirectUri: string): Promise<DiscordSignIn> {
    const unreachable = { ok: false, refusal: 'unreachable', problem: 'Discord could not be reached just now; try again shortly' } as const;
    const form = (fields: Record<string, string>): RequestInit => ({
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${applicationId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    try {
      const traded = await this.fetcher(`${BASE}/oauth2/token`, form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }));
      if (traded.status === 401) {
        return { ok: false, refusal: 'rejected', problem: "Discord did not accept the application's client secret: a System Admin adds it again under Admin › API keys" };
      }
      if (traded.status === 429 || traded.status >= 500) return unreachable;
      if (!traded.ok) return { ok: false, refusal: 'rejected', problem: 'Discord did not accept the sign-in: start again from the Account page' };
      const pass = ((await traded.json().catch(() => null)) as { access_token?: unknown } | null)?.access_token;
      if (typeof pass !== 'string' || !pass) return unreachable;
      try {
        const who = await this.fetcher(`${BASE}/users/@me`, {
          headers: { Authorization: `Bearer ${pass}`, 'User-Agent': this.userAgent },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!who.ok) return unreachable;
        const user = (await who.json().catch(() => null)) as { id?: unknown; username?: unknown; global_name?: unknown } | null;
        if (typeof user?.id !== 'string' || !DISCORD_ID.test(user.id)) return unreachable;
        const name = typeof user.global_name === 'string' && user.global_name ? user.global_name : typeof user.username === 'string' ? user.username : null;
        return { ok: true, id: user.id, name };
      } finally {
        // The pass is needed for nothing more: give it up, so nothing that could read the person's profile is left.
        await this.fetcher(`${BASE}/oauth2/token/revoke`, form({ token: pass, token_type_hint: 'access_token' })).catch(() => null);
      }
    } catch {
      return unreachable;
    }
  }

  private get userAgent(): string {
    return `DiscordBot (${this.site ?? 'https://discord.com'}, 1.0)`;
  }

  /** The response, or null when Discord could not be reached in time. */
  private async call(token: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<Response | null> {
    try {
      return await this.fetcher(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bot ${token}`,
          'User-Agent': this.userAgent,
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

/** A person the stand-in does not find on the server, so that can be tried without Discord. */
export const STUB_NOT_IN_SERVER = '000000000000000001';
/** A role the stand-in may not change. */
export const STUB_FORBIDDEN_ROLE = '000000000000000002';

/**
 * The stand-in's sign-in: the code names the person (`stub:{id}:{name}`), as if Discord had sent them back with it.
 * Any other code is refused.
 */
export const stubSignInCode = (id: string, name: string): string => `stub:${id}:${name}`;

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

  async edit(_token: string, channelId: string, messageId: string, message: Readonly<Record<string, unknown>>): Promise<DiscordSend> {
    const ref = this.db.collection(Collections.discordOutbox).doc(messageId);
    if (!(await ref.get()).exists) return { ok: false, retry: false, problem: 'the message is no longer there' };
    await ref.update({ channelId, message, editedAt: new Date().toISOString() });
    return { ok: true, messageId };
  }

  async pin(_token: string, _channelId: string, messageId: string): Promise<DiscordDone> {
    await this.db.collection(Collections.discordOutbox).doc(messageId).update({ pinned: true });
    return { ok: true };
  }

  /** Recorded as `discord_outbox/role:{userId}`: whether the person holds the role. */
  async setRole(_token: string, guildId: string, userId: string, roleId: string, held: boolean): Promise<DiscordRoleChange> {
    if (userId === STUB_NOT_IN_SERVER) return { ok: false, reason: 'not_in_server', problem: 'the person is not on the server' };
    if (roleId === STUB_FORBIDDEN_ROLE) {
      return { ok: false, reason: 'not_allowed', problem: 'the bot may not change this role: give it Manage Roles, and put its own role above the Member role' };
    }
    await this.db.collection(Collections.discordOutbox).doc(`role:${userId}`).set({ guildId, roleId, held, at: new Date().toISOString() });
    return { ok: true };
  }

  async signIn(_applicationId: string, _clientSecret: string, code: string): Promise<DiscordSignIn> {
    const [, id, name] = /^stub:(\d{17,20}):(.*)$/.exec(code) ?? [];
    if (!id) return { ok: false, refusal: 'rejected', problem: 'Discord did not accept the sign-in: start again from the Account page' };
    return { ok: true, id, name: name || null };
  }
}

/** Null when the deployment has the bot off (`DISCORD=off`). */
export const discordApiProvider = {
  provide: DISCORD_API,
  inject: [CONFIG, Firebase],
  useFactory: (config: ServerConfig, firebase: Firebase): DiscordApi | null =>
    config.discord === 'live' ? new HttpDiscordApi(config.webOrigin) : config.discord === 'stub' ? new RecordingDiscordApi(firebase.db) : null,
};
