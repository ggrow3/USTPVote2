import type {
  AdminTestView,
  TestRecipient,
  BroadcastAudience,
  BroadcastInput,
  BroadcastPreview,
  BroadcastsView,
  BroadcastSummary,
  AccountSummary,
  MailHealthView,
  MailDaysView,
  MailDayView,
  MailLogPage,
  MailLogQuery,
  MemberMatch,
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
  NewsletterConfirmStatus,
  NewsletterLookup,
  NewsletterOpen,
  NewsletterSignupInput,
  NewsletterSummary,
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

/** Who a test email can go to, and how the caller's last one went. */
export function adminTest(): Promise<AdminTestView> {
  return api<AdminTestView>('GET', '/v1/admin/mail/test');
}

/** System Admins and members a test email can go to, by name or by email address. */
export function searchTestRecipients(q: string): Promise<TestRecipient[]> {
  return api<TestRecipient[]>('GET', `/v1/admin/mail/test/recipients?${new URLSearchParams({ q })}`);
}

/** A test email to a System Admin or a member, on the worker's next tick, even while all email is off. */
export function requestAdminTest(to: string | null): Promise<AdminTestView> {
  return api<AdminTestView>('POST', '/v1/admin/mail/test', to ? { to } : {});
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

// --- Emails to members (design §10.12) ----------------------------------------------------------------------------

/** Membership or System Admin: the emails sent so far, and whether one can be sent now. */
export function emailsToMembers(): Promise<BroadcastsView> {
  return api<BroadcastsView>('GET', '/v1/admin/mail/broadcasts');
}

/** Who a choice of members comes to, before anything is sent. */
export function previewEmailToMembers(audience: BroadcastAudience): Promise<BroadcastPreview> {
  return api<BroadcastPreview>('POST', '/v1/admin/mail/broadcasts/preview', { audience });
}

/** Queues the email for the worker. */
export function emailMembers(input: BroadcastInput): Promise<BroadcastSummary> {
  return api<BroadcastSummary>('POST', '/v1/admin/mail/broadcasts', input);
}

/** System Admin: lets an email waiting for approval go out. */
export function approveEmailToMembers(broadcastId: string): Promise<BroadcastSummary> {
  return api<BroadcastSummary>('POST', `/v1/admin/mail/broadcasts/${encodeURIComponent(broadcastId)}/approve`);
}

/** System Admin: an email waiting for approval goes to nobody, with why. */
export function rejectEmailToMembers(broadcastId: string, reason: string): Promise<BroadcastSummary> {
  return api<BroadcastSummary>('POST', `/v1/admin/mail/broadcasts/${encodeURIComponent(broadcastId)}/reject`, { reason });
}

/** Stops one going out, or withdraws one waiting for approval: what has gone has gone. */
export function cancelEmailToMembers(broadcastId: string): Promise<BroadcastSummary> {
  return api<BroadcastSummary>('POST', `/v1/admin/mail/broadcasts/${encodeURIComponent(broadcastId)}/cancel`);
}

/** Active members by name, to pick them by hand. */
export function searchMembersToEmail(name: string): Promise<MemberMatch[]> {
  return api<MemberMatch[]>('GET', `/v1/admin/mail/broadcasts/member-search?${new URLSearchParams({ name })}`);
}

// --- The email log (design §10.12) -------------------------------------------------------------------------------

/** Membership Admin (or System Admin): one member's emails, from the email log, for their record (design §10.13). */
export function memberEmails(accountId: string, after?: string): Promise<MailLogPage> {
  const query = after ? `?${new URLSearchParams({ after })}` : '';
  return api<MailLogPage>('GET', `/v1/admin/mail/log/members/${encodeURIComponent(accountId)}${query}`);
}

/** System Admin: a page of every email the site sent, newest first. */
export function mailLog(query: MailLogQuery): Promise<MailLogPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
  return api<MailLogPage>('GET', `/v1/admin/mail/log?${params}`);
}

/** System Admin: how many emails the site sent each of the last `days` days, in this browser's time zone. */
export function mailDays(days: number): Promise<MailDaysView> {
  return api<MailDaysView>('GET', `/v1/admin/mail/days?${new URLSearchParams({ days: String(days), tz: browserTimeZone() })}`);
}

/** System Admin: one day's emails, in this browser's time zone: in all, by kind and status, and to each person. */
export function mailDay(day: string): Promise<MailDayView> {
  return api<MailDayView>('GET', `/v1/admin/mail/day?${new URLSearchParams({ day, tz: browserTimeZone() })}`);
}

/** The browser's time zone, which the email log's days are in; UTC if it names none. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** System Admin: accounts whose address starts with this, to find someone in the log by address. */
export function accountsByEmail(email: string): Promise<AccountSummary[]> {
  return api<AccountSummary[]>('GET', `/v1/admin/accounts?${new URLSearchParams({ email, limit: '10' })}`);
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

/** Whether the newsletter's form takes sign-ups now (design §10.15). Needs no sign-in. */
export function newsletterOpen(): Promise<NewsletterOpen> {
  return api<NewsletterOpen>('GET', '/v1/public/newsletter', undefined, { actAs: null });
}

/** Signs an address up for the newsletter; the answer is the same whether or not it was on the list. */
export function signUpForNewsletter(input: NewsletterSignupInput): Promise<{ received: true }> {
  return api<{ received: true }>('POST', '/v1/public/newsletter', input, { actAs: null, appCheck: true });
}

/** Whether a confirmation link's address is confirmed (opening the link changes nothing). */
export function newsletterConfirmStatus(token: string): Promise<NewsletterConfirmStatus> {
  return api<NewsletterConfirmStatus>('GET', `/v1/public/newsletter/confirm/${encodeURIComponent(token)}`, undefined, { actAs: null });
}

/** Confirms a newsletter sign-up: the address is on the list from now. */
export function confirmNewsletter(token: string): Promise<NewsletterConfirmStatus> {
  return api<NewsletterConfirmStatus>('POST', `/v1/public/newsletter/confirm/${encodeURIComponent(token)}`, undefined, { actAs: null });
}

/** How many are on the newsletter's list (Membership, System and Site Admins). */
export function newsletterSummary(): Promise<NewsletterSummary> {
  return api<NewsletterSummary>('GET', '/v1/admin/newsletter');
}

/** Whether one address is on the list or waiting. */
export function lookUpSubscriber(email: string): Promise<NewsletterLookup> {
  return api<NewsletterLookup>('POST', '/v1/admin/newsletter/lookup', { email });
}

/** Takes one address off the list and deletes it. */
export function removeSubscriber(email: string): Promise<void> {
  return api<void>('POST', '/v1/admin/newsletter/remove', { email });
}
