import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { API_KEY_SECRETS, type ApiKeyName } from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { SECRET_STORE, type SecretStore, type SecretVersion } from '../infra/secret-store.js';

const CACHE_MS = 60_000;

/** gRPC NOT_FOUND: no such secret, or it has no version. FAILED_PRECONDITION: its newest version was destroyed (removed). */
const NOT_FOUND = 5;
const NO_KEY = new Set([NOT_FOUND, 9]);
/** gRPC PERMISSION_DENIED: Terraform has not yet given the api its roles on the secret. */
const PERMISSION_DENIED = 7;

const grpcCode = (e: unknown) => (e as { code?: number }).code ?? -1;

/** The keys the public-records adapter sends (`PublicContactSource`): the FEC's shared DEMO_KEY when there is none. */
export interface ContactKeys {
  readonly fec: string;
  readonly openStates: string | null;
  readonly civic: string | null;
}

/**
 * The public-records services' keys (design §5.6): the one a System Admin added in the app, kept as the newest version
 * of its Secret Manager secret, else the deployment's own (`FEC_API_KEY`, `OPENSTATES_API_KEY`,
 * `GOOGLE_CIVIC_API_KEY`). Unlike the Anthropic key, the api reads these itself, since it is the api that asks the
 * services. Each is kept a minute, so a key added or removed counts on every instance within a minute, without a
 * release.
 */
@Injectable()
export class ApiKeys {
  private readonly logger = new Logger(ApiKeys.name);
  private readonly cache = new Map<ApiKeyName, { readonly at: number; readonly value: Promise<string | null> }>();

  constructor(
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** The deployment's own key, from its settings; null when it has none (the FEC's DEMO_KEY is none). */
  deployment(name: ApiKeyName): string | null {
    if (name === 'fec') return this.config.fecApiKey === 'DEMO_KEY' ? null : this.config.fecApiKey;
    return name === 'openstates' ? this.config.openStatesApiKey : this.config.civicApiKey;
  }

  /** The key in use: the one added in the app, else the deployment's; null when there is neither. */
  async value(name: ApiKeyName): Promise<string | null> {
    return (await this.added(name)) ?? this.deployment(name);
  }

  async contactKeys(): Promise<ContactKeys> {
    const [fec, openStates, civic] = await Promise.all([this.value('fec'), this.value('openstates'), this.value('civic')]);
    return { fec: fec ?? 'DEMO_KEY', openStates, civic };
  }

  /** The newest version of the key added in the app, without its value, for the panel; null when none was added. */
  async version(name: ApiKeyName): Promise<SecretVersion | null> {
    try {
      return await this.secrets.latest(API_KEY_SECRETS[name]);
    } catch (e) {
      if (grpcCode(e) === NOT_FOUND) return null;
      if (grpcCode(e) === PERMISSION_DENIED) {
        throw new ServiceUnavailableException(
          `this server may not look at the ${API_KEY_SECRETS[name]} secret yet: apply the Terraform that creates it (README "API keys")`,
        );
      }
      throw e;
    }
  }

  invalidate(name: ApiKeyName): void {
    this.cache.delete(name);
  }

  /**
   * The key added in the app, null when there is none. When Secret Manager cannot be asked (the Terraform not applied
   * yet, say) the deployment's key is used and the reason logged, rather than leaving the pages without their records.
   */
  private added(name: ApiKeyName): Promise<string | null> {
    const hit = this.cache.get(name);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = this.secrets.read(API_KEY_SECRETS[name]).catch((e: unknown) => {
      if (!NO_KEY.has(grpcCode(e))) this.logger.warn(`could not read the ${name} key added in the app: ${(e as Error).message}`);
      return null;
    });
    this.cache.set(name, { at: Date.now(), value });
    return value;
  }
}
