import type { ElectionCheckState, ElectionCheckView, PublicElectionCheck } from 'ustp-domain';
import { api } from '../api.js';

/**
 * The election setup check's API (design §6.9, §12): asked for and followed in the election editor by an Election Admin
 * or Auditor, and its notes read by everyone once the election is past draft. The only place its routes are written.
 */

const adminRoute = (electionId: string) => `/v1/admin/elections/${encodeURIComponent(electionId)}/bylaws-checks`;

/** Whether the check can be asked for, and the election's latest check with what has changed since. */
export function electionCheckState(electionId: string): Promise<ElectionCheckState> {
  return api<ElectionCheckState>('GET', adminRoute(electionId));
}

/** Queues a check (409 while one runs, or when nothing has changed since the last); the worker runs it. */
export function requestElectionCheck(electionId: string): Promise<ElectionCheckView> {
  return api<ElectionCheckView>('POST', adminRoute(electionId));
}

/**
 * The notes beside the contests of a scheduled election: the check of its frozen definition, or null when there is none
 * (404) or it cannot be read. The page works the same without them.
 */
export async function publishedElectionCheck(electionId: string): Promise<PublicElectionCheck | null> {
  try {
    return await api<PublicElectionCheck>('GET', `/v1/public/elections/${encodeURIComponent(electionId)}/bylaws-check`);
  } catch {
    return null;
  }
}
