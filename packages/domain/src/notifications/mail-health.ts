import { deny, OK, refuse, type Check } from '../check.js';
import type { MailStatus } from './mail.js';

/**
 * The email setup check (design §10.12): whether Amazon SES is set up so that members get their email. The worker,
 * which alone holds the AWS key, reads the SES account, the sender domain, the configuration set, the delivery-report
 * queues and the domain's DNS every hour, or when a System Admin asks, and sends three messages to SES's mailbox
 * simulator to see their reports come back. Each check says ok, warn or fail, why, and the infra README step that fixes
 * it. A failure is logged for the alert policy (System Admins' alert emails, through Google, not SES).
 */

export const MAIL_CHECK_IDS = [
  'transport',
  'web_origin',
  'contact',
  'production_access',
  'sending',
  'send_rate',
  'daily_quota',
  'suppression_list',
  'identity',
  'dkim',
  'mail_from',
  'default_configuration_set',
  'configuration_set',
  'event_destination',
  'queue',
  'dead_letters',
  'dmarc',
  'spf',
  'bounce_rate',
  'complaint_rate',
  'probe',
] as const;
export type MailCheckId = (typeof MAIL_CHECK_IDS)[number];

/** `pending`: the probe's reports have not all come back yet. `skipped`: not checked where email is off or recorded. */
export const MAIL_CHECK_STATUSES = ['ok', 'warn', 'fail', 'pending', 'skipped'] as const;
export type MailCheckStatus = (typeof MAIL_CHECK_STATUSES)[number];

/** The infra README's steps ("Email (Amazon SES)"), each a heading of its own, that a check can point to. */
export const MAIL_SETUP_STEPS = {
  terraform: 'SES account and Terraform',
  dns: 'SES DNS records',
  production: 'SES production access',
  key: 'SES worker key',
  switchOn: 'SES switch on',
  app: 'SES in the app',
} as const;
export type MailSetupStep = (typeof MAIL_SETUP_STEPS)[keyof typeof MAIL_SETUP_STEPS];

export interface MailCheck {
  readonly id: MailCheckId;
  readonly status: MailCheckStatus;
  /** What was found, in a sentence. Never an address of a member. */
  readonly detail: string;
  /** The infra README step that fixes it; null when nothing is to be done. */
  readonly fix: MailSetupStep | null;
}

/** The three simulator messages and what each must come back as. */
export const PROBE_EXPECTED = { success: 'delivered', bounce: 'bounced', complaint: 'complained' } as const satisfies Record<string, MailStatus>;
export type ProbeAddress = keyof typeof PROBE_EXPECTED;

/** SES's mailbox simulator: it answers as each address says, mails nobody, and counts toward neither quota nor reputation. */
export const MAIL_SIMULATOR_DOMAIN = 'simulator.amazonses.com';

/** How long the probe's reports may take before it fails. */
export const PROBE_MINUTES = 15;

/** One run's probe: the messages sent to the simulator, and what their reports said. */
export interface MailProbe {
  readonly probeId: string;
  readonly sentAt: string;
  readonly messages: readonly { readonly address: ProbeAddress; readonly messageId: string | null; readonly status: MailStatus | null }[];
}

/** `mail_health/current`: the last run of the check. */
export interface MailHealthRecord {
  readonly checkedAt: string;
  /** `schedule`: the hourly run. `request`: a System Admin asked (`requestedBy`). */
  readonly trigger: 'schedule' | 'request';
  readonly requestedBy: string | null;
  readonly transport: 'ses' | 'outbox' | 'off';
  /** The From address's domain, which the identity checks are about. */
  readonly domain: string | null;
  readonly overall: MailCheckStatus;
  readonly checks: readonly MailCheck[];
  readonly probe: MailProbe | null;
}

/** `mail_health/request`: a System Admin's request for a run now, which the worker takes on its next tick. */
export interface MailHealthRequest {
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly status: 'pending' | 'done';
}

