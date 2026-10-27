import { DEFAULT_NOTICE_SETTINGS, type ElectionDetail, type NoticesView, type NoticeStep } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { leadTimeText, NO_CONTACT, noNoticeText, NOT_SET_UP } from './notice-text.js';

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
      'A System Admin has switched the reminder off (Admin › Election emails).',
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
