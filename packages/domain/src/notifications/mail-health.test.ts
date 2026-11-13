import { describe, expect, it } from 'vitest';
import {
  accountChecks,
  checkMailHealthRequest,
  configChecks,
  configurationSetChecks,
  dnsChecks,
  fromDomain,
  identityChecks,
  identityPlatformCheck,
  overallStatus,
  probeCheck,
  queueChecks,
  rateChecks,
  REQUIRED_EVENT_TYPES,
  type MailCheck,
  type MailProbe,
  type SesAccountFacts,
} from '../index.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const statuses = (checks: readonly MailCheck[]) => Object.fromEntries(checks.map((c) => [c.id, c.status]));

const ACCOUNT: SesAccountFacts = {
  productionAccess: true,
  sendingEnabled: true,
  enforcement: 'HEALTHY',
  maxSendRate: 14,
  max24HourSend: 50_000,
  sentLast24Hours: 1_000,
  suppressedReasons: ['BOUNCE'],
  engagementMetrics: false,
};

describe('the email setup check', () => {
  it('reads the deployment’s own settings', () => {
    expect(statuses(configChecks({ transport: 'ses', webOrigin: 'https://vote.example.org', contact: 'elections@example.org', queueUrl: 'q', allEmails: false })).transport).toBe('warn');
    expect(statuses(configChecks({ transport: 'ses', webOrigin: 'https://vote.example.org', contact: 'elections@example.org', queueUrl: 'q', allEmails: true }))).toEqual({
      transport: 'ok',
      web_origin: 'ok',
      contact: 'ok',
    });
    const off = configChecks({ transport: 'off', webOrigin: null, contact: null, queueUrl: null, allEmails: true });
    expect(statuses(off)).toEqual({ transport: 'warn', web_origin: 'fail', contact: 'fail' });
    expect(off.find((c) => c.id === 'contact')!.fix).toBe('SES in the app');
  });

  it('fails an account still in the sandbox, stopped, too slow or too small for the coming roll', () => {
    expect(statuses(accountChecks(ACCOUNT, { maxSendRate: 10, largestRoll: 5_000 }))).toEqual({
      production_access: 'ok',
      sending: 'ok',
      send_rate: 'ok',
      daily_quota: 'ok',
      suppression_list: 'ok',
    });
    const sandbox = accountChecks(
      { ...ACCOUNT, productionAccess: false, maxSendRate: 1, max24HourSend: 200, sentLast24Hours: 0, suppressedReasons: [] },
      { maxSendRate: 10, largestRoll: 5_000 },
    );
    expect(statuses(sandbox)).toMatchObject({ production_access: 'fail', send_rate: 'fail', daily_quota: 'fail', suppression_list: 'warn' });
    expect(sandbox[0]).toMatchObject({ fix: 'SES production access', detail: expect.stringMatching(/sandbox/) });
    expect(statuses(accountChecks({ ...ACCOUNT, enforcement: 'PROBATION' }, { maxSendRate: 10, largestRoll: 0 })).sending).toBe('warn');
    expect(statuses(accountChecks({ ...ACCOUNT, sendingEnabled: false }, { maxSendRate: 10, largestRoll: 0 })).sending).toBe('fail');
    // A day's quota mostly spent: a warning while the quota itself is big enough.
    expect(statuses(accountChecks({ ...ACCOUNT, sentLast24Hours: 48_000 }, { maxSendRate: 10, largestRoll: 5_000 })).daily_quota).toBe('warn');
    expect(statuses(accountChecks({ ...ACCOUNT, suppressedReasons: ['BOUNCE', 'COMPLAINT'] }, { maxSendRate: 10, largestRoll: 0 })).suppression_list).toBe('warn');
  });

  it('fails every account check it could not read, pointing at the key', () => {
    const checks = accountChecks({ unread: 'AccessDeniedException' }, { maxSendRate: 10, largestRoll: 0 });
    expect(checks.every((c) => c.status === 'fail' && c.fix === 'SES worker key')).toBe(true);
    expect(checks[0]!.detail).toContain('AccessDeniedException');
  });

  it('wants the sender domain verified, signed, with its MAIL FROM domain and this deployment’s set', () => {
    const good = { verified: true, dkim: 'SUCCESS', mailFromDomain: 'mail.dev.example.org', mailFromStatus: 'SUCCESS', configurationSet: 'ustp-mail-dev' };
    const input = { domain: 'dev.example.org', configurationSet: 'ustp-mail-dev' };
    expect(Object.values(statuses(identityChecks(good, input)))).toEqual(['ok', 'ok', 'ok', 'ok']);
    const pending = identityChecks({ ...good, verified: false, dkim: 'PENDING', mailFromStatus: 'FAILED', configurationSet: null }, input);
    expect(statuses(pending)).toEqual({ identity: 'fail', dkim: 'warn', mail_from: 'fail', default_configuration_set: 'warn' });
    expect(pending.map((c) => c.fix)).toEqual(['SES DNS records', 'SES DNS records', 'SES DNS records', 'SES account and Terraform']);
  });

  it('wants Identity Platform’s email through SES from the domain, never from the sandbox, and seen lately', () => {
    const input = { region: 'us-east-1', domain: 'dev.example.org', productionAccess: true, now: NOW };
    const smtp = { method: 'CUSTOM_SMTP', host: 'email-smtp.us-east-1.amazonaws.com', senderEmail: 'noreply@dev.example.org', lastSeen: minutesAgo(60) };
    expect(identityPlatformCheck(smtp, input).status).toBe('ok');
    expect(identityPlatformCheck({ ...smtp, method: 'DEFAULT' }, input)).toMatchObject({ status: 'warn', fix: 'SES sign-in mail' });
    expect(identityPlatformCheck({ ...smtp, host: 'smtp.example.org' }, input).status).toBe('fail');
    expect(identityPlatformCheck({ ...smtp, senderEmail: 'noreply@example.com' }, input).status).toBe('fail');
    expect(identityPlatformCheck(smtp, { ...input, productionAccess: false })).toMatchObject({ status: 'fail', detail: expect.stringMatching(/sandbox/) });
    expect(identityPlatformCheck({ ...smtp, lastSeen: minutesAgo(8 * 24 * 60) }, input).status).toBe('warn');
    expect(identityPlatformCheck({ ...smtp, lastSeen: null }, input).status).toBe('warn');
    expect(identityPlatformCheck({ unread: 'PermissionDenied' }, input).status).toBe('warn');
  });

  it('wants every delivery report published, and no open or click', () => {
    const facts = { sendingEnabled: true, engagementMetrics: false, destinations: [{ enabled: true, sns: true, types: [...REQUIRED_EVENT_TYPES] }] };
    expect(statuses(configurationSetChecks(facts, { name: 'ustp-mail-dev' }))).toEqual({ configuration_set: 'ok', event_destination: 'ok' });
    const off = { ...facts, destinations: [{ enabled: false, sns: true, types: [...REQUIRED_EVENT_TYPES] }] };
    expect(statuses(configurationSetChecks(off, { name: 'ustp-mail-dev' })).event_destination).toBe('fail');
    const bouncesOnly = { ...facts, destinations: [{ enabled: true, sns: true, types: ['BOUNCE', 'COMPLAINT'] }] };
    expect(configurationSetChecks(bouncesOnly, { name: 'ustp-mail-dev' })[1]).toMatchObject({ status: 'fail', detail: expect.stringContaining('DELIVERY') });
    const tracking = { ...facts, destinations: [{ enabled: true, sns: true, types: [...REQUIRED_EVENT_TYPES, 'OPEN'] }] };
    expect(statuses(configurationSetChecks(tracking, { name: 'ustp-mail-dev' })).event_destination).toBe('warn');
    expect(statuses(configurationSetChecks(facts, { name: null }))).toEqual({ configuration_set: 'fail', event_destination: 'skipped' });
  });

  it('reads the queue and its dead letters', () => {
    expect(statuses(queueChecks({ waiting: 3, inFlight: 1, redrive: true, deadLetters: 0 }))).toEqual({ queue: 'ok', dead_letters: 'ok' });
    expect(statuses(queueChecks({ waiting: 3, inFlight: 0, redrive: false, deadLetters: 2 }))).toEqual({ queue: 'warn', dead_letters: 'warn' });
    expect(statuses(queueChecks(null))).toEqual({ queue: 'fail', dead_letters: 'skipped' });
  });

  it('looks for DMARC and SPF', () => {
    const input = { domain: 'example.org', mailFromDomain: 'mail.example.org' };
    expect(statuses(dnsChecks({ dmarc: 'v=DMARC1; p=none', spf: 'v=spf1 include:amazonses.com ~all' }, input))).toEqual({ dmarc: 'ok', spf: 'ok' });
    expect(statuses(dnsChecks({ dmarc: null, spf: 'v=spf1 -all' }, input))).toEqual({ dmarc: 'warn', spf: 'warn' });
  });

  it('judges the bounce and complaint rates only from enough messages', () => {
    expect(statuses(rateChecks({ sent: 50, bounced: 40, complained: 5 }))).toEqual({ bounce_rate: 'ok', complaint_rate: 'ok' });
    expect(statuses(rateChecks({ sent: 10_000, bounced: 100, complained: 1 }))).toEqual({ bounce_rate: 'ok', complaint_rate: 'ok' });
    expect(statuses(rateChecks({ sent: 10_000, bounced: 300, complained: 6 }))).toEqual({ bounce_rate: 'warn', complaint_rate: 'warn' });
    expect(statuses(rateChecks({ sent: 10_000, bounced: 600, complained: 12 }))).toEqual({ bounce_rate: 'fail', complaint_rate: 'fail' });
  });

  it('waits for the simulator’s reports, then passes or fails the probe', () => {
    const probe = (statuses: [string | null, string | null, string | null], sentAt = minutesAgo(2)): MailProbe => ({
      probeId: 'p1',
      sentAt,
      messages: (['success', 'bounce', 'complaint'] as const).map((address, i) => ({ address, messageId: `m${i}`, status: statuses[i] as never })),
    });
    expect(probeCheck(null, NOW).status).toBe('skipped');
    expect(probeCheck(probe([null, null, null]), NOW).status).toBe('pending');
    expect(probeCheck(probe(['delivered', 'bounced', 'delivered']), NOW).status).toBe('pending');
    expect(probeCheck(probe(['delivered', 'bounced', 'complained']), NOW).status).toBe('ok');
    expect(probeCheck(probe(['delivered', 'delivered', null]), NOW)).toMatchObject({ status: 'fail', detail: expect.stringContaining('bounce') });
    expect(probeCheck(probe(['delivered', null, null], minutesAgo(16)), NOW)).toMatchObject({ status: 'fail', fix: 'SES account and Terraform' });
    expect(probeCheck({ ...probe([null, null, null]), messages: [{ address: 'success', messageId: null, status: null }] }, NOW).status).toBe('fail');
  });

  it('is as good as its worst check', () => {
    const c = (status: MailCheck['status']): MailCheck => ({ id: 'dmarc', status, detail: '', fix: null });
    expect(overallStatus([c('ok'), c('skipped')])).toBe('ok');
    expect(overallStatus([c('ok'), c('pending')])).toBe('pending');
    expect(overallStatus([c('pending'), c('warn')])).toBe('warn');
    expect(overallStatus([c('warn'), c('fail')])).toBe('fail');
    expect(overallStatus([c('skipped')])).toBe('skipped');
  });

  it('runs on a System Admin’s request one at a time, not within minutes of the last run', () => {
    expect(checkMailHealthRequest(null, null, NOW).ok).toBe(true);
    expect(checkMailHealthRequest({ checkedAt: minutesAgo(2) }, null, NOW)).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(checkMailHealthRequest({ checkedAt: minutesAgo(30) }, { requestedBy: 'sa', requestedAt: minutesAgo(1), status: 'pending' }, NOW).ok).toBe(false);
    expect(checkMailHealthRequest({ checkedAt: minutesAgo(30) }, { requestedBy: 'sa', requestedAt: minutesAgo(40), status: 'done' }, NOW).ok).toBe(true);
  });

  it('finds the From address’s domain', () => {
    expect(fromDomain('USTP Elections <noreply@Dev.Transhumanist-Party.org>')).toBe('dev.transhumanist-party.org');
    expect(fromDomain('noreply@example.org')).toBe('example.org');
    expect(fromDomain('nobody')).toBeNull();
  });
});
