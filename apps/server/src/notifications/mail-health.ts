import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import {
  MAIL_CAUSED_BY_SYSTEM,
  accountChecks,
  configChecks,
  configurationSetChecks,
  dnsChecks,
  fromDomain,
  identityChecks,
  identityPlatformCheck,
  isRehearsalRoll,
  MAIL_CHECK_INTERVAL_MINUTES,
  MAIL_RATE_DAYS,
  MAIL_SIMULATOR_DOMAIN,
  overallStatus,
  PROBE_EXPECTED,
  probeCheck,
  queueChecks,
  rateChecks,
  skippedChecks,
  type MailCheck,
  type MailCheckId,
  type MailDnsFacts,
  type MailHealthRecord,
  type MailHealthRequest,
  type MailProbe,
  type ProbeAddress,
} from 'ustp-domain';
import { alertLog } from '../common/logging.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { ElectionReader } from '../elections/election-reader.js';
import { MAIL_TRANSPORT, type MailTransport } from './mail-transport.js';
import { MailRepository } from './mail.repository.js';
import { Mailer } from './mailer.js';
import { NoticeSettingsService } from './notice-settings.js';
import type { IdentityPlatformReader, SesAccountReader } from './ses-account.js';

/** The SES reader, or null where the worker does not send through SES. */
export const SES_ACCOUNT = Symbol('SesAccountReader');

/** The reader of Identity Platform's email settings, or null where there is no project to read (the emulators). */
export const IDENTITY_PLATFORM = Symbol('IdentityPlatformReader');

/** Looks up a name's TXT records, each joined from its strings; tests replace it. */
export const DNS_TXT = Symbol('DnsTxt');
export type DnsTxt = (name: string) => Promise<string[]>;

/** Node's resolver: no records (or no such name) is an empty list. */
export const dnsTxt: DnsTxt = (name) =>
  resolveTxt(name).then(
    (records) => records.map((chunks) => chunks.join('')),
    () => [],
  );

/** The checks of SES itself, skipped where the worker does not send through it. */
const SES_CHECKS: readonly MailCheckId[] = [
  'production_access',
  'sending',
  'send_rate',
  'daily_quota',
  'suppression_list',
  'identity',
  'dkim',
  'mail_from',
  'default_configuration_set',
  'identity_platform',
  'configuration_set',
  'event_destination',
  'queue',
  'dead_letters',
  'dmarc',
  'spf',
];

/**
 * The email setup check (design §10.12), a step of the worker's tick: every hour where mail goes through SES, and on the
 * next tick after a System Admin asks (the only time where it does not), it checks the deployment's settings, the SES account, sender domain, configuration set, queues and DNS,
 * the bounce and complaint rates, and sends three messages to SES's mailbox simulator (the probe), whose reports later
 * ticks look for. It keeps the last run in `mail_health/current`. A check that starts failing where mail goes through
 * SES is logged for the alert policy (`alert: "mail"`), which emails the System Admins' alert addresses through Google.
 */
@Injectable()
export class MailHealthChecker {
  private readonly logger = new Logger(MailHealthChecker.name);

