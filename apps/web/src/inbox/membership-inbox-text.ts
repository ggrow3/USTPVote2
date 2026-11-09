import type { InboxEmail, InboxEmailSkip, InboxStatus } from 'ustp-domain';

/** Wording for the membership inbox (design §10.13). */

export const INBOX_STATUS_LABELS: Readonly<Record<InboxStatus, string>> = {
  open: 'Needs an answer',
  answered: 'Answered',
  closed: 'Closed',
};

/** Badge colours: what needs doing stands out; dark enough for white text (WCAG 1.4.3). */
export const INBOX_STATUS_COLOURS: Readonly<Record<InboxStatus, string>> = {
  open: 'deep-orange-9',
  answered: 'green-9',
  closed: 'grey-8',
};

/** Why the team's email did not, or would not, reach the member: finishes "Not emailed: …". */
export const INBOX_SKIP_TEXT: Readonly<Record<InboxEmailSkip, string>> = {
  email_off: 'all of the site’s email is switched off',
  no_address: 'they have no email address',
  unverified: 'their email address is not confirmed',
  undeliverable: 'email to their address bounced or was marked as spam',
  unsubscribed: 'they unsubscribed from all email from the party',
  email_stopped: 'an admin stopped email to them',
  failed: 'the mail service did not take it',
};

/** What became of a team message's email, under it; null for the member's own messages and for notes. */
export function inboxEmailText(email: InboxEmail | null): string | null {
  if (!email) return null;
  if (email.status === 'sent') return 'Emailed';
  if (email.status === 'pending') return 'Email about to go';
  return `Not emailed: ${INBOX_SKIP_TEXT[email.reason ?? 'failed']}`;
}

/** The banner over the conversation when the team's email would not reach the member now. */
export function emailSkipBanner(name: string, skip: InboxEmailSkip): string {
  return `Email will not reach ${name} now: ${INBOX_SKIP_TEXT[skip]}. What you write is still on the site for them, under the bell.`;
}

/** Whether the member had opened the conversation since a message was sent. */
export function readByMember(memberReadAt: string | null, sentAt: string): boolean {
  return !!memberReadAt && memberReadAt >= sentAt;
}

/** Who wrote a message, as the team sees it. */
export function inboxAuthor(m: { readonly from: 'member' | 'team'; readonly authorName: string; readonly note: boolean }): string {
  if (m.note) return `Note by ${m.authorName}, for the team only`;
  return m.from === 'team' ? `${m.authorName}, for the team` : m.authorName;
}
