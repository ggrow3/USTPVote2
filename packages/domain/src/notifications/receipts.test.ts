import { describe, expect, it } from 'vitest';
import {
  checkNoticeTest,
  closingSoonMessage,
  isTestInFlight,
  MAX_NOTICE_TESTS_PER_DAY,
  noticeMessage,
  noticeReceipt,
  noticeReceiptTotals,
  noticeTestRecord,
  noticeTestSummary,
  TEST_NOTE,
  TEST_SUBJECT_PREFIX,
  testNoticeTag,
  type NoticeMessageInput,
  type NoticeTestRecord,
  type ReceiptCounts,
} from '../index.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe('noticeReceipt', () => {
  const receipt = (results: Parameters<typeof noticeReceipt>[0]['results']) =>
    noticeReceipt({
      receiptId: 'r1',
      electionId: 'e1',
      kind: 'voting_open',
      test: false,
      noticeId: 'e1_voting_open',
      round: 1,
      delivery: 'mail',
      triggeredBy: 'system',
      recipientAccountId: null,
      startedAt: minutesAgo(1),
      finishedAt: NOW.toISOString(),
      results,
    });

  it('counts what the mail service took and refused, and keeps its message IDs', () => {
    const r = receipt([
      { status: 'sent', messageId: 'm1' },
      { status: 'sent', messageId: 'm2' },
      { status: 'failed', outcome: 'refused' },
      { status: 'failed', outcome: 'unavailable' },
      { status: 'skipped', outcome: 'unverified_address' },
    ]);
    expect(r).toEqual({
      receiptId: 'r1',
      electionId: 'e1',
      kind: 'voting_open',
      test: false,
      noticeId: 'e1_voting_open',
      round: 1,
      delivery: 'mail',
      triggeredBy: 'system',
      recipientAccountId: null,
      startedAt: minutesAgo(1),
      finishedAt: NOW.toISOString(),
      recipients: 5,
      accepted: 2,
      failed: 2,
      skipped: 1,
      messageIds: ['m1', 'm2'],
    });
  });

  it('leaves no receipt for a send that handled nobody', () => {
    expect(receipt([])).toBeNull();
  });
});

describe('noticeReceiptTotals', () => {
  const receipt = (over: Partial<ReceiptCounts>): ReceiptCounts => ({
    kind: 'voting_open',
    test: false,
    accepted: 0,
    failed: 0,
    skipped: 0,
    finishedAt: minutesAgo(60),
    ...over,
  });

  it('adds up each email’s sends to the roll, with the time of the last', () => {
    const totals = noticeReceiptTotals([
      receipt({ accepted: 200, failed: 1, finishedAt: minutesAgo(60) }),
      receipt({ accepted: 37, skipped: 2, finishedAt: minutesAgo(59) }),
      receipt({ kind: 'closing_soon', accepted: 12, finishedAt: minutesAgo(5) }),
    ]);
    expect(totals.roll).toEqual([
      { kind: 'voting_open', sends: 2, accepted: 237, failed: 1, skipped: 2, lastSentAt: minutesAgo(59) },
      { kind: 'closing_soon', sends: 1, accepted: 12, failed: 0, skipped: 0, lastSentAt: minutesAgo(5) },
    ]);
  });

  it('counts test emails apart, never with the roll', () => {
    const totals = noticeReceiptTotals([
      receipt({ accepted: 4 }),
      receipt({ test: true, accepted: 1, finishedAt: minutesAgo(1) }),
      receipt({ test: true, failed: 1, finishedAt: minutesAgo(2) }),
    ]);
    expect(totals.roll[0]).toMatchObject({ sends: 1, accepted: 4, failed: 0, lastSentAt: minutesAgo(60) });
    expect(totals.tests[0]).toEqual({ kind: 'voting_open', sends: 2, accepted: 1, failed: 1, skipped: 0, lastSentAt: minutesAgo(1) });
    expect(totals.tests[1]).toEqual({ kind: 'closing_soon', sends: 0, accepted: 0, failed: 0, skipped: 0, lastSentAt: null });
  });

  it('gives every email a line, in order, when nothing was sent', () => {
    const totals = noticeReceiptTotals([]);
    expect(totals.roll.map((t) => [t.kind, t.sends, t.lastSentAt])).toEqual([
      ['voting_open', 0, null],
      ['closing_soon', 0, null],
    ]);
    expect(totals.tests).toHaveLength(2);
  });
});

