import { Inject, Injectable, Logger } from '@nestjs/common';
import { Collections, type DiscordAppState } from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';

/** How long the ping waits: longer than the commands service takes to start, so a cold start is seen through. */
const TIMEOUT_MS = 10_000;
/** An answer slower than this means the service was not running and the ping started it. */
const COLD_MS = 1_000;

/**
 * Keeps the Discord commands service running (design §10.18, "Kept awake"), a step of the worker's tick. Discord waits
 * three seconds for the answer to a command, and the service takes longer than that to start once Cloud Run has stopped
 * it for want of requests; so the tick asks for its `/health` every minute, which costs a few cents a month where a
 * kept instance costs dollars. Only once Discord has the address: before that no command can arrive.
 *
 * It is a help, not a promise: Cloud Run may stop the service anyway, and each release starts a new one. The person is
 * then asked to try again, and the next ping starts it.
 */
@Injectable()
export class DiscordKeepWarm {
  private readonly logger = new Logger(DiscordKeepWarm.name);
  /** Replaced in tests. */
  fetcher: typeof fetch = fetch;

  constructor(
    private readonly firebase: Firebase,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Whether the service was found stopped, and so started. A service that does not answer is logged, not a failure. */
  async ping(): Promise<boolean> {
    const endpoint = this.config.discordInteractionsUrl;
    if (this.config.discord === 'off' || !endpoint) return false;
    const state = (await this.firebase.db.collection(Collections.discordState).doc('app').get()).data() as DiscordAppState | undefined;
    if (!state?.endpointSet) return false;

    const started = Date.now();
    let problem: string | null = null;
    try {
      const res = await this.fetcher(new URL('/health', endpoint), { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) problem = `it answered ${res.status}`;
    } catch {
      problem = 'it did not answer in time';
    }
    if (problem) {
      this.logger.warn({ message: `Discord commands service: ${problem}` });
      return false;
    }
    return Date.now() - started > COLD_MS;
  }
}
