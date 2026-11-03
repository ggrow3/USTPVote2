import { describe, expect, it } from 'vitest';
import { checkMailRequest, isMailRequestInFlight, mailAddressState, memberTestMessage, type MailRequestRecord } from '../index.js';

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
      checkMailRequest({ kind: 'test', state: 'ok', mailing: true, theirs: [], now: NOW, ...over });
    expect(check({}).ok).toBe(true);
    expect(check({ mailing: false }).ok).toBe(false);
    expect(check({ state: 'bounced' }).ok).toBe(false);
    expect(check({ state: 'unverified' }).ok).toBe(false);
    expect(check({ kind: 'retry' }).ok).toBe(false);
    expect(check({ kind: 'retry', state: 'complained' }).ok).toBe(true);
  });

  it('takes one request at a time, a few a day', () => {
    const check = (theirs: MailRequestRecord[]) => checkMailRequest({ kind: 'test', state: 'ok', mailing: true, theirs, now: NOW });
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