  constructor(
    private readonly mail: MailRepository,
    private readonly mailer: Mailer,
    private readonly settings: NoticeSettingsService,
    private readonly elections: ElectionReader,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
    @Inject(SES_ACCOUNT) private readonly ses: SesAccountReader | null,
    @Inject(IDENTITY_PLATFORM) private readonly identityPlatform: IdentityPlatformReader | null,
    @Inject(DNS_TXT) private readonly txt: DnsTxt,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Runs the check when due, else follows the last run's probe. Returns whether it ran. */
  async runDue(now: Date = new Date()): Promise<boolean> {
    const [previous, request] = await Promise.all([this.mail.health(), this.mail.healthRequest()]);
    const asked = request?.status === 'pending' ? request : null;
    const stale = !previous || Date.parse(previous.checkedAt) <= now.getTime() - MAIL_CHECK_INTERVAL_MINUTES * 60_000;
    const due = !!asked || (this.config.mailTransport === 'ses' && stale);
    if (!due) {
      await this.followProbe(previous, now);
      return false;
    }
    if (!(await this.mail.claimHealthRun(now))) return false;
    const record = await this.check(asked, now);
    await this.mail.saveHealth(record, asked);
    this.alert(record, previous);
    return true;
  }

  /** The last run of the check. */
  current(): Promise<MailHealthRecord | null> {
    return this.mail.health();
  }

  /**
   * The last run, after running one now if it is over an hour old, for a send of election email about to go (design
   * §6.8). The old one when another worker is running it.
   */
  async ensureFresh(now: Date = new Date()): Promise<MailHealthRecord | null> {
    const previous = await this.mail.health();
    if (previous && Date.parse(previous.checkedAt) > now.getTime() - MAIL_CHECK_INTERVAL_MINUTES * 60_000) return previous;
    if (!(await this.mail.claimHealthRun(now))) return previous;
    const record = await this.check(null, now, 'send');
    await this.mail.saveHealth(record, null);
    this.alert(record, previous);
    return record;
  }

  private async check(asked: MailHealthRequest | null, now: Date, trigger: MailHealthRecord['trigger'] = 'schedule'): Promise<MailHealthRecord> {
    const { mailTransport: transport, webOrigin, mailFrom } = this.config;
    const { configurationSet, eventsQueueUrl, maxSendRate } = this.config.ses;
    const domain = fromDomain(mailFrom);
    const settings = await this.settings.current();
    const checks: MailCheck[] = configChecks({
      transport,
      webOrigin,
      contact: settings.contact ?? this.config.noticeContact,
      queueUrl: eventsQueueUrl,
      allEmails: settings.allEmails,
    });

    if (transport === 'ses' && this.ses && domain) {
      const [account, identity, set, queue, largestRoll, signIn, lastSeen] = await Promise.all([
        this.ses.account(),
        this.ses.identity(domain),
        configurationSet ? this.ses.configurationSet(configurationSet) : Promise.resolve({ unread: 'none' }),
        this.ses.queue(),
        this.largestRoll(),
        this.identityPlatform ? this.identityPlatform.email() : Promise.resolve({ unread: 'no project' }),
        this.mail.lastIdentityMail(),
      ]);
      const mailFromDomain = 'mailFromDomain' in identity ? identity.mailFromDomain : null;
      const productionAccess = 'productionAccess' in account ? account.productionAccess : null;
      checks.push(
        ...accountChecks(account, { maxSendRate, largestRoll }),
        ...identityChecks(identity, { domain, configurationSet }),
        identityPlatformCheck('unread' in signIn ? signIn : { ...signIn, lastSeen }, { region: this.config.ses.region, domain, productionAccess, now }),
        ...configurationSetChecks(set, { name: configurationSet }),
        ...queueChecks(queue),
        ...dnsChecks(await this.dns(domain, mailFromDomain), { domain, mailFromDomain }),
      );
    } else {
      const why = transport === 'outbox' ? 'Not checked: email is recorded in the outbox.' : 'Not checked: this deployment sends no email.';
      checks.push(...skippedChecks(SES_CHECKS, why));
    }

    const since = new Date(now.getTime() - MAIL_RATE_DAYS * 86_400_000).toISOString();
    checks.push(...rateChecks(await this.mail.rates(since)));
    const probe = this.transport ? await this.sendProbe(now) : null;
    checks.push(probeCheck(probe, now));
    return {
      checkedAt: now.toISOString(),
      trigger: asked ? 'request' : trigger,
      requestedBy: asked?.requestedBy ?? null,
      transport,
      domain,
      overall: overallStatus(checks),
      checks,
      probe,
    };
  }

  /** The largest roll of an election that is scheduled or open and mails its voters (not a rehearsal). */
  private async largestRoll(): Promise<number> {
    const elections = [...(await this.elections.inState('scheduled')), ...(await this.elections.inState('open'))];
    const rolls = await Promise.all(elections.map((e) => this.elections.approvedRoll(e)));
    return Math.max(0, ...rolls.filter((r) => r && !isRehearsalRoll(r.criteria)).map((r) => r!.count));
  }

  /** The DMARC record of the domain, or of its parent's when it has none (a subdomain), and SPF on the MAIL FROM domain. */
  private async dns(domain: string, mailFromDomain: string | null): Promise<MailDnsFacts> {
    const dmarcOf = async (name: string) => (await this.txt(`_dmarc.${name}`)).find((r) => /^v=DMARC1/i.test(r)) ?? null;
    const parent = domain.split('.').length > 2 ? domain.split('.').slice(1).join('.') : null;
    const [own, inherited, spf] = await Promise.all([
      dmarcOf(domain),
      parent ? dmarcOf(parent) : null,
      mailFromDomain ? this.txt(mailFromDomain).then((rs) => rs.find((r) => /^v=spf1/i.test(r)) ?? null) : null,
    ]);
    return { dmarc: own ?? inherited, spf };
  }

  /** Sends the three simulator messages, which reach nobody and count toward neither quota nor rates. */
  private async sendProbe(now: Date): Promise<MailProbe> {
    const probeId = randomUUID().replaceAll('-', '');
    const addresses = Object.keys(PROBE_EXPECTED) as ProbeAddress[];
    const messages = await Promise.all(
      addresses.map(async (address) => {
        const result = await this.mailer.send(this.transport!, {
          to: `${address}+${probeId}@${MAIL_SIMULATOR_DOMAIN}`,
          from: this.config.mailFrom,
          replyTo: null,
          subject: 'USTP email setup check',
          text: "This message goes to Amazon SES's mailbox simulator and reaches nobody. It checks that delivery reports come back.",
          html: "<p>This message goes to Amazon SES's mailbox simulator and reaches nobody. It checks that delivery reports come back.</p>",
          meta: { kind: 'probe', ref: probeId, electionId: null, accountId: null, causedBy: MAIL_CAUSED_BY_SYSTEM },
        });
        return { address, messageId: result.status === 'sent' ? result.messageId : null, status: null };
      }),
    );
    return { probeId, sentAt: now.toISOString(), messages };
  }

  /** Looks for the last run's probe reports while it is pending, and saves what changed. */
  private async followProbe(previous: MailHealthRecord | null, now: Date): Promise<void> {
    const probe = previous?.probe;
    const current = previous?.checks.find((c) => c.id === 'probe');
    if (!previous || !probe || current?.status !== 'pending') return;
    const found = new Map((await this.mail.messages(probe.messages.flatMap((m) => (m.messageId ? [m.messageId] : [])))).map((r) => [r.messageId, r.status]));
    const followed: MailProbe = { ...probe, messages: probe.messages.map((m) => ({ ...m, status: (m.messageId && found.get(m.messageId)) || null })) };
    const check = probeCheck(followed, now);
    if (check.status === 'pending' && JSON.stringify(followed) === JSON.stringify(probe)) return;
    const checks = previous.checks.map((c) => (c.id === 'probe' ? check : c));
    const record: MailHealthRecord = { ...previous, checks, overall: overallStatus(checks), probe: followed };
    await this.mail.saveHealth(record, null);
    this.alert(record, previous);
  }

  /** Logs each check that has started failing, where mail goes through SES, for the alert policy. */
  private alert(record: MailHealthRecord, previous: MailHealthRecord | null): void {
    for (const c of record.checks) {
      if (c.status !== 'fail') continue;
      const was = previous?.checks.find((p) => p.id === c.id)?.status;
      if (record.transport !== 'ses') {
        this.logger.warn(`email setup check: ${c.id} fails: ${c.detail}`);
      } else if (was !== 'fail') {
        alertLog('mail', `email setup check: ${c.id} fails: ${c.detail}${c.fix ? ` (infra README: ${c.fix})` : ''}`, { check: c.id });
      }
    }
  }
}
