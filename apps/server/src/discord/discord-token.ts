import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DISCORD_BOT_TOKEN_SECRET } from 'ustp-domain';
import { SECRET_STORE, type SecretStore, type SecretVersion } from '../infra/secret-store.js';

/** gRPC NOT_FOUND: no such secret, or it has no version. FAILED_PRECONDITION: its newest version was destroyed (removed). */
const NOT_FOUND = 5;
const NO_TOKEN = new Set([NOT_FOUND, 9]);
/** gRPC PERMISSION_DENIED: Terraform has not yet given this service its role on the secret. */
const PERMISSION_DENIED = 7;

const grpcCode = (e: unknown) => (e as { code?: number }).code ?? -1;

/**
 * The Discord bot's token (design §10.18), kept as the newest version of the `discord-bot-token` secret, as the
 * Anthropic API key is (§5.6). The api asks only whether one is set (it cannot read it); the worker reads it each time
 * it posts, so a token a System Admin adds or removes counts from the next tick.
 */
@Injectable()
export class DiscordToken {
  constructor(@Inject(SECRET_STORE) private readonly secrets: SecretStore) {}

  /** The version in use, without its value; null when none is set. */
  async current(): Promise<SecretVersion | null> {
    try {
      return await this.secrets.latest(DISCORD_BOT_TOKEN_SECRET);
    } catch (e) {
      if (grpcCode(e) === NOT_FOUND) return null;
      if (grpcCode(e) === PERMISSION_DENIED) {
        throw new ServiceUnavailableException(
          `this server may not look at the ${DISCORD_BOT_TOKEN_SECRET} secret yet: apply the Terraform that creates it and grants it (discord.tf)`,
        );
      }
      throw e;
    }
  }

  /**
   * The token and the name of its version, for the worker alone, which may read the secret but not list its versions
   * (so not `current`); null when none is set.
   */
  async readVersion(): Promise<{ readonly name: string; readonly value: string } | null> {
    try {
      return await this.secrets.readVersion(DISCORD_BOT_TOKEN_SECRET);
    } catch (e) {
      if (NO_TOKEN.has(grpcCode(e))) return null;
      throw e;
    }
  }

  /** The token itself, for the worker alone (the api's account may not read it); null when none is set. */
  async read(): Promise<string | null> {
    try {
      return await this.secrets.read(DISCORD_BOT_TOKEN_SECRET);
    } catch (e) {
      if (NO_TOKEN.has(grpcCode(e))) return null;
      throw e;
    }
  }
}
