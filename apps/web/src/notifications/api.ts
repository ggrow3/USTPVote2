import type {
  MailHealthView,
  MailRequestKind,
  MailRestoreInput,
  MailStopInput,
  MailStopRow,
  MemberMailFlag,
  MyEmailView,
  NoticeKind,
  NoticeSettingsInput,
  NoticeSettingsRecord,
  NoticesView,
  NoticeSummary,
  NoticeTestSummary,
  UnsubscribeStatus,
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

/** A test email to the System Admin's own address, on the worker's next tick, even while all email is off. */
export function requestAdminTest(): Promise<MyEmailView> {
  return api<MyEmailView>('POST', '/v1/admin/mail/test');
}

/** Asks the worker to run the check on its next tick; refused while one waits (409) or soon after a run (429). */
export function requestMailCheck(): Promise<MailHealthView> {
  return api<MailHealthView>('POST', '/v1/admin/mail/health/check');
}

// --- The member's own email (design §10.12) -----------------------------------------------------------------------

export function myEmail(): Promise<MyEmailView> {
  return api<MyEmailView>('GET', '/v1/me/email');
}

/** A test email to oneself, or trying one's address again, on the worker's next tick. */
export function requestMyEmail(kind: MailRequestKind): Promise<MyEmailView> {
  return api<MyEmailView>('POST', `/v1/me/email/${kind}`);
}

/** No more email from the party; or email again, unless an admin has stopped it. */
export function setMyEmail(on: boolean): Promise<MyEmailView> {
  return api<MyEmailView>('POST', `/v1/me/email/${on ? 'resubscribe' : 'unsubscribe'}`);
}

/** Membership Admin: members who cannot be emailed, and why. */
export function memberMailFlags(): Promise<MemberMailFlag[]> {
  return api<MemberMailFlag[]>('GET', '/v1/admin/mail/members');
}

// --- Who gets no email (design §10.12) ----------------------------------------------------------------------------

/** Membership or System Admin: members who unsubscribed, or whose email an admin stopped. */
export function mailStops(): Promise<MailStopRow[]> {
  return api<MailStopRow[]>('GET', '/v1/admin/mail/stops');
}

/** Membership or System Admin: no more email to this member, by their address or ID, with a written reason. */
export function stopMemberEmail(input: MailStopInput): Promise<void> {
  return api<void>('POST', '/v1/admin/mail/stops', input);
}

export function restoreMemberEmail(accountId: string, input: MailRestoreInput): Promise<void> {
  return api<void>('POST', `/v1/admin/mail/stops/${encodeURIComponent(accountId)}/restore`, input);
}

/** Whether an email's unsubscribe link has been used. Needs no sign-in, and changes nothing. */
export function unsubscribeLinkStatus(token: string): Promise<UnsubscribeStatus> {
  return api<UnsubscribeStatus>('GET', `/v1/public/unsubscribe/${encodeURIComponent(token)}/status`, undefined, { actAs: null });
}

/** Unsubscribes the member an email's link was sent to. Needs no sign-in. */
export function unsubscribeLink(token: string): Promise<UnsubscribeStatus> {
  return api<UnsubscribeStatus>('POST', `/v1/public/unsubscribe/${encodeURIComponent(token)}`, undefined, { actAs: null });
}
