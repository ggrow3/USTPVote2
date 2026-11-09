import { describe, expect, it } from 'vitest';
import { NOTIFICATION_EMAIL_CHOICES } from 'ustp-domain';
import { badgeText, bellLabel, EMAIL_CHOICE_LABELS, emailCaveat, notificationLine, whenText } from './inbox-text.js';

describe('the bell', () => {
  it('says how many are unread, capped on the badge', () => {
    expect(bellLabel(0)).toBe('Notifications, none unread');
    expect(bellLabel(3)).toBe('Notifications, 3 unread');
    expect(bellLabel(150)).toBe('Notifications, more than 99 unread');
    expect(badgeText(7)).toBe('7');
    expect(badgeText(100)).toBe('99+');
  });
});

describe('a notification', () => {
  it('says how many times it happened', () => {
    expect(notificationLine({ title: 'Ada sent you a message', count: 1, kind: 'message' })).toBe('Ada sent you a message');
    expect(notificationLine({ title: 'Ada sent you a message', count: 3, kind: 'message' })).toBe('Ada sent you a message (3 new)');
    expect(notificationLine({ title: 'A member reported a message', count: 2, kind: 'message_report' })).toBe('A member reported a message (2 times)');
  });

  it('says when, briefly', () => {
    const now = new Date('2026-11-08T12:00:00.000Z');
    expect(whenText('2026-11-08T11:59:40.000Z', now)).toBe('just now');
    expect(whenText('2026-11-08T11:55:00.000Z', now)).toBe('5 min ago');
    expect(whenText('2026-11-08T09:00:00.000Z', now)).toBe('3 h ago');
    expect(whenText('2026-11-01T09:00:00.000Z', now)).not.toMatch(/ago/);
  });
});

describe('notifications by email', () => {
  it('names every choice', () => {
    for (const choice of NOTIFICATION_EMAIL_CHOICES) expect(EMAIL_CHOICE_LABELS[choice].label).toBeTruthy();
  });

  it('says why they would not come', () => {
    expect(emailCaveat({ notificationEmail: 'off', mail: 'unsubscribed', sending: false })).toBeNull();
    expect(emailCaveat({ notificationEmail: 'daily', mail: 'ok', sending: true })).toBeNull();
    expect(emailCaveat({ notificationEmail: 'daily', mail: 'unsubscribed', sending: true })).toMatch(/unsubscribed/);
    expect(emailCaveat({ notificationEmail: 'each', mail: 'email_stopped', sending: true })).toMatch(/administrator/);
    expect(emailCaveat({ notificationEmail: 'each', mail: 'unverified', sending: true })).toMatch(/not confirmed/);
    expect(emailCaveat({ notificationEmail: 'weekly', mail: 'ok', sending: false })).toMatch(/switched off/);
  });
});
