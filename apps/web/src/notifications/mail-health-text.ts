import type { MailCheckId, MailCheckStatus, MailHealthRecord } from 'ustp-domain';

/** Wording for the email setup check (design §10.12). */

/** Each check by what it looks at, in the order the worker runs them. */
export const MAIL_CHECK_LABELS: Readonly<Record<MailCheckId, string>> = {
  transport: 'How email is sent',
  web_origin: 'Links in the emails',
  contact: 'Contact for questions',
  production_access: 'Out of the SES sandbox',
  sending: 'Account in good standing',
  send_rate: 'Sending rate',
  daily_quota: 'Daily quota',
  suppression_list: "SES's suppression list",
  identity: 'Sender domain verified',
  dkim: 'DKIM signature',
  mail_from: 'MAIL FROM domain',
  default_configuration_set: 'Default configuration set',
  identity_platform: 'Sign-in email through SES',
  configuration_set: 'Configuration set',
  event_destination: 'Delivery reports published',
  queue: 'Delivery-report queue',
  dead_letters: 'Reports that failed',
  dmarc: 'DMARC record',
  spf: 'SPF record',
  bounce_rate: 'Bounce rate',
  complaint_rate: 'Complaint rate',
  probe: 'Test messages to the simulator',
};

/** Each status as a word, an icon and a colour (with the word, never colour alone). */
export const MAIL_CHECK_LOOK: Readonly<Record<MailCheckStatus, { word: string; icon: string; color: string }>> = {
  ok: { word: 'OK', icon: 'check_circle', color: 'positive' },
  warn: { word: 'Warning', icon: 'warning', color: 'warning' },
  fail: { word: 'Failing', icon: 'error', color: 'negative' },
  pending: { word: 'Waiting', icon: 'hourglass_empty', color: 'grey-7' },
  skipped: { word: 'Not checked', icon: 'remove_circle_outline', color: 'grey-7' },
};

/** One line on the last run as a whole. */
export function healthSummary(health: MailHealthRecord | null): string {
  if (!health) return 'The check has not run yet. Where email goes through Amazon SES it runs every hour by itself.';
  const when = new Date(health.checkedAt).toLocaleString();
  const how = { request: 'when a System Admin asked', send: 'before election email went out', schedule: 'on its hourly run' }[health.trigger];
  const failing = health.checks.filter((c) => c.status === 'fail').length;
  const warning = health.checks.filter((c) => c.status === 'warn').length;
  const verdict =
    failing > 0
      ? `${failing} check${failing === 1 ? '' : 's'} failing: members may not get their email.`
      : warning > 0
        ? `No check is failing; ${warning} warning${warning === 1 ? '' : 's'}.`
        : health.overall === 'pending'
          ? 'Everything checked so far is right; waiting for the test messages.'
          : health.transport === 'ses'
            ? 'Email is set up properly.'
            : 'Nothing to check where email is not sent through Amazon SES.';
  return `Checked ${when}, ${how}. ${verdict}`;
}

/** One line for the election editor's email card, from the last run's overall status; null when there is nothing to say. */
export function setupLine(setup: MailCheckStatus | null): string | null {
  if (setup === 'fail') return 'Email setup: a check is failing, so some members may not get this email. A System Admin can see why under Admin › Email.';
  if (setup === 'warn') return 'Email setup: there are warnings for a System Admin to look at (Admin › Email).';
  return null;
}
