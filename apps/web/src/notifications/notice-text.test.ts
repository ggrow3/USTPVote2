import {
  DEFAULT_NOTICE_SETTINGS,
  noticeReceiptTotals,
  type ElectionDetail,
  type NoticesView,
  type NoticeStep,
  type NoticeTestSummary,
} from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import {
  acceptedCount,
  countRows,
  leadTimeText,
  NO_CONTACT,
  noNoticeText,
  NOT_SET_UP,
  receiptText,
  testBlocked,
  testReceiptText,
  testStatusText,
} from './notice-text.js';

describe('leadTimeText', () => {
  it('says the reminder lead time in words', () => {
    expect(leadTimeText(1)).toBe('an hour');
    expect(leadTimeText(12)).toBe('12 hours');
    expect(leadTimeText(24)).toBe('a day');
    expect(leadTimeText(48)).toBe('2 days');
    expect(leadTimeText(36)).toBe('36 hours');
    expect(leadTimeText(168)).toBe('7 days');
  });
});

describe('noNoticeText', () => {
  const detail = {
    election: { state: 'open', opensAt: '2026-11-01T00:00:00Z', closesAt: '2026-11-08T00:00:00Z' },
    roll: null,
  } as unknown as ElectionDetail;
  const view = (reminderHours = 24): NoticesView => ({
    delivery: 'mail',
    contact: 'elections@example.org',
    settings: { ...DEFAULT_NOTICE_SETTINGS, reminderHours },
    notices: [],
    receipts: noticeReceiptTotals([]),
    tests: [],
    setup: null,
  });
  const step = (kind: NoticeStep['kind'], status: NoticeStep['status'], absent: NoticeStep['absent'] = null): NoticeStep => ({
    kind,
    status,
    notice: null,
    absent,
  });

  it('says why an email will not come', () => {
    expect(noNoticeText(step('voting_open', 'not_reached', 'not_set_up'), detail, view())).toBe(NOT_SET_UP);
    expect(noNoticeText(step('voting_open', 'not_reached', 'no_contact'), detail, view())).toBe(NO_CONTACT);
    expect(noNoticeText(step('closing_soon', 'not_reached', 'off'), detail, view())).toBe(
      'A System Admin has switched the reminder off (Admin › Email).',
    );
    expect(noNoticeText(step('closing_soon', 'not_reached', 'short_window'), detail, view(48))).toBe(
      'Voting is open for 2 days or less, so there is no reminder.',
    );
    expect(noNoticeText(step('voting_open', 'not_reached', 'rehearsal'), detail, view())).toBe('A rehearsal roll gets no email.');
  });

  it('says when the reminder will go, with the lead time set', () => {
    const text = noNoticeText(step('closing_soon', 'upcoming'), detail, view(48));
    expect(text).toContain(`On ${new Date('2026-11-06T00:00:00Z').toLocaleString()}, 2 days before voting closes`);
    expect(text).toContain('never how anyone votes');
  });
});

describe('the send receipts and test emails', () => {
  const at = '2026-11-03T12:00:00.000Z';
  const totals = (over: Partial<Parameters<typeof receiptText>[0] & object> = {}) => ({
    kind: 'voting_open' as const,
    sends: 2,
    accepted: 237,
    failed: 0,
    skipped: 0,
    lastSentAt: at,
    ...over,
  });

  it('say how many went to the roll, in how many sends, and when the last finished', () => {
    expect(receiptText(undefined)).toBe('No emails sent yet.');
    expect(receiptText(totals({ sends: 0, accepted: 0, lastSentAt: null }))).toBe('No emails sent yet.');
    const last = new Date(at).toLocaleString();
    expect(receiptText(totals())).toBe(`237 emails sent in 2 sends; the last finished ${last}.`);
    expect(receiptText(totals({ sends: 1, accepted: 1, failed: 1 }))).toBe(
      `1 email sent in 1 send; the last finished ${last}. The mail service did not take 1 message.`,
    );
  });

  it('count test emails apart, and say nothing when there were none', () => {
    expect(testReceiptText(totals({ sends: 0 }))).toBeNull();
    expect(testReceiptText(totals({ sends: 3, accepted: 2 }))).toBe(
      `Test emails to Election Admins: 2 sent, the last ${new Date(at).toLocaleString()}. Not counted above.`,
    );
  });

  const test = (over: Partial<NoticeTestSummary> = {}): NoticeTestSummary => ({
    testId: 't1',
    kind: 'voting_open',
    status: 'pending',
    requestedAt: at,
    claimedAt: null,
    doneAt: null,
    outcome: null,
    sent: false,
    delivery: null,
    ...over,
  });

  it('count what the mail service took, and say what each count means', () => {
    const counts = { pending: 1, sent: 2, delivered: 5, complained: 1, failed: 0, bounced: 1, skipped: 0 };
    expect(acceptedCount(counts)).toBe(8);
    const rows = countRows('voting_open', counts);
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['Delivered', 5],
      ['Sent, no report yet', 2],
      ['Still to send', 1],
      ['Failed', 0],
      ['Bounced', 1],
      ['Marked as spam', 1],
      ['Skipped', 0],
    ]);
    expect(countRows('closing_soon', counts).at(-1)!.note).toMatch(/voted before it went/);
  });

  it('say where the admin’s own test stands', () => {
    expect(testStatusText(test())).toMatch(/^Your test email is queued/);
    expect(testStatusText(test({ status: 'sending', claimedAt: at }))).toBe('Your test email is being sent.');
    expect(testStatusText(test({ status: 'done', doneAt: at, sent: true }))).toMatch(/^Your test email went to your own address.*look in spam\.$/);
    expect(testStatusText(test({ status: 'done', doneAt: at, sent: true, delivery: 'delivered' }))).toMatch(/Your mail server took it/);
    expect(testStatusText(test({ status: 'done', doneAt: at, sent: true, delivery: 'bounced' }))).toMatch(/It bounced/);
    expect(testStatusText(test({ status: 'done', outcome: 'undeliverable' }))).toMatch(/bounced before, or you marked/);
    expect(testStatusText(test({ status: 'done', outcome: 'unverified_address' }))).toBe(
      "Your test email was not sent: your account's email address is not verified.",
    );
  });

  it('offer a test only where the API would take it', () => {
    const now = new Date(at);
    const base: NoticesView = {
      delivery: 'mail',
      contact: 'elections@example.org',
      settings: DEFAULT_NOTICE_SETTINGS,
      notices: [],
      receipts: noticeReceiptTotals([]),
      tests: [],
      setup: null,
    };
    expect(testBlocked(null, now)).toBeNull();
    expect(testBlocked(base, now)).toBeNull();
    expect(testBlocked({ ...base, delivery: 'none' }, now)).toBe(NOT_SET_UP);
    expect(testBlocked({ ...base, contact: null }, now)).toBe(NO_CONTACT);
    expect(testBlocked({ ...base, tests: [test()] }, now)).toBe('Your last test email has not gone yet; wait for it first.');
    expect(testBlocked({ ...base, tests: [test({ status: 'done', sent: true })] }, now)).toBeNull();
  });
});
