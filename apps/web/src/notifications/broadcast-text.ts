import { countryName, usStateName, type BroadcastPreview, type BroadcastSkip, type BroadcastSummary, type SubscriberPreview, type SubscriberSkip } from 'ustp-domain';

/** Wording for the emails admins write to members (design §10.12). */

export const RECIPIENT_RULE =
  'An email from you to members, and if you choose to the newsletter’s subscribers. It goes only to Active members who opted in to the newsletter or announcements, and to people who signed up for the newsletter and confirmed their address, never to anyone who unsubscribed or whose email an admin stopped. Every email sent is recorded in the audit ledger.';

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Why the rest of a choice do not get it, in the admin's words. */
const SKIP_TEXT: Readonly<Record<BroadcastSkip, string>> = {
  not_opted_in: 'did not opt in',
  unsubscribed: 'unsubscribed',
  email_stopped: 'had their email stopped by an admin',
  no_address: 'have no email address',
  unverified: 'have not confirmed their address',
  undeliverable: 'have an address that bounced or marked email as spam',
};

/** Why a subscriber does not get it. */
const SUBSCRIBER_SKIP_TEXT: Readonly<Record<SubscriberSkip, string>> = {
  member_copy: 'get it as members',
  stopped: 'are members who unsubscribed or whose email an admin stopped',
  undeliverable: 'have an address that bounced or marked email as spam',
};

/** "Goes to 40 of the 55 members chosen: 12 did not opt in, 3 unsubscribed." */
function membersText(preview: BroadcastPreview): string {
  if (!preview.matched) return 'That choice takes in no Active members.';
  const rest = (Object.keys(SKIP_TEXT) as BroadcastSkip[]).filter((k) => preview.skipped[k]).map((k) => `${preview.skipped[k]} ${SKIP_TEXT[k]}`);
  const to = `Goes to ${preview.willGet} of the ${count(preview.matched, 'member')} chosen`;
  return rest.length ? `${to}. Left out: ${rest.join(', ')}.` : `${to}.`;
}

/** "And to 30 of the 32 newsletter subscribers: 2 get it as members." */
function subscribersText(subscribers: SubscriberPreview, alone: boolean): string {
  if (!subscribers.listed) return alone ? 'Nobody has confirmed a newsletter sign-up yet.' : 'No newsletter subscribers yet.';
  const rest = (Object.keys(SUBSCRIBER_SKIP_TEXT) as SubscriberSkip[])
    .filter((k) => subscribers.skipped[k])
    .map((k) => `${subscribers.skipped[k]} ${SUBSCRIBER_SKIP_TEXT[k]}`);
  const to = `${alone ? 'Goes' : 'And'} to ${subscribers.willGet} of the ${count(subscribers.listed, 'newsletter subscriber')}`;
  return rest.length ? `${to}. Left out: ${rest.join(', ')}.` : `${to}.`;
}

/** Who a choice comes to: members, and the newsletter's subscribers when it takes them in (design §10.15). */
export function previewText(preview: BroadcastPreview, membersChosen = true): string {
  if (!preview.subscribers) return membersText(preview);
  if (!membersChosen) return subscribersText(preview.subscribers, true);
  return `${membersText(preview)} ${subscribersText(preview.subscribers, false)}`;
}

/** Who an email was for, never by name. */
export function audienceText(audience: BroadcastSummary['audience']): string {
  if (audience.kind === 'subscribers') return 'To the newsletter’s subscribers';
  if (audience.kind === 'all_active') return audience.withSubscribers ? 'To all Active members who opted in, and the newsletter’s subscribers' : 'To all Active members who opted in';
  if (audience.kind === 'picked') return `To ${count(audience.count, 'member')} picked by hand, those who opted in`;
  const places = [...audience.states.map(usStateName), ...audience.countries.map(countryName)];
  return `To Active members who opted in, in ${places.join(', ')}`;
}

/** Who approved an email that needed it, as a line under its status; null when it needed none or is not decided. */
export function approvalText(b: Pick<BroadcastSummary, 'approval'>): string | null {
  if (b.approval?.status !== 'approved') return null;
  const when = b.approval.decidedAt ? ` on ${new Date(b.approval.decidedAt).toLocaleString()}` : '';
  return `Approved by ${b.approval.decidedByName ?? 'a System or Site Admin'}${when}.`;
}

/** Where an email stands: its copies, and what the mail service has said of them. */
export function broadcastStatusText(
  b: Pick<BroadcastSummary, 'status' | 'counts' | 'held' | 'preview' | 'completedAt' | 'approval'> & { readonly audience?: BroadcastSummary['audience'] },
): string {
  const { counts } = b;
  const subscribers = b.audience?.kind === 'subscribers' || (b.audience?.kind === 'all_active' && !!b.audience.withSubscribers);
  const reports = [
    counts.delivered && `${counts.delivered} delivered`,
    counts.bounced && `${counts.bounced} bounced`,
    counts.complained && `${counts.complained} marked as spam`,
    counts.failed && `${counts.failed} could not be sent`,
    counts.skipped && `${counts.skipped} skipped, as they had stopped email since`,
  ].filter(Boolean);
  const detail = reports.length ? ` ${reports.join(', ')}.` : '';
  if (b.held) return `Held: nothing more goes while the email setup check fails. ${counts.sent} sent so far.${detail}`;
  switch (b.status) {
    case 'awaiting_approval':
      return 'Waiting for a System or Site Admin’s approval. Nothing has gone.';
    case 'rejected':
      return `Not approved${b.approval?.decidedByName ? ` by ${b.approval.decidedByName}` : ''}${b.approval?.reason ? `: “${b.approval.reason}”` : ''}. Nobody got it.`;
    case 'preparing':
      return 'Starting within a minute.';
    case 'sending':
      return `Sending: ${counts.sent} sent, ${counts.pending} to go.${detail}`;
    case 'cancelled':
      return `Stopped: ${counts.sent} sent, ${counts.pending} not sent.${detail}`;
    case 'done':
      return `Sent to ${subscribers ? count(counts.sent, 'person', 'people') : count(counts.sent, 'member')}.${detail}`;
  }
}
