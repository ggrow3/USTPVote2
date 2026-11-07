import { countryName, usStateName, type BroadcastPreview, type BroadcastSkip, type BroadcastSummary } from 'ustp-domain';

/** Wording for the emails admins write to members (design §10.12). */

export const RECIPIENT_RULE =
  'An email from you to members. It goes only to Active members who opted in to the newsletter or announcements, never to anyone who unsubscribed or whose email an admin stopped. Every email sent is recorded in the audit ledger.';

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

/** "Goes to 40 of the 55 members chosen: 12 did not opt in, 3 unsubscribed." */
export function previewText(preview: BroadcastPreview): string {
  if (!preview.matched) return 'That choice takes in no Active members.';
  const rest = (Object.keys(SKIP_TEXT) as BroadcastSkip[]).filter((k) => preview.skipped[k]).map((k) => `${preview.skipped[k]} ${SKIP_TEXT[k]}`);
  const to = `Goes to ${preview.willGet} of the ${count(preview.matched, 'member')} chosen`;
  return rest.length ? `${to}. Left out: ${rest.join(', ')}.` : `${to}.`;
}

/** Who an email was for, never by name. */
export function audienceText(audience: BroadcastSummary['audience']): string {
  if (audience.kind === 'all_active') return 'To all Active members who opted in';
  if (audience.kind === 'picked') return `To ${count(audience.count, 'member')} picked by hand, those who opted in`;
  const places = [...audience.states.map(usStateName), ...audience.countries.map(countryName)];
  return `To Active members who opted in, in ${places.join(', ')}`;
}

/** Where an email stands: its copies, and what the mail service has said of them. */
export function broadcastStatusText(b: Pick<BroadcastSummary, 'status' | 'counts' | 'held' | 'preview' | 'completedAt'>): string {
  const { counts } = b;
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
    case 'preparing':
      return 'Starting within a minute.';
    case 'sending':
      return `Sending: ${counts.sent} sent, ${counts.pending} to go.${detail}`;
    case 'cancelled':
      return `Stopped: ${counts.sent} sent, ${counts.pending} not sent.${detail}`;
    case 'done':
      return `Sent to ${count(counts.sent, 'member')}.${detail}`;
  }
}
