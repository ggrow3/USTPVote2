import { MAIL_CAUSED_BY_SYSTEM, type MailKind, type MailLogRow, type MailStatus } from 'ustp-domain';

/** Wording for the email log in Admin › Email (design §10.12), in an administrator's words rather than the member's. */

export const LOG_KIND_LABELS: Readonly<Record<MailKind, string>> = {
  voting_open: 'Election notice: voting is open',
  closing_soon: 'Election reminder: voting closes soon',
  voted: 'Vote confirmation',
  notice_test: 'Test of an election email',
  welcome: 'Welcome to an added member',
  probe: 'Setup check (to Amazon’s simulator)',
  member_test: 'Test a member asked for',
  admin_test: 'Admin’s test',
  broadcast: 'Email to members',
  notification: 'Notification by email, as it came',
  notification_digest: 'Digest of notifications',
  sign_in_link: 'Sign-in link (Identity Platform)',
  address_verification: 'Address confirmation (Identity Platform)',
  password_reset: 'Password reset (Identity Platform)',
  account_email: 'Other account email (Identity Platform)',
};

export const LOG_STATUS_LABELS: Readonly<Record<MailStatus, string>> = {
  sent: 'Sent, no report yet',
  delayed: 'Delayed',
  delivered: 'Delivered',
  bounced: 'Bounced',
  complained: 'Marked as spam',
  rejected: 'Not sent after all',
};

/** A row's status, in words: a welcome link no report reaches says so rather than waiting for one. */
export function logStatus(row: Pick<MailLogRow, 'status' | 'handOff'>): string {
  return row.handOff && row.status === 'sent' ? 'Sent by Identity Platform, no reports' : LOG_STATUS_LABELS[row.status];
}

/** What an email was, as the log names it: a welcome says when it was Identity Platform's sign-in link. */
export function logKind(row: Pick<MailLogRow, 'kind' | 'sender'>): string {
  return row.kind === 'welcome' && row.sender === 'identity_platform' ? `${LOG_KIND_LABELS.welcome} (Identity Platform’s sign-in link)` : LOG_KIND_LABELS[row.kind];
}

/** Quasar colours for a status chip, which also carries the words, so colour is never the only sign. */
export const LOG_STATUS_COLOURS: Readonly<Record<MailStatus, string>> = {
  sent: 'grey-7',
  delayed: 'orange-9',
  delivered: 'positive',
  bounced: 'negative',
  complained: 'negative',
  rejected: 'negative',
};

/** Whom an email went to, as the log shows it. */
export function logRecipient(row: Pick<MailLogRow, 'kind' | 'accountId' | 'accountName' | 'accountEmail'>): string {
  if (row.kind === 'probe') return 'Amazon’s mailbox simulator (nobody)';
  if (!row.accountId) return 'An address no account has';
  const name = row.accountName ?? 'An account with no name';
  return row.accountEmail && row.accountEmail !== name ? `${name} (${row.accountEmail})` : name;
}

/** Who caused it, as the log shows it. */
export function logCause(row: Pick<MailLogRow, 'sender' | 'causedBy' | 'causedByName'>): string {
  // Identity Platform's own emails, unless an admin's browser asked for it (a welcome link).
  if (row.sender === 'identity_platform' && !row.causedBy) return 'Identity Platform, when the member asked';
  if (row.causedBy === MAIL_CAUSED_BY_SYSTEM) return 'The site, by itself';
  if (!row.causedBy) return 'Not recorded';
  return row.causedByName ?? 'A deleted account';
}

/** A bounce, as a short note; null for anything else. */
export function logBounce(row: Pick<MailLogRow, 'bounce'>): string | null {
  if (!row.bounce) return null;
  const type = row.bounce.type === 'permanent' ? 'for good' : row.bounce.type === 'transient' ? 'for now' : 'for an unknown reason';
  return `Bounced ${type} (${row.bounce.subType})`;
}
