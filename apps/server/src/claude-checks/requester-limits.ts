import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import type { CollectionReference } from 'firebase-admin/firestore';
import type { QueuedCheck } from './check-queue.js';

/** Queued or running, and not yet old enough for the worker to fail it. */
export function unfinished(check: Pick<QueuedCheck, 'status' | 'requestedAt'>, staleBefore: string): boolean {
  return (check.status === 'queued' || check.status === 'running') && check.requestedAt >= staleBefore;
}

/**
 * Before a check is queued, the limits the bylaws check sets each person (design §5.4, §6.9): one unfinished check at a
 * time (409), and at most `perDay` in 24 hours (429), a cost bound. Reads the collection's `requestedBy` and
 * `requestedAt`, so it needs their composite index.
 */
export async function assertRequesterLimits(
  checks: CollectionReference,
  requestedBy: string,
  opts: { readonly what: string; readonly perDay: number; readonly timeoutMinutes: number },
  now = new Date(),
): Promise<void> {
  const recent = await checks
    .where('requestedBy', '==', requestedBy)
    .where('requestedAt', '>=', new Date(now.getTime() - 86_400_000).toISOString())
    .get();
  const stale = new Date(now.getTime() - opts.timeoutMinutes * 60_000).toISOString();
  if (recent.docs.some((d) => unfinished(d.data() as QueuedCheck, stale))) {
    throw new ConflictException('your previous check has not finished yet; wait for it, then try again');
  }
  if (recent.size >= opts.perDay) {
    throw new HttpException(`at most ${opts.perDay} ${opts.what} in 24 hours; try again later`, HttpStatus.TOO_MANY_REQUESTS);
  }
}
