import {
  checkNoticeTest,
  DEFAULT_NOTICE_SETTINGS,
  isRehearsalRoll,
  reminderTime,
  type ElectionDetail,
  type NoticeKind,
  type NoticeOutcome,
  type NoticeSendTotals,
  type NoticesView,
  type NoticeStep,
  type NoticeSummary,
  type MailStatus,
  type NoticeHold,
  type NoticeTestSummary,
  type NoticeVerificationTotals,
  type RecipientCounts,
  type StepStatus,
} from 'ustp-domain';
import { MAIL_CHECK_LABELS } from './mail-health-text.js';

/** Wording for the election editor's notice card (design §6.8). */

export const NOTICE_TITLES: Readonly<Record<NoticeKind, string>> = {
  voting_open: 'Voting is open',
  closing_soon: 'Closing soon: reminder to those who have not voted',
  voted: 'Your vote was recorded: a confirmation to each voter',
};

/** Each email by a short name, for the workflow's list. */
export const NOTICE_SHORT_TITLES: Readonly<Record<NoticeKind, string>> = {
  voting_open: 'Voting is open',
  closing_soon: 'Closing-soon reminder',
  voted: 'Vote confirmations',
};

/** The emails' status in the workflow's list, read before its name; they never hold the election up. */
export const EMAIL_STATUS_TEXT: Readonly<Record<StepStatus, string>> = {
  done: 'Sent',
  current: 'Sending',
  upcoming: 'To come',
  possible: 'Possible',
  not_reached: 'Not sent',
};

/** What the emails are, in the user's words: the card's caption and the workflow's "Email to voters" step. */
export const EMAIL_DESCRIPTION =
  "Official election notices: they go out whatever members' newsletter and announcement choices, but not to a member who unsubscribed from all email or whose email an admin stopped. Counts only; who each went to is not shown.";

/** Where this deployment sends no email (`MAIL_TRANSPORT=off`). */
export const NOT_SET_UP = 'Nothing is sent until email (Amazon SES) is set up for this deployment.';

/** Where System Admins have switched all the site's email off. */
export const ALL_OFF = 'All email is switched off by a System Admin (Admin › Email): nothing goes until it is on.';

/** Where System Admins have switched Election Admins' test emails off. */
export const TESTS_OFF = 'Test emails are switched off by a System Admin (Admin › Email).';

/** Where no contact for questions is set, in the app or the deployment. */
export const NO_CONTACT = 'Nothing is mailed until a contact for election questions is set (Admin › Email).';

