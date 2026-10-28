/**
 * The ballot builder's autosave (design §6.5). Each write is a task with a key (a question, the order, the details):
 * typing schedules its task after a pause, and a structural change (add, delete, move) schedules it at once. Tasks run
 * one at a time, in the order they became due, so the api sees changes in the order they were made: a question is
 * created before the order that lists it, and a pending save of a deleted question is dropped rather than recreating it.
 * A task reads the draft when it runs, so a key waiting or due only once saves the latest edit.
 *
 * A failed task stays first in line and saving pauses, showing the error, until `retry()` or another edit of the same
 * key, which tries again with that edit; the rest wait meanwhile, so nothing is saved out of order.
 */

export type SaveState = 'saved' | 'saving' | 'error';

export interface SaveStatus {
  readonly state: SaveState;
  /** Why saving paused, in words. */
  readonly error: string | null;
  /** The key of the task that failed. */
  readonly failedKey: string | null;
}

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const browserTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Task {
  readonly key: string;
  run: () => Promise<void>;
}

export class SaveQueue {
  /** Scheduled for later: the key's timer and what it will run. */
  private readonly waiting = new Map<string, { timer: unknown; run: () => Promise<void> }>();
  /** Due, in order; a failed task stays first. */
  private readonly due: Task[] = [];
  private running: string | null = null;
  /** Whether the running task's key was cancelled while it ran. */
  private cancelledRunning = false;
  private failure: { key: string; error: string } | null = null;
  private idle: (() => void)[] = [];

  constructor(
    private readonly options: {
      /** Called whenever the status may have changed. */
      readonly onChange: (status: SaveStatus) => void;
      /** An error in words. */
      readonly describe: (error: unknown) => string;
      readonly timers?: Timers;
    },
  ) {}

  private get timers(): Timers {
    return this.options.timers ?? browserTimers;
  }

  get status(): SaveStatus {
    const busy = this.running !== null || this.due.length > 0 || this.waiting.size > 0;
    return {
      state: this.failure ? 'error' : busy ? 'saving' : 'saved',
      error: this.failure?.error ?? null,
      failedKey: this.failure?.key ?? null,
    };
  }

  /** Runs `run` for `key` once `delayMs` have passed without another call for that key; at once for 0. */
  schedule(key: string, run: () => Promise<void>, delayMs = 0): void {
    const waiting = this.waiting.get(key);
    if (waiting) this.timers.clear(waiting.timer);
    if (delayMs <= 0) {
      this.waiting.delete(key);
      this.makeDue(key, run);
    } else {
      const timer = this.timers.set(() => {
        this.waiting.delete(key);
        this.makeDue(key, run);
      }, delayMs);
      this.waiting.set(key, { timer, run });
    }
    this.changed();
  }

  /** Drops what is waiting or due for `key`, its failure included. A task already running finishes. */
  cancel(key: string): void {
    const waiting = this.waiting.get(key);
    if (waiting) this.timers.clear(waiting.timer);
    this.waiting.delete(key);
    const i = this.due.findIndex((t) => t.key === key);
    if (i >= 0) this.due.splice(i, 1);
    if (this.failure?.key === key) this.failure = null;
    if (this.running === key) this.cancelledRunning = true;
    void this.pump();
  }

  /** Tries the failed task again, then the rest. */
  retry(): void {
    this.failure = null;
    void this.pump();
  }

  /** Drops everything not yet running (the page is reloading the ballot). */
  clear(): void {
    for (const { timer } of this.waiting.values()) this.timers.clear(timer);
    this.waiting.clear();
    this.due.length = 0;
    this.failure = null;
    this.changed();
  }

  /** Makes everything waiting due now; resolves true once all of it is saved, false if saving paused on an error. */
  flush(): Promise<boolean> {
    for (const [key, { timer, run }] of [...this.waiting]) {
      this.timers.clear(timer);
      this.waiting.delete(key);
      this.makeDue(key, run);
    }
    return new Promise((resolve) => {
      const check = () => {
        if (this.failure) resolve(false);
        else if (this.running === null && this.due.length === 0 && this.waiting.size === 0) resolve(true);
        else this.idle.push(check);
      };
      check();
    });
  }

  private makeDue(key: string, run: () => Promise<void>): void {
    const queued = this.due.find((t) => t.key === key);
    if (queued) queued.run = run;
    else this.due.push({ key, run });
    // A new edit of what failed is the retry.
    if (this.failure?.key === key) this.failure = null;
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running !== null || this.failure || this.due.length === 0) {
      this.changed();
      return;
    }
    const task = this.due.shift()!;
    this.running = task.key;
    this.changed();
    this.cancelledRunning = false;
    try {
      await task.run();
    } catch (e) {
      const again = this.due.findIndex((t) => t.key === task.key);
      if (this.cancelledRunning) {
        // Cancelled while it ran: nothing is left to save for it.
      } else if (again >= 0) {
        // Edited again while it ran: that edit is the retry, and takes its place first in line.
        this.due.unshift(...this.due.splice(again, 1));
      } else {
        this.due.unshift(task);
        this.failure = { key: task.key, error: this.options.describe(e) };
      }
    }
    this.running = null;
    await this.pump();
  }

  private changed(): void {
    this.options.onChange(this.status);
    const waiting = this.idle;
    this.idle = [];
    for (const check of waiting) check();
  }
}