/** `GET /v1/admin/mail/health`: the last run, and a request still waiting. */
export interface MailHealthView {
  readonly health: MailHealthRecord | null;
  readonly requested: MailHealthRequest | null;
}

/** The check runs this often by itself. */
export const MAIL_CHECK_INTERVAL_MINUTES = 60;

/** A System Admin may ask for a run this soon after the last one at most. */
export const MAIL_CHECK_REQUEST_MINUTES = 5;

/** Rates are judged over this many days, and only from this many messages. */
export const MAIL_RATE_DAYS = 30;
export const MAIL_RATE_MIN_MESSAGES = 100;

/** SES reviews an account above 5% bounces or 0.1% complaints; these warn well before. */
export const BOUNCE_RATE = { warn: 0.02, fail: 0.05 } as const;
export const COMPLAINT_RATE = { warn: 0.0005, fail: 0.001 } as const;

/** What the worker read of the SES account (`GetAccount`). */
export interface SesAccountFacts {
  readonly productionAccess: boolean;
  readonly sendingEnabled: boolean;
  /** HEALTHY, PROBATION or SHUTDOWN. */
  readonly enforcement: string | null;
  readonly maxSendRate: number;
  readonly max24HourSend: number;
  readonly sentLast24Hours: number;
  readonly suppressedReasons: readonly string[];
  readonly engagementMetrics: boolean;
}

/** What it read of the sender domain (`GetEmailIdentity`). */
export interface SesIdentityFacts {
  readonly verified: boolean;
  /** SUCCESS, PENDING, FAILED, TEMPORARY_FAILURE, NOT_STARTED. */
  readonly dkim: string | null;
  readonly mailFromDomain: string | null;
  readonly mailFromStatus: string | null;
  readonly configurationSet: string | null;
}

/** What it read of the configuration set and its event destinations. */
export interface SesConfigurationSetFacts {
  readonly sendingEnabled: boolean;
  readonly engagementMetrics: boolean;
  readonly destinations: readonly { readonly enabled: boolean; readonly types: readonly string[]; readonly sns: boolean }[];
}

/** What it read of the delivery-report queue and its dead-letter queue. */
export interface MailQueueFacts {
  readonly waiting: number;
  readonly inFlight: number;
  readonly redrive: boolean;
  /** Reports in the dead-letter queue; null when there is none to read. */
  readonly deadLetters: number | null;
}

/** The DNS records found: the DMARC record (the domain's or its parent's) and the MAIL FROM domain's SPF. */
export interface MailDnsFacts {
  readonly dmarc: string | null;
  readonly spf: string | null;
}

/** A fact the worker could not read: the AWS error's name. */
export type Unread = { readonly unread: string };

const isUnread = (v: unknown): v is Unread => typeof v === 'object' && v !== null && 'unread' in v;

/** The event types the configuration set must publish, and those it must not. */
export const REQUIRED_EVENT_TYPES = ['SEND', 'REJECT', 'BOUNCE', 'COMPLAINT', 'DELIVERY', 'DELIVERY_DELAY', 'RENDERING_FAILURE'] as const;
export const TRACKING_EVENT_TYPES = ['OPEN', 'CLICK'] as const;

const check = (id: MailCheckId, status: MailCheckStatus, detail: string, fix: MailSetupStep | null = null): MailCheck => ({ id, status, detail, fix });
const unread = (id: MailCheckId, what: string, e: Unread, fix: MailSetupStep = MAIL_SETUP_STEPS.key): MailCheck =>
  check(id, 'fail', `Could not read ${what} (${e.unread}): the worker's key may be wrong or lack a permission.`, fix);
const percent = (r: number) => `${(r * 100).toFixed(r < 0.01 ? 2 : 1)}%`;

