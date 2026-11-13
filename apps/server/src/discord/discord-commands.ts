import { Inject, Injectable, Logger } from '@nestjs/common';
import { Collections, DISCORD_SYNC_RETRY_MINUTES, discordCommandsFingerprint, discordCommandsPayload, type DiscordAppState } from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { DISCORD_API, type DiscordApi } from './discord-api.js';
import { DiscordToken } from './discord-token.js';

/**
 * Tells Discord of the bot's slash commands (design §10.18, "Slash commands"), a step of the worker's tick. It has
 * work only when the token, the list of commands or the commands service's address is new: it then reads the
 * application from Discord (its ID and the key Discord signs commands with), keeps the key where the commands service
 * can read it, gives Discord the address to send commands to, and replaces the list of commands. What was done is kept
 * in `discord_state/app`; a try that did not finish is made again after two minutes.
 *
 * It does not wait for the bot to be switched on: the switch is for what the bot posts by itself, and a command only
 * answers the person who ran it, from what the site shows anyone.
 */
@Injectable()
export class DiscordCommandSync {
  private readonly logger = new Logger(DiscordCommandSync.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly token: DiscordToken,
    @Inject(DISCORD_API) private readonly discord: DiscordApi | null,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Whether Discord was told anything. */
  async sync(now: Date = new Date()): Promise<boolean> {
    const endpoint = this.config.discordInteractionsUrl;
    if (!this.discord || !endpoint) return false;
    const version = await this.token.current();
    if (!version) return false;

    const ref = this.firebase.db.collection(Collections.discordState).doc('app');
    const state = (await ref.get()).data() as DiscordAppState | undefined;
    const fingerprint = discordCommandsFingerprint(endpoint);
    if (state && state.tokenVersion === version.name && state.fingerprint === fingerprint) {
      if (state.registered && state.endpointSet) return false;
      if (now.getTime() - Date.parse(state.triedAt) < DISCORD_SYNC_RETRY_MINUTES * 60_000) return false;
    }

    const token = await this.token.read();
    if (!token) return false;
    const next = await this.tell(token, endpoint);
    await ref.set({ tokenVersion: version.name, fingerprint, triedAt: now.toISOString(), ...next } satisfies DiscordAppState);
    if (next.problem) this.logger.warn({ message: `Discord commands: ${next.problem}` });
    else this.logger.log({ message: 'Discord was told of the commands', commands: discordCommandsPayload().length });
    return true;
  }

  private async tell(token: string, endpoint: string): Promise<Pick<DiscordAppState, 'applicationId' | 'publicKey' | 'endpointSet' | 'registered' | 'problem'>> {
    const discord = this.discord!;
    const app = await discord.application(token);
    if (!app.ok) return { applicationId: null, publicKey: null, endpointSet: false, registered: false, problem: app.problem };
    const known = { applicationId: app.applicationId, publicKey: app.publicKey };
    // The key first: Discord calls the address before it accepts it, and the commands service answers with this key.
    await this.firebase.db.collection(Collections.discordState).doc('app').set({ ...known }, { merge: true });
    const address = await discord.setInteractionsUrl(token, endpoint);
    if (!address.ok) return { ...known, endpointSet: false, registered: false, problem: address.problem };
    const commands = await discord.setCommands(token, app.applicationId, discordCommandsPayload());
    return { ...known, endpointSet: true, registered: commands.ok, problem: commands.ok ? null : commands.problem };
  }
}
