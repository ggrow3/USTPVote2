import type {
  ApprovalRequestRecord,
  AppointmentInput,
  MemberMatch,
  PositionInput,
  PositionRecord,
  PositionsView,
} from 'ustp-domain';
import { api } from '../api.js';

/**
 * The offices context's API (design §6.4, §12): offices, their terms, appointments and ending terms. The only place its
 * routes are written; pages and panels call these.
 */

/** Every office and every term, for administrators. */
export function offices(): Promise<PositionsView> {
  return api<PositionsView>('GET', '/v1/admin/positions');
}

/** Every office and who holds it now: public. */
export function publicOffices(): Promise<PositionsView> {
  return api<PositionsView>('GET', '/v1/public/positions');
}

/** Defines an office or changes one; it takes effect at once. */
export function defineOffice(input: PositionInput): Promise<PositionRecord> {
  return api<PositionRecord>('POST', '/v1/admin/positions', input);
}

/** Asks an Auditor to appoint a member to the office (`position.appoint`). */
export function requestAppointment(positionId: string, input: AppointmentInput): Promise<ApprovalRequestRecord> {
  return api<ApprovalRequestRecord>('POST', `/v1/admin/positions/${encodeURIComponent(positionId)}/appointments`, input);
}

/** Asks an Auditor to end a term now (`position.modify`). */
export function requestEndTerm(positionId: string, termId: string, reason: string): Promise<ApprovalRequestRecord> {
  return api<ApprovalRequestRecord>('POST', `/v1/admin/positions/${encodeURIComponent(positionId)}/terms/${encodeURIComponent(termId)}/end`, {
    reason,
  });
}

/** Active members whose name matches, to choose whom to appoint. */
export function searchMembers(name: string): Promise<MemberMatch[]> {
  return api<MemberMatch[]>('GET', `/v1/admin/member-search?${new URLSearchParams({ name })}`);
}

/** The appointments and term endings waiting for an Auditor. */
export async function pendingOfficeRequests(): Promise<ApprovalRequestRecord[]> {
  const pending = await api<ApprovalRequestRecord[]>('GET', '/v1/admin/approvals?status=pending');
  return pending.filter((r) => r.action === 'position.appoint' || r.action === 'position.modify');
}
