import { MAIL_CHECK_IDS, MAIL_CHECK_STATUSES, type MailCheck, type MailHealthRecord } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { healthSummary, MAIL_CHECK_LABELS, MAIL_CHECK_LOOK, setupLine } from './mail-health-text.js';

const at = '2026-11-03T12:00:00.000Z';
const check = (id: MailCheck['id'], status: MailCheck['status']): MailCheck => ({ id, status, detail: '', fix: null });
const run = (checks: MailCheck[], over: Partial<MailHealthRecord> = {}): MailHealthRecord => ({
  checkedAt: at,
  trigger: 'schedule',
  requestedBy: null,
  transport: 'ses',
  domain: 'example.org',
  overall: 'ok',
  checks,
  probe: null,
  ...over,
});

describe('the email setup check’s wording', () => {
  it('names every check and status', () => {
    expect(Object.keys(MAIL_CHECK_LABELS).sort()).toEqual([...MAIL_CHECK_IDS].sort());
    expect(Object.keys(MAIL_CHECK_LOOK).sort()).toEqual([...MAIL_CHECK_STATUSES].sort());
  });

  it('sums up the last run', () => {
    expect(healthSummary(null)).toMatch(/has not run yet/);
    const when = new Date(at).toLocaleString();
    expect(healthSummary(run([check('dkim', 'ok')]))).toBe(`Checked ${when}, on its hourly run. Email is set up properly.`);
    expect(healthSummary(run([check('dkim', 'fail'), check('spf', 'fail'), check('dmarc', 'warn')], { overall: 'fail', trigger: 'request' }))).toBe(
      `Checked ${when}, when a System Admin asked. 2 checks failing: members may not get their email.`,
    );
    expect(healthSummary(run([check('dmarc', 'warn')], { overall: 'warn' }))).toMatch(/No check is failing; 1 warning\.$/);
    expect(healthSummary(run([check('dkim', 'ok')], { trigger: 'send' }))).toMatch(/, before election email went out\./);
    expect(healthSummary(run([check('probe', 'pending')], { overall: 'pending' }))).toMatch(/waiting for the test messages/);
    expect(healthSummary(run([check('transport', 'warn')], { transport: 'off', overall: 'warn' }))).toMatch(/1 warning/);
  });

  it('tells Election Admins only when something is wrong', () => {
    expect(setupLine(null)).toBeNull();
    expect(setupLine('ok')).toBeNull();
    expect(setupLine('fail')).toMatch(/some members may not get this email/);
    expect(setupLine('warn')).toMatch(/warnings/);
  });
});
