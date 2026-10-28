import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveQueue, type SaveStatus } from './save-queue.js';

/** A task that resolves or rejects when told to, recording when it ran. */
function controlled(log: string[], name: string) {
  let finish: (error?: Error) => void = () => {};
  const run = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        log.push(`start ${name}`);
        finish = (error) => {
          log.push(`end ${name}`);
          if (error) reject(error);
          else resolve();
        };
      }),
  );
  return { run, finish: (error?: Error) => finish(error) };
}

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve)).then(() => Promise.resolve());

describe('SaveQueue', () => {
  let statuses: SaveStatus[];
  let queue: SaveQueue;
  beforeEach(() => {
    vi.useFakeTimers();
    statuses = [];
    queue = new SaveQueue({ onChange: (s) => statuses.push(s), describe: (e) => (e as Error).message });
  });
  afterEach(() => vi.useRealTimers());

  it('saves once typing pauses, with the latest edit', async () => {
    const run = vi.fn(async () => {});
    queue.schedule('q1', run, 800);
    vi.advanceTimersByTime(500);
    queue.schedule('q1', run, 800);
    vi.advanceTimersByTime(500);
    expect(run).not.toHaveBeenCalled();
    expect(queue.status.state).toBe('saving');
    vi.advanceTimersByTime(300);
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.status).toEqual({ state: 'saved', error: null, failedKey: null });
  });

  it('runs one task at a time, in the order they became due', async () => {
    const log: string[] = [];
    const a = controlled(log, 'create');
    const b = controlled(log, 'order');
    queue.schedule('question:a', a.run);
    queue.schedule('order', b.run);
    await settle();
    expect(log).toEqual(['start create']);
    a.finish();
    await settle();
    expect(log).toEqual(['start create', 'end create', 'start order']);
    b.finish();
    await settle();
    expect(queue.status.state).toBe('saved');
  });

  it('runs a key once more when it is edited while saving', async () => {
    const log: string[] = [];
    const first = controlled(log, 'first');
    queue.schedule('q1', first.run);
    await settle();
    const second = vi.fn(async () => {
      log.push('second');
    });
    queue.schedule('q1', second);
    queue.schedule('q1', second);
    first.finish();
    await settle();
    await settle();
    expect(log).toEqual(['start first', 'end first', 'second']);
  });

  it('drops a cancelled key, waiting or due', async () => {
    const log: string[] = [];
    const busy = controlled(log, 'busy');
    const later = vi.fn(async () => {});
    const due = vi.fn(async () => {});
    queue.schedule('busy', busy.run);
    queue.schedule('q1', later, 800);
    queue.schedule('q2', due);
    queue.cancel('q1');
    queue.cancel('q2');
    busy.finish();
    vi.advanceTimersByTime(1000);
    await settle();
    expect(later).not.toHaveBeenCalled();
    expect(due).not.toHaveBeenCalled();
    expect(queue.status.state).toBe('saved');
  });

  it('pauses on a failure, keeping the order, until retried', async () => {
    let fail = true;
    const create = vi.fn(async () => {
      if (fail) throw new Error('The server could not be reached.');
    });
    const order = vi.fn(async () => {});
    queue.schedule('question:a', create);
    queue.schedule('order', order);
    await settle();
    expect(queue.status).toEqual({ state: 'error', error: 'The server could not be reached.', failedKey: 'question:a' });
    expect(order).not.toHaveBeenCalled();

    fail = false;
    queue.retry();
    await settle();
    await settle();
    expect(create).toHaveBeenCalledTimes(2);
    expect(order).toHaveBeenCalledTimes(1);
    expect(queue.status.state).toBe('saved');
  });

  it('tries again when the key that failed is edited', async () => {
    const failing = vi.fn(async () => {
      throw new Error('enter a title');
    });
    queue.schedule('q1', failing);
    await settle();
    expect(queue.status.state).toBe('error');
    const fixed = vi.fn(async () => {});
    queue.schedule('q1', fixed);
    await settle();
    expect(fixed).toHaveBeenCalledTimes(1);
    expect(queue.status.state).toBe('saved');
  });

  it('flushes what is waiting and resolves once saved, or false on a failure', async () => {
    const run = vi.fn(async () => {});
    queue.schedule('q1', run, 800);
    const flushed = queue.flush();
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
    await expect(flushed).resolves.toBe(true);

    queue.schedule('q2', async () => {
      throw new Error('no');
    });
    await expect(queue.flush()).resolves.toBe(false);
  });

  it('clears everything not yet running', async () => {
    const run = vi.fn(async () => {});
    queue.schedule('q1', run, 800);
    queue.clear();
    vi.advanceTimersByTime(1000);
    await settle();
    expect(run).not.toHaveBeenCalled();
    expect(statuses.at(-1)?.state).toBe('saved');
  });
});
