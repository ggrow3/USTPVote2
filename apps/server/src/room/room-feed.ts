import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { RoomRepository } from './room.repository.js';

/** After the listener fails, how long requests wait on a timer before it is tried again, and how long each waits. */
const LISTENER_RETRY_MS = 30_000;
const FALLBACK_WAIT_MS = 5_000;
/** The listener stays this long after the last request stopped waiting, for the pages that ask again at once. */
const LINGER_MS = 30_000;

interface Waiter {
  readonly since: number;
  readonly done: () => void;
}

/**
 * Wakes requests waiting for the room's next change (design §5.10): browsers cannot listen to Firestore and Hosting
 * does not carry WebSockets, so a page asks for updates and the api holds the request until the feed number passes
 * the page's, or the wait runs out. One Firestore listener on `room_state/feed` per api instance serves every waiting
 * request, while one is waiting and `LINGER_MS` after, since each page asks again as soon as it is answered.
 */
@Injectable()
export class RoomFeedWatcher implements OnModuleDestroy {
  private readonly logger = new Logger(RoomFeedWatcher.name);
  private readonly waiters = new Set<Waiter>();
  private stop: (() => void) | null = null;
  /** The feed number the listener last saw; -1 until its first snapshot. */
  private latest = -1;
  /** When the listener last failed: for a while after, requests wait on a timer instead, so pages do not spin. */
  private failedAt = 0;
  private lingering: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly repo: RoomRepository) {}

  /** Resolves when the feed passes `since`, or after `ms`. */
  wait(since: number, ms: number): Promise<void> {
    if (this.stop && this.latest > since) return Promise.resolve();
    if (Date.now() - this.failedAt < LISTENER_RETRY_MS) return new Promise((resolve) => setTimeout(resolve, Math.min(ms, FALLBACK_WAIT_MS)));
    return new Promise((resolve) => {
      const timer = setTimeout(() => waiter.done(), ms);
      const waiter: Waiter = {
        since,
        done: () => {
          clearTimeout(timer);
          this.waiters.delete(waiter);
          if (!this.waiters.size) this.linger();
          resolve();
        },
      };
      this.waiters.add(waiter);
      this.watch();
    });
  }

  private linger(): void {
    clearTimeout(this.lingering);
    this.lingering = setTimeout(() => {
      if (!this.waiters.size) this.unwatch();
    }, LINGER_MS);
    this.lingering.unref();
  }

  private watch(): void {
    clearTimeout(this.lingering);
    if (this.stop) return;
    this.stop = this.repo.watchFeed(
      (seq) => {
        this.latest = seq;
        for (const w of [...this.waiters]) if (seq > w.since) w.done();
      },
      (e) => {
        this.logger.warn(`room feed listener stopped: ${e.message}`);
        this.failedAt = Date.now();
        this.unwatch();
        for (const w of [...this.waiters]) w.done();
      },
    );
  }

  private unwatch(): void {
    this.stop?.();
    this.stop = null;
    this.latest = -1;
  }

  onModuleDestroy(): void {
    for (const w of [...this.waiters]) w.done();
    clearTimeout(this.lingering);
    this.unwatch();
  }
}
