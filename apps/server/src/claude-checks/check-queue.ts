import type { Logger } from '@nestjs/common';
import type { CollectionReference } from 'firebase-admin/firestore';

/** What the queue reads of a check: the bylaws check's and the consistency check's records both have it. */
export interface QueuedCheck {
  readonly checkId: string;
  readonly status: 'queued' | 'running' | 'done' | 'failed';
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly error: string | null;
}

export interface QueueRun {
  /** Checks that finished with findings (possibly none). */
  readonly checked: number;
  /** Checks that failed, including any that timed out. */
  readonly failed: number;
}

/**
 * One worker run over a collection of checks (design §5.4, §5.5), each on its own Cloud Scheduler job so a review of a
 * minute or two never holds up the election tick. A check still running after `timeoutMinutes` is marked failed; up to
 * `maxPerRun` queued checks, oldest first, are claimed in transactions (queued → running, so overlapping runs never
 * review one twice) and reviewed side by side. `review` gives the fields a finished check gets; if it throws, the
 * check fails with that reason.
 */
export async function runCheckQueue<T extends QueuedCheck>(
  checks: CollectionReference,
  opts: { readonly what: string; readonly timeoutMinutes: number; readonly maxPerRun: number; readonly checker: string | null; readonly logger: Logger },
  review: (check: T) => Promise<Partial<T>>,
): Promise<QueueRun> {
  const finish = (checkId: string, result: object & { readonly error?: string | null }) =>
    checks.doc(checkId).update({ ...result, status: result.error ? 'failed' : 'done', finishedAt: new Date().toISOString() });

  const cutoff = new Date(Date.now() - opts.timeoutMinutes * 60_000).toISOString();
  let timedOut = 0;
  for (const doc of (await checks.where('status', '==', 'running').get()).docs) {
    const check = doc.data() as T;
    if ((check.startedAt ?? check.requestedAt) >= cutoff) continue;
    await finish(check.checkId, { error: `the check did not finish within ${opts.timeoutMinutes} minutes; request it again` });
    timedOut++;
  }

  const queued = (await checks.where('status', '==', 'queued').orderBy('requestedAt').limit(opts.maxPerRun).get()).docs;
  const claimed: T[] = [];
  for (const doc of queued) {
    const check = await checks.firestore.runTransaction(async (tx) => {
      const current = (await tx.get(doc.ref)).data() as T | undefined;
      if (current?.status !== 'queued') return null; // another run took it
      tx.update(doc.ref, { status: 'running', startedAt: new Date().toISOString(), checker: opts.checker });
      return current;
    });
    if (check) claimed.push(check);
  }

  const outcomes = await Promise.all(
    claimed.map(async (check) => {
      try {
        await finish(check.checkId, await review(check));
        return true;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        opts.logger.error(`${opts.what} ${check.checkId} failed: ${message}`);
        await finish(check.checkId, { error: message.slice(0, 500) });
        return false;
      }
    }),
  );
  return { checked: outcomes.filter((ok) => ok).length, failed: outcomes.filter((ok) => !ok).length + timedOut };
}
