import {
  hasReminder,
  isRehearsalRoll,
  isReminderDue,
  isVotingOpen,
  reminderTime,
  type ElectionDetail,
  type NoticeKind,
  type NoticesView,
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
      ? `of the ${count(notice.recipients, 'person', 'people')} who had not voted a day before the close`
      : `of the ${count(notice.recipients, 'person', 'people')} on the roll`;
  if (notice.status === 'done') {
    const finished = notice.completedAt ? `, finished ${new Date(notice.completedAt).toLocaleString()}` : '';
    return `Sent to ${notice.counts.sent} ${of}${round}${finished}.${where}`;
  }
  return `Sending${round}: ${notice.counts.sent} ${of} so far.${where}`;
}

/** What happens, or happened, when there is no notice of this kind yet. */
export function noNoticeText(kind: NoticeKind, detail: ElectionDetail, view: NoticesView | null, testingMode: boolean, now: Date): string {
  const { election } = detail;
  const rehearsal = isRehearsalRoll(detail.roll?.criteria);
  if (rehearsal && !testingMode) return 'A rehearsal roll gets no email.';
  if (!rehearsal && view?.delivery === 'none') return NOT_SET_UP;
  const outbox = rehearsal ? ' It goes to the outbox, addressed to nobody: test voters have no email address.' : '';
  if (kind === 'voting_open') {
    const who = 'the worker emails everyone on the roll that it is time to vote, once each';
    if (election.state === 'draft' || election.state === 'scheduled') return `When voting opens, ${who}.${outbox}`;
    if (isVotingOpen(election, now)) return `Voting is open: ${who}, starting within a minute.${outbox}`;
    return 'No notice was sent for this election.';
  }
  if (!hasReminder(election)) return 'Voting is open for a day or less, so there is no reminder.';
  if (isReminderDue(election, now)) return `The reminder is due: the worker starts it within a minute, after the voting-open email.${outbox}`;
  if (['draft', 'scheduled', 'open'].includes(election.state)) {
    return (
      `On ${reminderTime(election).toLocaleString()}, a day before voting closes, the worker reminds those on the roll ` +
      `who have not voted yet, once each. The mail service then learns who had not voted, never how anyone votes.${outbox}`
    );
  }
  return 'No reminder was sent for this election.';
}
