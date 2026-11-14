import type { CourseMap, DiscordAppView, DiscordCommandData, DiscordCommandName, DiscordOpenVote, PublicBillCard, PublicEventsPage, PublicNewsSummary } from 'ustp-domain';

/** How long an answer's data is kept: the site's pages change by the minute at most. */
const DATA_MS = 60_000;
/** The application's key changes only when the party makes a new application. */
const KEY_MS = 10 * 60_000;
/** A missing key is asked for again soon: the worker may be about to keep it. */
const NO_KEY_MS = 5_000;
/** One request to the site may take this long; the answer to Discord does not wait for it (interactions.ts). */
const FETCH_MS = 8_000;

interface Kept<T> {
  readonly at: number;
  readonly value: Promise<T>;
}

/**
 * The site's public api, as any visitor reads it (design §10.18): this service holds no credentials. What it reads is
 * kept for a minute, so most commands are answered without asking the site at all.
 */
export class Site {
  private readonly data = new Map<DiscordCommandName, Kept<DiscordCommandData>>();
  private key: (Kept<string | null> & { found?: boolean }) | null = null;

  constructor(
    /** The web app's origin: answers link there, and Hosting serves the api under `/v1`. */
    readonly origin: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** The key Discord signs with; null until the worker has read it from Discord. `fresh` asks the site again. */
  publicKey(fresh = false): Promise<string | null> {
    const kept = this.key;
    if (kept && !fresh && this.now() - kept.at < (kept.found === false ? NO_KEY_MS : KEY_MS)) return kept.value;
    const entry: Kept<string | null> & { found?: boolean } = {
      at: this.now(),
      value: this.get<DiscordAppView>('/v1/public/discord/app').then(
        (app) => {
          entry.found = !!app.publicKey;
          return app.publicKey;
        },
        () => {
          entry.found = false;
          return null;
        },
      ),
    };
    this.key = entry;
    return entry.value;
  }

  /** How long ago the key was asked for, so a failed check can ask again without asking on every forged request. */
  keyAge(): number {
    return this.key ? this.now() - this.key.at : Infinity;
  }

  /** What a command answers from. A failed read is not kept. */
  command(name: DiscordCommandName): Promise<DiscordCommandData> {
    const kept = this.data.get(name);
    if (kept && this.now() - kept.at < DATA_MS) return kept.value;
    const value = this.read(name);
    this.data.set(name, { at: this.now(), value });
    value.catch(() => {
      if (this.data.get(name)?.value === value) this.data.delete(name);
    });
    return value;
  }

  private async read(command: DiscordCommandName): Promise<DiscordCommandData> {
    switch (command) {
      case 'vote':
        return { command, votes: await this.get<DiscordOpenVote[]>('/v1/public/discord/votes') };
      case 'events':
        return { command, page: await this.get<PublicEventsPage>('/v1/public/events') };
      case 'news':
        return { command, posts: await this.get<PublicNewsSummary[]>('/v1/news') };
      case 'bills':
        return { command, bills: await this.get<PublicBillCard[]>('/v1/public/bills') };
      case 'courses':
        return { command, map: await this.get<CourseMap>('/v1/public/courses') };
      case 'join':
      case 'link':
      case 'help':
        return { command };
    }
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetcher(`${this.origin}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_MS) });
    if (!res.ok) throw new Error(`${res.status} from ${path}`);
    return (await res.json()) as T;
  }
}