/** The deployment's own settings: how it sends, where its links go, and the contact the emails give. */
export function configChecks(input: {
  readonly transport: MailHealthRecord['transport'];
  readonly webOrigin: string | null;
  readonly contact: string | null;
  readonly queueUrl: string | null;
}): MailCheck[] {
  const { transport, webOrigin, contact } = input;
  const transportCheck =
    transport === 'ses'
      ? check('transport', 'ok', 'Email goes through Amazon SES.')
      : transport === 'outbox'
        ? check('transport', 'ok', 'Email is recorded in the outbox, as with the emulators; nothing is mailed.')
        : check('transport', 'warn', 'Email is off for this deployment (MAIL_TRANSPORT=off): nothing is sent.', MAIL_SETUP_STEPS.switchOn);
  return [
    transportCheck,
    webOrigin
      ? check('web_origin', 'ok', `Links in the emails go to ${webOrigin}.`)
      : check('web_origin', 'fail', 'WEB_ORIGIN is not set, so no email is sent.', MAIL_SETUP_STEPS.switchOn),
    contact
      ? check('contact', 'ok', `The emails tell members to ask ${contact}.`)
      : check('contact', 'fail', 'No contact for election questions is set (Admin › Email, or NOTICE_CONTACT): no election email is sent.', MAIL_SETUP_STEPS.app),
  ];
}

/** The SES account: out of the sandbox, sending, within its quotas, and its suppression list. */
export function accountChecks(facts: SesAccountFacts | Unread, input: { readonly maxSendRate: number; readonly largestRoll: number }): MailCheck[] {
  const ids: MailCheckId[] = ['production_access', 'sending', 'send_rate', 'daily_quota', 'suppression_list'];
  if (isUnread(facts)) return ids.map((id) => unread(id, 'the SES account', facts));
  const left = facts.max24HourSend - facts.sentLast24Hours;
  const reasons = facts.suppressedReasons;
  return [
    facts.productionAccess
      ? check('production_access', 'ok', 'The account has production access.')
      : check(
          'production_access',
          'fail',
          'The account is in the SES sandbox: it sends only to verified addresses, 200 a day, so members get nothing.',
          MAIL_SETUP_STEPS.production,
        ),
    !facts.sendingEnabled || facts.enforcement === 'SHUTDOWN'
      ? check('sending', 'fail', `SES has stopped this account sending (${facts.enforcement ?? 'sending disabled'}).`, MAIL_SETUP_STEPS.production)
      : facts.enforcement === 'PROBATION'
        ? check('sending', 'warn', 'SES has put the account on probation, usually for its bounce or complaint rate.', MAIL_SETUP_STEPS.production)
        : check('sending', 'ok', 'Sending is enabled and the account is in good standing.'),
    facts.maxSendRate >= input.maxSendRate
      ? check('send_rate', 'ok', `The worker sends at most ${input.maxSendRate} a second; SES allows ${facts.maxSendRate}.`)
      : check(
          'send_rate',
          'fail',
          `The worker sends up to ${input.maxSendRate} a second (SES_MAX_SEND_RATE) but SES allows ${facts.maxSendRate}: lower it.`,
          MAIL_SETUP_STEPS.switchOn,
        ),
    left >= input.largestRoll
      ? check('daily_quota', 'ok', `${left} of today's ${facts.max24HourSend} messages are left; the largest roll coming is ${input.largestRoll}.`)
      : check(
          'daily_quota',
          facts.max24HourSend >= input.largestRoll ? 'warn' : 'fail',
          `The largest roll coming (${input.largestRoll}) is more than today's ${left} messages left of ${facts.max24HourSend}: ask AWS for a higher quota.`,
          MAIL_SETUP_STEPS.production,
        ),
    reasons.includes('COMPLAINT')
      ? check(
          'suppression_list',
          'warn',
          "SES's suppression list also takes complaints, so one \"mark as spam\" stops a member's sign-in links too; keep it to bounces.",
          MAIL_SETUP_STEPS.terraform,
        )
      : reasons.includes('BOUNCE')
        ? check('suppression_list', 'ok', "SES's suppression list takes addresses that bounced for good.")
        : check('suppression_list', 'warn', "SES's suppression list is off, so bounced addresses can be tried again.", MAIL_SETUP_STEPS.terraform),
  ];
}

