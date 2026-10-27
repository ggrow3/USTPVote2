import { isRehearsalRoll, isVotingOpen, type ElectionDetail, type NoticesView, type NoticeSummary, type RecipientCounts } from 'ustp-domain';

/** Wording for the election editor's notice card (design §6.8). */

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The counts, in the order an admin reads them, each with what it means. */
export function countRows(counts: RecipientCounts): { label: string; value: number; note: string }[] {
  return [
    { label: 'Sent', value: counts.sent, note: 'the mail service took them' },
    { label: 'Still to send', value: counts.pending, note: 'the worker sends a batch every minute' },
    { label: 'Failed', value: counts.failed, note: 'not sent; can be resent while voting is open' },
    { label: 'Bounced', value: counts.bounced, note: 'sent, then reported undeliverable; not resent' },
    { label: 'Skipped', value: counts.skipped, note: 'no verified email address on the account' },
  ];
}

/** One line on where the notice stands. */
export function noticeStatus(notice: NoticeSummary): string {
  const where = notice.delivery === 'outbox' ? ' Recorded in the outbox, not mailed.' : '';
  const round = notice.round > 1 ? ` (resend ${notice.round - 1})` : '';
  const roll = count(notice.recipients, 'person', 'people');
  if (notice.status === 'done') {
    const finished = notice.completedAt ? `, finished ${new Date(notice.completedAt).toLocaleString()}` : '';
    return `Sent to ${notice.counts.sent} of the ${roll} on the roll${round}${finished}.${where}`;
  }
  return `Sending${round}: ${notice.counts.sent} of the ${roll} on the roll so far.${where}`;
}

/** What happens, or happened, when there is no notice yet. */
export function noNoticeText(detail: ElectionDetail, view: NoticesView | null, testingMode: boolean, now: Date): string {
  const rehearsal = isRehearsalRoll(detail.roll?.criteria);
  const state = detail.election.state;
  if (rehearsal && !testingMode) return 'A rehearsal roll gets no email.';
  if (!rehearsal && view?.delivery === 'none') return 'Email is not set up in this deployment, so no notice is sent.';
  const who = rehearsal
    ? 'the worker records a notice for each test voter in the outbox, addressed to nobody: test voters have no email address'
    : 'the worker emails everyone on the roll that it is time to vote, once each';
  if (state === 'draft' || state === 'scheduled') return `When voting opens, ${who}.`;
  if (isVotingOpen(detail.election, now)) return `Voting is open: ${who}, starting within a minute.`;
  return 'No notice was sent for this election.';
}
