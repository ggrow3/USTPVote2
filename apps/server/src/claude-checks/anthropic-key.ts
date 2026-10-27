import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ANTHROPIC_KEY_SECRET, type ClaudeCheckSwitch } from 'ustp-domain';
import { SECRET_STORE, type SecretStore, type SecretVersion } from '../infra/secret-store.js';

const CACHE_MS = 60_000;

/** gRPC NOT_FOUND: no such secret, or it has no version. FAILED_PRECONDITION: its newest version was destroyed (removed). */
const NOT_FOUND = 5;
const NO_KEY = new Set([NOT_FOUND, 9]);
/** gRPC PERMISSION_DENIED: Terraform has not yet given this service its role on the secret. */
const PERMISSION_DENIED = 7;

const grpcCode = (e: unknown) => (e as { code?: number }).code ?? -1;

/** What a request for a check is told when a System Admin has not added the key yet. */
export const NO_KEY_REASON = 'no Anthropic API key has been added (a System Admin adds one under Admin › Claude)';

/**
 * The Anthropic API key the Claude checks use (design §5.6), kept as the newest version of the `anthropic-api-key`
 * secret. The api asks only whether one is set (it cannot read it); the worker reads it each time it runs checks, so a
 * key a System Admin adds or removes counts from the next run.
 */
@Injectable()
export class AnthropicKey {
  private readonly logger = new Logger(AnthropicKey.name);
  private cache: { at: number; version: SecretVersion | null } | null = null;

  constructor(@Inject(SECRET_STORE) private readonly secrets: SecretStore) {}

  /** The version in use, without its value. Cached a minute, since every ballot page asks whether its check can run. */
  async current(options: { fresh?: boolean } = {}): Promise<SecretVersion | null> {
    if (!options.fresh && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.version;
    let version: SecretVersion | null;
    try {
      version = await this.secrets.latest(ANTHROPIC_KEY_SECRET);
    } catch (e) {
      if (grpcCode(e) === NOT_FOUND) version = null;
      else if (grpcCode(e) === PERMISSION_DENIED) {
        throw new ServiceUnavailableException(
          `this server may not look at the ${ANTHROPIC_KEY_SECRET} secret yet: apply the Terraform that grants it (README "Bylaws check")`,
        );
      } else throw e;
    }
    this.cache = { at: Date.now(), version };
    return version;
  }

  invalidate(): void {
    this.cache = null;
  }

  /**
   * Whether a check switched this way can run now: the stand-in always can, Claude once a key is set. If Secret Manager
   * cannot be asked, the check is simply not offered (and the reason logged), rather than failing every ballot page.
   */
  async ready(checker: ClaudeCheckSwitch): Promise<boolean> {
    if (checker !== 'claude') return checker === 'stub';
    try {
      return (await this.current()) !== null;
    } catch (e) {
      this.logger.warn(`could not tell whether an Anthropic API key is set: ${(e as Error).message}`);
      return false;
    }
  }

  /** The key itself, for the worker alone (the api's account may not read it); null when none is set. */
  async read(): Promise<string | null> {
    try {
      return await this.secrets.read(ANTHROPIC_KEY_SECRET);
    } catch (e) {
      if (NO_KEY.has(grpcCode(e))) return null;
      throw e;
    }
  }
}
