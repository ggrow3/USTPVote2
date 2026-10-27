import {
  DEFAULT_NOTICE_SETTINGS,
  isRehearsalRoll,
  reminderTime,
  type ElectionDetail,
  type NoticeKind,
  type NoticesView,
  type NoticeStep,
  type NoticeSummary,
  type RecipientCounts,
  type StepStatus,
} from 'ustp-domain';

/** Wording for the election editor's notice card (design §6.8). */

export const NOTICE_TITLES: Readonly<Record<NoticeKind, string>> = {
  voting_open: 'Voting is open',
  closing_soon: 'Closing soon: reminder to those who have not voted',
};

/** Each email by a short name, for the workflow's list. */
export const NOTICE_SHORT_TITLES: Readonly<Record<NoticeKind, string>> = {
  voting_open: 'Voting is open',
  closing_soon: 'Closing-soon reminder',
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
  "Official election notices: they go out whatever members' newsletter and announcement choices. Counts only; who each went to is not shown.";

/** Where this deployment sends no email (`MAIL_TRANSPORT=off`). */
export const NOT_SET_UP = 'Nothing is sent until email (Amazon SES) is set up for this deployment.';

/** Where no contact for questions is set, in the app or the deployment. */
export const NO_CONTACT = 'Nothing is mailed until a contact for election questions is set (Admin › Election emails).';

/** The reminder's lead time in words: "a day", "2 days", "an hour", "36 hours". */
export function leadTimeText(hours: number): string {
  if (hours === 1) return 'an hour';
  if (hours % 24 === 0) return hours === 24 ? 'a day' : `${hours / 24} days`;
  return `${hours} hours`;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The counts, in the order an admin reads them, each with what it means. */
export function countRows(kind: NoticeKind, counts: RecipientCounts): { label: string; value: number; note: string }[] {
  return [
    { label: 'Sent', value: counts.sent, note: 'the mail service took them' },
    { label: 'Still to send', value: counts.pending, note: 'the worker sends a batch every minute' },
    { label: 'Failed', value: counts.failed, note: 'not sent; can be resent while voting is open' },
    { label: 'Bounced', value: counts.bounced, note: 'sent, then reported undeliverable; not resent' },
    {
      label: 'Skipped',
      value: counts.skipped,
      note: kind === 'closing_soon' ? 'no verified email address, or voted before it went' : 'no verified email address on the account',
    },
  ];
}

/** One line on where the notice stands. */
export function noticeStatus(notice: NoticeSummary): string {
  const where = notice.delivery === 'outbox' ? ' Recorded in the outbox, not mailed.' : '';
  const round = notice.round > 1 ? ` (resend ${notice.round - 1})` : '';
  const of =
    notice.kind === 'closing_soon'
      ? `of the ${count(notice.recipients, 'person', 'people')} who had not voted when it was prepared`
      : `of the ${count(notice.recipients, 'person', 'people')} on the roll`;
  if (notice.status === 'done') {
    const finished = notice.completedAt ? `, finished ${new Date(notice.completedAt).toLocaleString()}` : '';
    return `Sent to ${notice.counts.sent} ${of}${round}${finished}.${where}`;
  }
  return `Sending${round}: ${notice.counts.sent} ${of} so far.${where}`;
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
    case 'off':
      return `A System Admin has switched ${step.kind === 'closing_soon' ? 'the reminder' : 'this email'} off (Admin › Election emails).`;
    case 'short_window':
      return `Voting is open for ${lead} or less, so there is no reminder.`;
    case 'closed':
      return step.kind === 'closing_soon' ? 'No reminder was sent for this election.' : 'No notice was sent for this election.';
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
