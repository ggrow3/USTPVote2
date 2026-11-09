import { describe, expect, it } from 'vitest';
import {
  adminTestMessage,
  checkMailRequest,
  isMailRequestInFlight,
  mailAddressState,
  mayGetAdminTest,
  memberTestMessage,
  type MailRequestRecord,
} from '../index.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const request = (over: Partial<MailRequestRecord> = {}): MailRequestRecord => ({
  requestId: 'r1',
  accountId: 'a1',
  kind: 'test',
  requestedAt: minutesAgo(60),
  status: 'done',
  claimedAt: null,
  doneAt: minutesAgo(59),
  outcome: null,
  messageId: 'm1',
  ...over,
});

describe('a member’s own email', () => {
  it('says whether their address can be mailed, and since when it cannot', () => {
    const verified = { primaryEmail: 'ada@example.org', emailVerified: true };
    expect(mailAddressState(verified, null)).toEqual({ state: 'ok', since: null });
    expect(mailAddressState(verified, { reason: 'bounced', since: minutesAgo(5) })).toEqual({ state: 'bounced', since: minutesAgo(5) });
    expect(mailAddressState(verified, { reason: 'complained', since: minutesAgo(5) }).state).toBe('complained');
    expect(mailAddressState({ ...verified, emailVerified: false }, null).state).toBe('unverified');
    expect(mailAddressState({ primaryEmail: null, emailVerified: false }, null).state).toBe('no_address');
  });

  it('takes a test only to an address that can be mailed, and a retry only of one that cannot', () => {
    const check = (over: Partial<Parameters<typeof checkMailRequest>[0]>) =>
      checkMailRequest({ kind: 'test', state: 'ok', mailing: true, enabled: true, theirs: [], now: NOW, ...over });
    expect(check({}).ok).toBe(true);
    expect(check({ mailing: false }).ok).toBe(false);
    // System Admins switched members' test emails off: neither a test nor a retry.
    expect(check({ enabled: false })).toMatchObject({ ok: false, reason: expect.stringMatching(/switched these emails off/) });
    expect(check({ kind: 'retry', state: 'bounced', enabled: false }).ok).toBe(false);
    expect(check({ state: 'bounced' }).ok).toBe(false);
    expect(check({ state: 'unverified' }).ok).toBe(false);
    expect(check({ kind: 'retry' }).ok).toBe(false);
    expect(check({ kind: 'retry', state: 'complained' }).ok).toBe(true);
  });

  it('takes one request at a time, a few a day', () => {
    const check = (theirs: MailRequestRecord[]) => checkMailRequest({ kind: 'test', state: 'ok', mailing: true, enabled: true, theirs, now: NOW });
    expect(check([request({ status: 'pending', doneAt: null })]).ok).toBe(false);
    expect(check([request(), request(), request()])).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(check([request(), request(), request({ requestedAt: minutesAgo(25 * 60) })]).ok).toBe(true);
    expect(check([request({ kind: 'retry' }), request({ kind: 'retry' }), request({ kind: 'retry' })]).ok).toBe(true);
    expect(isMailRequestInFlight(request({ status: 'sending', claimedAt: minutesAgo(1) }), NOW)).toBe(true);
    expect(isMailRequestInFlight(request({ status: 'sending', claimedAt: minutesAgo(10) }), NOW)).toBe(false);
  });

  it('sends a test email that says it reached them, with no tracking', () => {
    const message = memberTestMessage({ origin: 'https://vote.example.org', name: 'Ada', contact: 'elections@example.org' });
    expect(message.subject).toBe('Your test email from the US Transhumanist Party');
    expect(message.text).toContain('Hello Ada,');
    expect(message.text).toContain('https://vote.example.org/account');
    expect(message.html).not.toMatch(/<img/i);
  });
});

describe('a System Admin’s test email', () => {
  it('goes to a System Admin, or to a member who has not left or been refused', () => {
    expect(mayGetAdminTest({ systemAdmin: true, memberStatus: null })).toBe(true);
    expect(mayGetAdminTest({ systemAdmin: true, memberStatus: 'resigned' })).toBe(true);
    for (const status of ['applicant', 'active', 'lapsed', 'suspended'] as const) {
      expect(mayGetAdminTest({ systemAdmin: false, memberStatus: status })).toBe(true);
    }
    expect(mayGetAdminTest({ systemAdmin: false, memberStatus: 'resigned' })).toBe(false);
    expect(mayGetAdminTest({ systemAdmin: false, memberStatus: 'rejected' })).toBe(false);
    expect(mayGetAdminTest({ systemAdmin: false, memberStatus: null })).toBe(false);
  });

  it('tells a member what it is, without sending them to a page only System Admins can open', () => {
    const input = { origin: 'https://vote.example.org', name: 'Ada', contact: 'elections@example.org' };
    const admin = adminTestMessage(input);
    expect(admin.text).toContain('This test email was asked for in Admin › Email');
    expect(admin.text).toContain('https://vote.example.org/admin?tab=email');
    const member = adminTestMessage({ ...input, toSystemAdmin: false });
    expect(member.subject).toBe(admin.subject);
    expect(member.text).toContain('Hello Ada,');
    expect(member.text).toContain('An administrator of the site sent you this test email, to check that the site’s email reaches members.');
    expect(member.text).not.toContain('Admin › Email');
    expect(member.text).not.toContain('/admin');
    expect(member.html).not.toContain('/admin');
  });
});