/** The sender domain: verified, signed, bouncing to its own MAIL FROM domain, with this deployment's set as its default. */
export function identityChecks(facts: SesIdentityFacts | Unread, input: { readonly domain: string; readonly configurationSet: string | null }): MailCheck[] {
  const ids: MailCheckId[] = ['identity', 'dkim', 'mail_from', 'default_configuration_set'];
  if (isUnread(facts)) return ids.map((id) => unread(id, `the SES identity ${input.domain}`, facts, MAIL_SETUP_STEPS.terraform));
  const state = (s: string | null): MailCheck['status'] => (s === 'SUCCESS' ? 'ok' : s === 'PENDING' ? 'warn' : 'fail');
  return [
    facts.verified
      ? check('identity', 'ok', `${input.domain} is verified for sending.`)
      : check('identity', 'fail', `${input.domain} is not verified in SES yet: publish its DNS records.`, MAIL_SETUP_STEPS.dns),
    check(
      'dkim',
      state(facts.dkim),
      facts.dkim === 'SUCCESS' ? 'Messages are signed with DKIM.' : `DKIM is ${facts.dkim ?? 'not set up'}: publish the three DKIM records.`,
      facts.dkim === 'SUCCESS' ? null : MAIL_SETUP_STEPS.dns,
    ),
    !facts.mailFromDomain
      ? check('mail_from', 'warn', 'No MAIL FROM domain is set, so SPF does not align with the From address.', MAIL_SETUP_STEPS.terraform)
      : check(
          'mail_from',
          state(facts.mailFromStatus),
          facts.mailFromStatus === 'SUCCESS'
            ? `Bounces go to ${facts.mailFromDomain}.`
            : `The MAIL FROM domain ${facts.mailFromDomain} is ${facts.mailFromStatus ?? 'not checked'}: publish its MX and SPF records.`,
          facts.mailFromStatus === 'SUCCESS' ? null : MAIL_SETUP_STEPS.dns,
        ),
    input.configurationSet && facts.configurationSet === input.configurationSet
      ? check('default_configuration_set', 'ok', `Mail from ${input.domain} goes through ${input.configurationSet} by default.`)
      : check(
          'default_configuration_set',
          'warn',
          `The domain's default configuration set is ${facts.configurationSet ?? 'none'}, not ${input.configurationSet ?? "this deployment's"}: Identity Platform's mail would not be reported here.`,
          MAIL_SETUP_STEPS.terraform,
        ),
  ];
}

/** The configuration set: sending, publishing every delivery report and no opens or clicks to a topic. */
export function configurationSetChecks(facts: SesConfigurationSetFacts | Unread, input: { readonly name: string | null }): MailCheck[] {
  if (!input.name) {
    return [
      check('configuration_set', 'fail', 'SES_CONFIGURATION_SET is not set, so no delivery report is published.', MAIL_SETUP_STEPS.switchOn),
      check('event_destination', 'skipped', 'No configuration set to read.'),
    ];
  }
  if (isUnread(facts)) return (['configuration_set', 'event_destination'] as const).map((id) => unread(id, `the configuration set ${input.name}`, facts, MAIL_SETUP_STEPS.terraform));
  const reporting = facts.destinations.filter((d) => d.enabled && d.sns);
  const types = new Set(reporting.flatMap((d) => d.types));
  const missing = REQUIRED_EVENT_TYPES.filter((t) => !types.has(t));
  const tracking = TRACKING_EVENT_TYPES.filter((t) => types.has(t));
  return [
    !facts.sendingEnabled
      ? check('configuration_set', 'fail', `Sending is paused on ${input.name}.`, MAIL_SETUP_STEPS.terraform)
      : facts.engagementMetrics
        ? check('configuration_set', 'warn', `${input.name} records engagement (opens and clicks), which this app never asks for.`, MAIL_SETUP_STEPS.terraform)
        : check('configuration_set', 'ok', `${input.name} sends, with no open or click tracking.`),
    !reporting.length
      ? check('event_destination', 'fail', `${input.name} publishes no reports to a topic, so nothing is known of what became of a message.`, MAIL_SETUP_STEPS.terraform)
      : missing.length
        ? check('event_destination', 'fail', `${input.name} does not publish ${missing.join(', ')}.`, MAIL_SETUP_STEPS.terraform)
        : tracking.length
          ? check('event_destination', 'warn', `${input.name} also publishes ${tracking.join(' and ')}, which this app never asks for.`, MAIL_SETUP_STEPS.terraform)
          : check('event_destination', 'ok', 'Every delivery report is published to the queue, and no open or click.'),
  ];
}