describe('test emails', () => {
  const test = (over: Partial<NoticeTestRecord> = {}): NoticeTestRecord => ({
    ...noticeTestRecord({ testId: 't1', electionId: 'e1', kind: 'voting_open', caller: { accountId: 'ea', operator: null }, now: new Date(minutesAgo(30)) }),
    ...over,
  });

  it('go to the caller’s own account, and to the signed-in System Admin when they act as a persona', () => {
    expect(test()).toMatchObject({ requestedBy: 'ea', accountId: 'ea', status: 'pending', outcome: null, receiptId: null });
    const acting = noticeTestRecord({
      testId: 't2',
      electionId: 'e1',
      kind: 'closing_soon',
      caller: { accountId: 'persona-ea', operator: 'sa1' },
      now: NOW,
    });
    expect(acting).toMatchObject({ requestedBy: 'persona-ea', accountId: 'sa1', requestedAt: NOW.toISOString() });
    // The record names accounts only; the worker reads the address from the account when it sends.
    expect(JSON.stringify(acting)).not.toContain('@');
  });

  it('are in flight while queued or freshly claimed, not once done or interrupted', () => {
    expect(isTestInFlight(test(), NOW)).toBe(true);
    expect(isTestInFlight(test({ status: 'sending', claimedAt: minutesAgo(1) }), NOW)).toBe(true);
    expect(isTestInFlight(test({ status: 'sending', claimedAt: minutesAgo(5) }), NOW)).toBe(false);
    expect(isTestInFlight(test({ status: 'done', doneAt: minutesAgo(1) }), NOW)).toBe(false);
  });

  it('are refused where nothing would be mailed, as the real emails would not be', () => {
    const check = (over: Partial<Parameters<typeof checkNoticeTest>[0]>) =>
      checkNoticeTest({ delivery: 'mail', contact: 'elections@example.org', theirs: [], now: NOW, ...over });
    expect(check({})).toEqual({ ok: true });
    expect(check({ delivery: 'none' })).toMatchObject({ ok: false, reason: expect.stringMatching(/sends no email/) });
    expect(check({ contact: null })).toMatchObject({ ok: false, reason: expect.stringMatching(/no contact/) });
    // The outbox is never mailed, so it needs no contact.
    expect(check({ delivery: 'outbox', contact: null })).toEqual({ ok: true });
  });

  it('go one at a time, and at most so many a day', () => {
    const check = (theirs: NoticeTestRecord[]) => checkNoticeTest({ delivery: 'mail', contact: 'x@example.org', theirs, now: NOW });
    expect(check([test()])).toMatchObject({ ok: false, reason: expect.stringMatching(/not gone yet/) });
    expect(check([test({ status: 'done', doneAt: minutesAgo(29) })])).toEqual({ ok: true });
    // A claim the worker never finished does not hold the next test up.
    expect(check([test({ status: 'sending', claimedAt: minutesAgo(10) })])).toEqual({ ok: true });

    const done = (hoursAgo: number) => test({ status: 'done', requestedAt: minutesAgo(hoursAgo * 60) });
    const today = Array.from({ length: MAX_NOTICE_TESTS_PER_DAY }, () => done(2));
    expect(check(today)).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(check([...today.slice(1), done(25)])).toEqual({ ok: true });
  });

  it('are summarised for the editor: sent when done without an outcome', () => {
    expect(noticeTestSummary(test())).toMatchObject({ testId: 't1', status: 'pending', sent: false });
    expect(noticeTestSummary(test({ status: 'done', doneAt: minutesAgo(1) }))).toMatchObject({ status: 'done', sent: true });
    expect(noticeTestSummary(test({ status: 'done', outcome: 'unverified_address' }))).toMatchObject({ sent: false, outcome: 'unverified_address' });
    expect(Object.keys(noticeTestSummary(test()))).not.toContain('accountId');
  });

  it('carry a tag of their own, so a bounce report never matches a roll member', () => {
    expect(testNoticeTag('e1', 'voting_open')).toBe('e1_voting_open_test');
  });
});

describe('a test email’s message', () => {
  const input = (over: Partial<NoticeMessageInput> = {}): NoticeMessageInput => ({
    election: {
      electionId: 'e1',
      title: 'Officers 2026',
      description: 'Choose the chair.',
      opensAt: '2026-11-02T14:00:00.000Z',
      closesAt: '2026-11-07T04:59:00.000Z',
    },
    origin: 'https://vote.example.org',
    name: 'Alex',
    contact: 'elections@example.org',
    now: NOW,
    ...over,
  });

  it('is the real email, marked as a test in the subject and at the top', () => {
    for (const kind of ['voting_open', 'closing_soon'] as const) {
      const real = noticeMessage(kind, input());
      const test = noticeMessage(kind, input({ test: true }));
      expect(test.subject).toBe(`${TEST_SUBJECT_PREFIX}${real.subject}`);
      expect(test.text).toBe(`${TEST_NOTE}\n\n${real.text}`);
      expect(test.html).toContain(`<title>${TEST_SUBJECT_PREFIX}`);
      expect(test.html).toContain('TEST EMAIL. This was sent only to you');
      expect(real.subject).not.toContain('TEST');
      expect(real.text).not.toContain('TEST EMAIL');
    }
  });

  it('keeps the marked subject to the subject’s length', () => {
    const long = closingSoonMessage(input({ test: true, text: { subject: `{title} ${'x'.repeat(150)}`, intro: null } }));
    expect(long.subject.startsWith(TEST_SUBJECT_PREFIX)).toBe(true);
    expect(long.subject.length).toBeLessThanOrEqual(200);
  });
});
