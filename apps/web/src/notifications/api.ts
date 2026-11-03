import type {
  MailHealthView,
  NoticeKind,
  NoticeSettingsInput,
  NoticeSettingsRecord,
  NoticesView,
  NoticeSummary,
  NoticeTestSummary,
} from 'ustp-domain';
import { api } from '../api.js';

/**
 * The notifications context's API (design §6.8, §12): an election's notices as counts, resending one to those it
 * failed for, and a test email to oneself. The only place its routes are written.
 */

export function electionNotices(electionId: string): Promise<NoticesView> {
  return api<NoticesView>('GET', `/v1/admin/elections/${encodeURIComponent(electionId)}/notices`);
}

/** Election Admin: the worker sends the notice again, on its next tick, to the recipients it failed for. */
export function resendNotice(electionId: string, kind: NoticeKind): Promise<NoticeSummary> {
  return api<NoticeSummary>('POST', `/v1/admin/elections/${encodeURIComponent(electionId)}/notices/${kind}/resend`);
}

/** Election Admin: the worker sends the email, marked as a test, to the caller's own address on its next tick. */
export function sendTestNotice(electionId: string, kind: NoticeKind): Promise<NoticeTestSummary> {
  return api<NoticeTestSummary>('POST', `/v1/admin/elections/${encodeURIComponent(electionId)}/notices/${kind}/test`);
}

// --- System Admin ------------------------------------------------------------------------------------------------

/** The election emails' settings (design §6.8), with who changed them last. */
export function noticeSettings(): Promise<NoticeSettingsRecord> {
  return api<NoticeSettingsRecord>('GET', '/v1/admin/notice-settings');
}

/** Saves them all; refused (409) if someone saved since version `basedOn`. */
export function saveNoticeSettings(input: NoticeSettingsInput): Promise<NoticeSettingsRecord> {
  return api<NoticeSettingsRecord>('PUT', '/v1/admin/notice-settings', input);
}

/** The email setup check's last run (design §10.12), and a request still waiting. */
export function mailHealth(): Promise<MailHealthView> {
  return api<MailHealthView>('GET', '/v1/admin/mail/health');
}

/** Asks the worker to run the check on its next tick; refused while one waits (409) or soon after a run (429). */
export function requestMailCheck(): Promise<MailHealthView> {
  return api<MailHealthView>('POST', '/v1/admin/mail/health/check');
}
