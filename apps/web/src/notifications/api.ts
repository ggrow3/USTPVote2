import type { NoticeKind, NoticesView, NoticeSummary } from 'ustp-domain';
import { api } from '../api.js';

/**
 * The notifications context's API (design §6.8, §12): an election's notices as counts, and resending one to those it
 * failed for. The only place its routes are written.
 */

export function electionNotices(electionId: string): Promise<NoticesView> {
  return api<NoticesView>('GET', `/v1/admin/elections/${encodeURIComponent(electionId)}/notices`);
}

/** Election Admin: the worker sends the notice again, on its next tick, to the recipients it failed for. */
export function resendNotice(electionId: string, kind: NoticeKind): Promise<NoticeSummary> {
  return api<NoticeSummary>('POST', `/v1/admin/elections/${encodeURIComponent(electionId)}/notices/${kind}/resend`);
}