/** The delivery-report queue: there, being read, and nothing left in its dead-letter queue. */
export function queueChecks(facts: MailQueueFacts | Unread | null): MailCheck[] {
  if (facts === null) {
    return [
      check('queue', 'fail', 'SES_EVENTS_QUEUE_URL is not set, so no delivery report is read.', MAIL_SETUP_STEPS.switchOn),
      check('dead_letters', 'skipped', 'No queue to read.'),
    ];
  }
  if (isUnread(facts)) return (['queue', 'dead_letters'] as const).map((id) => unread(id, 'the delivery-report queue', facts));
  return [
    facts.waiting > 1000
      ? check('queue', 'warn', `${facts.waiting} reports are waiting: the worker reads ten seconds' worth a minute and is catching up.`)
      : facts.redrive
        ? check('queue', 'ok', `${facts.waiting} reports waiting, ${facts.inFlight} being read.`)
        : check('queue', 'warn', 'The queue has no dead-letter queue, so a report that cannot be recorded is retried for 14 days.', MAIL_SETUP_STEPS.terraform),
    facts.deadLetters === null
      ? check('dead_letters', 'skipped', 'No dead-letter queue to read.')
      : facts.deadLetters > 0
        ? check('dead_letters', 'warn', `${facts.deadLetters} reports could not be recorded and wait in the dead-letter queue; see the worker's logs.`)
        : check('dead_letters', 'ok', 'No report has failed to be recorded.'),
  ];
}

/** DNS: a DMARC record for the From domain (or its parent's), and SPF on the MAIL FROM domain. */
export function dnsChecks(facts: MailDnsFacts, input: { readonly domain: string; readonly mailFromDomain: string | null }): MailCheck[] {
  const spfOk = !!facts.spf && /include:amazonses\.com/i.test(facts.spf);
  return [
    facts.dmarc && /^v=DMARC1/i.test(facts.dmarc)
      ? check('dmarc', 'ok', `DMARC: ${facts.dmarc}`)
      : check('dmarc', 'warn', `${input.domain} has no DMARC record: some providers file unauthenticated-looking mail as spam.`, MAIL_SETUP_STEPS.dns),
    !input.mailFromDomain
      ? check('spf', 'skipped', 'No MAIL FROM domain to look up.')
      : spfOk
        ? check('spf', 'ok', `${input.mailFromDomain} lets SES send for it (SPF).`)
        : check('spf', 'warn', `${input.mailFromDomain} has no SPF record naming amazonses.com.`, MAIL_SETUP_STEPS.dns),
  ];
}