/** The reminder's lead time in words: "a day", "2 days", "an hour", "36 hours". */
export function leadTimeText(hours: number): string {
  if (hours === 1) return 'an hour';
  if (hours % 24 === 0) return hours === 24 ? 'a day' : `${hours / 24} days`;
  return `${hours} hours`;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Messages the mail service took, whatever it has reported of them since. */
export function acceptedCount(counts: RecipientCounts): number {
  return counts.sent + counts.delivered + counts.complained;
}

/** The counts, in the order an admin reads them, each with what it means. */
export function countRows(kind: NoticeKind, counts: RecipientCounts): { label: string; value: number; note: string }[] {
  const nowhere = 'no verified email address, one that bounced or was marked as spam before, or they unsubscribed or an admin stopped their email';
  return [
    { label: 'Delivered', value: counts.delivered, note: "the recipient's mail server took them; whether they were read, nobody here knows" },
    { label: 'Sent, no report yet', value: counts.sent, note: 'the mail service took them and has not said more' },
    { label: 'Still to send', value: counts.pending, note: 'the worker sends a batch every minute' },
    { label: 'Failed', value: counts.failed, note: 'not sent; can be resent while voting is open' },
    { label: 'Bounced', value: counts.bounced, note: 'sent, then reported undeliverable; not resent, and that address is not mailed again' },
    { label: 'Marked as spam', value: counts.complained, note: 'delivered, then marked as spam; that address is not mailed again' },
    { label: 'Skipped', value: counts.skipped, note: kind === 'closing_soon' ? `${nowhere}; or voted before it went` : nowhere },
  ];
}

/** One line on where the notice stands. */
export function noticeStatus(notice: NoticeSummary): string {
  const where = notice.delivery === 'outbox' ? ' Recorded in the outbox, not mailed.' : '';
  const round = notice.round > 1 ? ` (resend ${notice.round - 1})` : '';
  const of =
    notice.kind === 'closing_soon'
      ? `of the ${count(notice.recipients, 'person', 'people')} who had not voted when it was prepared`
      : notice.kind === 'voted'
        ? `of the ${count(notice.recipients, 'person', 'people')} who have voted`
        : `of the ${count(notice.recipients, 'person', 'people')} on the roll`;
  if (notice.status === 'done') {
    const finished = notice.completedAt ? `, finished ${new Date(notice.completedAt).toLocaleString()}` : '';
    return `Sent to ${acceptedCount(notice.counts)} ${of}${round}${finished}.${where}`;
  }
  return `Sending${round}: ${acceptedCount(notice.counts)} ${of} so far.${where}`;
}

/**
 * What happens, or happened, when the worker has not started this email: when it will go, or why it will not (from
 * `noticeSteps`), in the editor's card and the workflow's list.
 */
export function noNoticeText(step: NoticeStep, detail: ElectionDetail, view: NoticesView | null): string {
  const { election } = detail;
  const hours = (view?.settings ?? DEFAULT_NOTICE_SETTINGS).reminderHours;
  const lead = leadTimeText(hours);
  const outbox = isRehearsalRoll(detail.roll?.criteria) ? ' It goes to the outbox, addressed to nobody: test voters have no email address.' : '';
  switch (step.absent) {
    case 'rehearsal':
      return 'A rehearsal roll gets no email.';
    case 'not_set_up':
      return NOT_SET_UP;
    case 'no_contact':
      return NO_CONTACT;
    case 'all_off':
      return ALL_OFF;
    case 'off':
      return `A System Admin has switched ${step.kind === 'closing_soon' ? 'the reminder' : step.kind === 'voted' ? 'vote confirmations' : 'this email'} off (Admin › Email).`;
    case 'short_window':
      return `Voting is open for ${lead} or less, so there is no reminder.`;
    case 'closed':
      return step.kind === 'closing_soon'
        ? 'No reminder was sent for this election.'
        : step.kind === 'voted'
          ? 'No vote confirmations were sent for this election.'
          : 'No notice was sent for this election.';
  }
  if (step.kind === 'voted') {
    const who = 'the worker tells each voter, within a minute or so of their vote, that their ballot was recorded and when (never how)';
    return step.status === 'current' ? `Voting is open: ${who}.${outbox}` : `When voting opens, ${who}.${outbox}`;
  }
  if (step.kind === 'voting_open') {
    const who = 'the worker emails everyone on the roll that it is time to vote, once each';
    return step.status === 'current' ? `Voting is open: ${who}, starting within a minute.${outbox}` : `When voting opens, ${who}.${outbox}`;
  }
  if (step.status === 'current') return `The reminder is due: the worker starts it within a minute, after the voting-open email.${outbox}`;
  return (
    `On ${reminderTime(election, hours).toLocaleString()}, ${lead} before voting closes, the worker reminds those on the roll ` +
    `who have not voted yet, once each. The mail service then learns who had not voted, never how anyone votes.${outbox}`
  );
}

/**
 * What the send receipts say went to the roll: how many emails the mail service took, in how many sends, and when the
 * last one finished; then any it did not take.
 */
export function receiptText(totals: NoticeSendTotals | undefined): string {
  if (!totals?.sends) return 'No emails sent yet.';
  const last = totals.lastSentAt ? `; the last finished ${new Date(totals.lastSentAt).toLocaleString()}` : '';
  const failed = totals.failed ? ` The mail service did not take ${count(totals.failed, 'message')}.` : '';
  return `${count(totals.accepted, 'email')} sent in ${count(totals.sends, 'send')}${last}.${failed}`;
}

/** Why nothing more of an email goes for now (design §6.8): the email setup check is failing. */
export function heldText(held: NoticeHold): string {
  const checks = held.checks.map((c) => MAIL_CHECK_LABELS[c]).join(', ');
  return (
    `Held since ${new Date(held.since).toLocaleString()}: nothing more of this email goes while the email setup check fails ` +
    `(${checks}). The System Admins have been alerted; it goes on by itself once the check passes.`
  );
}

/**
 * What the checks of an email's sends found, each made 30 minutes after a send finished (design §6.8); null before the
 * first send.
 */
export function verificationText(totals: NoticeVerificationTotals | undefined): string | null {
  if (!totals || totals.checked + totals.pending === 0) return null;
  const waiting = totals.pending ? ` ${count(totals.pending, 'send')} still to be checked.` : '';
  if (!totals.checked) return `Each send is checked 30 minutes after it finishes.${waiting}`;
  if (!totals.shortSends) {
    return `${count(totals.checked, 'send')} checked: all ${count(totals.messages, 'email')} reached their mail servers.${waiting}`;
  }
  const short = totals.messages - totals.delivered;
  const why = [
    totals.bounced && `${totals.bounced} bounced`,
    totals.rejected && `${totals.rejected} rejected`,
    totals.delayed && `${totals.delayed} still delayed`,
    totals.noReport && `${totals.noReport} with no report`,
  ].filter(Boolean);
  return (
    `${totals.shortSends} of ${count(totals.checked, 'send')} fell short: ${short} of ${count(totals.messages, 'email')} not confirmed ` +
    `delivered after 30 minutes (${why.join(', ')}). The System Admins have been alerted.${waiting}`
  );
}

/** The test emails Election Admins had sent to themselves, counted apart from the roll. */
export function testReceiptText(totals: NoticeSendTotals | undefined): string | null {
  if (!totals?.sends) return null;
  const last = totals.lastSentAt ? `, the last ${new Date(totals.lastSentAt).toLocaleString()}` : '';
  return `Test emails to Election Admins: ${totals.accepted} sent${last}. Not counted above.`;
}

/** Why a test email did not go, in the admin's words. */
const TEST_OUTCOMES: Readonly<Partial<Record<NoticeOutcome, string>>> = {
  no_address: 'your account has no email address',
  unverified_address: "your account's email address is not verified",
  undeliverable: 'your address bounced before, or you marked one of these emails as spam, so it is not mailed',
  unsubscribed: 'you have unsubscribed from email; turn it back on on your Account page',
  email_stopped: 'an admin has stopped email to you',
  refused: 'the mail service refused it',
  unavailable: 'the mail service could not take it; try again later',
  interrupted: 'it was interrupted, so whether it went is unknown',
  error: 'something went wrong, so whether it went is unknown',
};

/** What the mail service reported of a test email it took. */
const TEST_DELIVERY: Readonly<Record<MailStatus, string>> = {
  sent: 'If it is not in your inbox, look in spam.',
  delayed: 'Your mail server has not taken it yet; the mail service keeps trying.',
  delivered: 'Your mail server took it: if it is not in your inbox, look in spam.',
  bounced: 'It bounced: your mail server would not take it.',
  complained: 'It was delivered, and marked as spam.',
  rejected: 'The mail service did not send it after all.',
};

/** Where the caller's last test email of this kind stands. */
export function testStatusText(test: NoticeTestSummary): string {
  if (test.status === 'pending') return 'Your test email is queued: the worker sends it to your own address within a minute.';
  if (test.status === 'sending') return 'Your test email is being sent.';
  const when = test.doneAt ? ` ${new Date(test.doneAt).toLocaleString()}` : '';
  if (test.sent) return `Your test email went to your own address${when}. ${TEST_DELIVERY[test.delivery ?? 'sent']}`;
  return `Your test email was not sent: ${TEST_OUTCOMES[test.outcome!] ?? 'something went wrong'}.`;
}

/** Why the caller cannot have a test email sent now, or null when they can (as far as the browser can tell). */
export function testBlocked(view: NoticesView | null, now: Date): string | null {
  if (!view) return null;
  const enabled = view.settings.allEmails && view.settings.emails.electionTests;
  const check = checkNoticeTest({ delivery: view.delivery, enabled, contact: view.contact, theirs: view.tests, now });
  if (check.ok) return null;
  if (view.delivery === 'none') return NOT_SET_UP;
  if (!view.settings.allEmails) return ALL_OFF;
  if (!enabled) return TESTS_OFF;
  if (view.delivery === 'mail' && !view.contact) return NO_CONTACT;
  return `${check.reason[0]!.toUpperCase()}${check.reason.slice(1)}.`;
}
