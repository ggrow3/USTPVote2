import type { ConsistencyCheckResult, ConsistencyCheckState, ConsistencyCheckView, ConsistencyDocument } from 'ustp-domain';
import { api } from '../api.js';

/**
 * The platform consistency check's API (design §5.5, §12): from the ballot for a voter on the roll, from the election
 * editor for an Election Admin or Auditor. The only place its routes are written.
 */

const route = (electionId: string, view: ConsistencyCheckView) =>
  `${view === 'admin' ? '/v1/admin/elections' : '/v1/elections'}/${encodeURIComponent(electionId)}/consistency-check`;

/** Whether the check is on, what it compares with, and the caller's own check of the election, if any. */
export function consistencyCheckState(electionId: string, view: ConsistencyCheckView): Promise<ConsistencyCheckState> {
  return api<ConsistencyCheckState>('GET', route(electionId, view));
}

/** Queues the caller's one check of the election (409 once they have had it); the worker runs it. */
export function requestConsistencyCheck(electionId: string, view: ConsistencyCheckView): Promise<ConsistencyCheckResult> {
  return api<ConsistencyCheckResult>('POST', route(electionId, view));
}

/** An Election Admin chooses what the election's checks compare with, while it is a draft (409 after). */
export async function chooseConsistencyDocuments(electionId: string, documents: readonly ConsistencyDocument[]): Promise<ConsistencyDocument[]> {
  return (await api<{ documents: ConsistencyDocument[] }>('PUT', `${route(electionId, 'admin')}/documents`, { documents })).documents;
}