/** The bounce and complaint rates of the mail this deployment sent, from its own delivery reports. */
export function rateChecks(input: { readonly sent: number; readonly bounced: number; readonly complained: number }): MailCheck[] {
  const { sent, bounced, complained } = input;
  if (sent < MAIL_RATE_MIN_MESSAGES) {
    const few = `${sent} messages in ${MAIL_RATE_DAYS} days: too few to judge a rate.`;
    return [check('bounce_rate', 'ok', few), check('complaint_rate', 'ok', few)];
  }
  const rate = (n: number, limits: { warn: number; fail: number }, id: MailCheckId, what: string) => {
    const r = n / sent;
    const status = r >= limits.fail ? 'fail' : r >= limits.warn ? 'warn' : 'ok';
    const detail = `${percent(r)} of ${sent} messages in ${MAIL_RATE_DAYS} days ${what} (SES reviews an account at ${percent(limits.fail)}).`;
    return check(id, status, detail);
  };
  return [rate(bounced, BOUNCE_RATE, 'bounce_rate', 'bounced for good'), rate(complained, COMPLAINT_RATE, 'complaint_rate', 'were marked as spam')];
}

/**
 * The probe: each simulator message's report came back as expected (ok), not yet (pending, until `PROBE_MINUTES` have
 * passed), or wrongly or never (fail).
 */
export function probeCheck(probe: MailProbe | null, now: Date): MailCheck {
  if (!probe) return check('probe', 'skipped', 'No test messages were sent.');
  const wrong = probe.messages.filter((m) => m.status !== null && m.status !== PROBE_EXPECTED[m.address] && !(m.address === 'complaint' && m.status === 'delivered'));
  const unsent = probe.messages.filter((m) => !m.messageId);
  const done = probe.messages.filter((m) => m.status === PROBE_EXPECTED[m.address]);
  const late = Date.parse(probe.sentAt) + PROBE_MINUTES * 60_000 <= now.getTime();
  if (unsent.length) return check('probe', 'fail', `SES did not take the test messages to its simulator (${unsent.map((m) => m.address).join(', ')}).`, MAIL_SETUP_STEPS.key);
  if (wrong.length) return check('probe', 'fail', `The simulator's ${wrong.map((m) => m.address).join(', ')} message came back ${wrong.map((m) => m.status).join(', ')}.`);
  if (done.length === probe.messages.length) return check('probe', 'ok', "SES's simulator answered all three test messages, and their reports came back through the queue.");
  if (!late) return check('probe', 'pending', `Waiting for the reports of ${probe.messages.length - done.length} test messages to the simulator.`);
  const missing = probe.messages.filter((m) => m.status !== PROBE_EXPECTED[m.address]).map((m) => m.address);
  return check(
    'probe',
    'fail',
    `No report came back for the ${missing.join(', ')} test message after ${PROBE_MINUTES} minutes: check the configuration set's event destination, the topic and the queue.`,
    MAIL_SETUP_STEPS.terraform,
  );
}

/** The worst of the checks; skipped ones count for nothing. */
export function overallStatus(checks: readonly MailCheck[]): MailCheckStatus {
  for (const s of ['fail', 'warn', 'pending', 'ok'] as const) if (checks.some((c) => c.status === s)) return s;
  return 'skipped';
}

/** The checks a deployment that sends no SES mail skips, with why. */
export function skippedChecks(ids: readonly MailCheckId[], why: string): MailCheck[] {
  return ids.map((id) => check(id, 'skipped', why));
}

/** Whether a System Admin may ask for a run now: one at a time, and not within minutes of the last. */
export function checkMailHealthRequest(current: Pick<MailHealthRecord, 'checkedAt'> | null, request: MailHealthRequest | null, now: Date): Check {
  if (request?.status === 'pending') return deny('a check is already waiting for the worker; it runs within a minute');
  if (current && Date.parse(current.checkedAt) > now.getTime() - MAIL_CHECK_REQUEST_MINUTES * 60_000) {
    return refuse('rate_limited', `the check ran less than ${MAIL_CHECK_REQUEST_MINUTES} minutes ago`);
  }
  return OK;
}

/** The domain of a From header (`Name <local@domain>` or `local@domain`), lower case; null when there is none. */
export function fromDomain(from: string): string | null {
  const address = /<([^<>]+)>\s*$/.exec(from)?.[1] ?? from;
  const at = address.lastIndexOf('@');
  return at > 0 ? address.slice(at + 1).trim().toLowerCase() || null : null;
}
