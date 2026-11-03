import { describe, expect, it } from 'vitest';
import {
  noticeVerificationTotals,
  pendingVerification,
  sendGate,
  verifySend,
  type MailCheck,
  type MailHealthRecord,
} from '../index.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const check = (id: MailCheck['id'], status: MailCheck['status']): MailCheck => ({ id, status, detail: '', fix: null });
const health = (checks: MailCheck[], checkedAt = minutesAgo(10)): Pick<MailHealthRecord, 'checkedAt' | 'checks'> => ({ checkedAt, checks });

describe('before each send', () => {
  it('asks for a fresh setup check where mail goes through SES', () => {
    expect(sendGate(null, NOW, true)).toEqual({ stale: true, failing: [] });
    expect(sendGate(health([], minutesAgo(61)), NOW, true)).toEqual({ stale: true, failing: [] });
    expect(sendGate(health([check('dkim', 'ok')]), NOW, true)).toEqual({ stale: false, failing: [] });
  });

  it('holds while a check that keeps mail from arriving, or from being verified, fails', () => {
    const failing = health([check('sending', 'fail'), check('queue', 'fail'), check('dmarc', 'warn'), check('probe', 'pending')]);
    expect(sendGate(failing, NOW, true)).toEqual({ stale: false, failing: ['sending', 'queue'] });
  });

  it('is not held by the 30-day rates or Identity Platform’s own mail', () => {
    const rates = health([check('bounce_rate', 'fail'), check('complaint_rate', 'fail'), check('identity_platform', 'fail')]);
    expect(sendGate(rates, NOW, true).failing).toEqual([]);
  });

  it('in the outbox, asks for nothing and needs no contact, but a fresh failing check still holds it', () => {
    expect(sendGate(null, NOW, false)).toEqual({ stale: false, failing: [] });
    expect(sendGate(health([check('contact', 'fail')]), NOW, false).failing).toEqual([]);
    expect(sendGate(health([check('contact', 'fail'), check('probe', 'fail')]), NOW, false).failing).toEqual(['probe']);
    expect(sendGate(health([check('probe', 'fail')], minutesAgo(90)), NOW, false).failing).toEqual([]);
  });
});

describe('after each send', () => {
  const pending = pendingVerification({
    receiptId: 'r1',
    electionId: 'e1',
    kind: 'voting_open',
    noticeId: 'e1_voting_open',
    round: 1,
    finishedAt: minutesAgo(31),
    messages: 6,
  });

  it('is checked 30 minutes after it finished', () => {
    expect(pending).toMatchObject({ status: 'pending', dueAt: minutesAgo(1), checkedAt: null, messages: 6 });
  });

  it('is ok when every message reached its mail server, marked as spam or not', () => {
    expect(verifySend(pending, ['delivered', 'delivered', 'complained'], NOW)).toMatchObject({
      status: 'ok',
      messages: 3,
      delivered: 2,
      complained: 1,
      checkedAt: NOW.toISOString(),
    });
  });

  it('falls short for each message delayed, bounced, rejected or with no report', () => {
    const v = verifySend(pending, ['delivered', 'delayed', 'bounced', 'rejected', 'sent', null], NOW);
    expect(v).toMatchObject({ status: 'short', messages: 6, delivered: 1, delayed: 1, bounced: 1, rejected: 1, noReport: 2 });
  });

  it('adds up per email for the card, the pending apart', () => {
    const ok = verifySend(pending, ['delivered', 'delivered'], NOW);
    const short = verifySend({ ...pending, receiptId: 'r2' }, ['delivered', 'bounced', 'complained'], new Date(NOW.getTime() + 60_000));
    const waiting = { ...pending, receiptId: 'r3' };
    const [open, closing, voted] = noticeVerificationTotals([ok, short, waiting]);
    expect(open).toEqual({
      kind: 'voting_open',
      checked: 2,
      pending: 1,
      shortSends: 1,
      messages: 5,
      delivered: 4,
      delayed: 0,
      bounced: 1,
      rejected: 0,
      noReport: 0,
      lastCheckedAt: short.checkedAt,
    });
    expect(closing).toMatchObject({ kind: 'closing_soon', checked: 0, pending: 0, lastCheckedAt: null });
    expect(voted!.kind).toBe('voted');
  });
});
