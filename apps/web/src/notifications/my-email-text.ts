import type { MailAddressState, MailKind, MailRequestOutcome, MailStatus, MyEmailView } from 'ustp-domain';

/** Wording for a member's own email (design §10.12) and the Membership Admins' flag. */

/** What each email is, in the member's words. */
export const MAIL_KIND_LABELS: Readonly<Record<MailKind, string>> = {
  voting_open: 'Voting is open',
  closing_soon: 'Reminder: voting closes soon',
  notice_test: 'Test of an election email',
  welcome: 'Welcome',
  probe: 'Setup check',
  member_test: 'Test email you asked for',
  account_email: 'Sign-in or account email',
};

/** What the mail service said became of it. */
export const MAIL_STATUS_LABELS: Readonly<Record<MailStatus, string>> = {
  sent: 'Sent; no report yet',
  delayed: 'Delayed: your mail server has not taken it yet',
  delivered: 'Delivered to your mail server',
  bounced: 'Bounced: your mail server would not take it',
  complained: 'Delivered, and marked as spam',
  rejected: 'Not sent after all',
};

/** Whether the address can be mailed, as a sentence for its owner. */
export function addressText(view: Pick<MyEmailView, 'address' | 'state' | 'since'>): string {
  const since = view.since ? ` since ${new Date(view.since).toLocaleDateString()}` : '';
  switch (view.state) {
    case 'ok':
      return `Party email goes to ${view.address}.`;
    case 'bounced':
      return `Email to ${view.address} has bounced${since}, so the party has stopped emailing it. Check the address works, then try it again.`;
    case 'complained':
      return `You marked an email from the party as spam${since}, so the party has stopped emailing ${view.address}. Try it again to get election email.`;
    case 'unverified':
      return `${view.address} is not confirmed yet, so election email does not go to it. Open the confirmation link we sent you.`;
    case 'no_address':
      return 'Your account has no email address, so the party cannot email you.';
  }
}

/** The site-wide banner's text, for an address that cannot be mailed; null when it can. */
export function bannerText(state: MailAddressState | undefined): string | null {
  if (state === 'bounced') return 'Email to your address has bounced, so you will not get election email.';
  if (state === 'complained') return 'You marked an email from the party as spam, so you will not get election email.';
  return null;
}

/** Why a requested email did not go. */
export const REQUEST_OUTCOMES: Readonly<Record<MailRequestOutcome, string>> = {
  refused: 'the mail service refused it',
  unavailable: 'the mail service could not take it; try again later',
  interrupted: 'it was interrupted, so whether it went is unknown',
  error: 'something went wrong, so whether it went is unknown',
  undeliverable: 'your address is not mailed now',
  no_address: 'your account has no email address',
};

/** The Membership Admins' flag: why a member cannot be emailed. */
export const FLAG_LABELS: Readonly<Record<Exclude<MailAddressState, 'ok'>, string>> = {
  bounced: 'Email bounced',
  complained: 'Marked email as spam',
  unverified: 'Address not confirmed',
  no_address: 'No email address',
};
