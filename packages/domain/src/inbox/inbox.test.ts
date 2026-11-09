import { describe, expect, it } from 'vitest';
import { notificationEmailMessage } from '../notifications/message.js';
import { checkCanMessage, MESSAGES_PER_DAY, NEW_CONVERSATIONS_PER_DAY, otherMember, sendMessageSchema, threadAfterMessage, threadIdOf } from './messages.js';
import { appNotificationId, inboxPreference, nextAppNotification, nextDigestAt, type AppNotificationRecord } from './notifications.js';

const AT = '2026-11-08T10:00:00.000Z';
const input = { accountId: 'a1', kind: 'message' as const, ref: 'a1_a2', title: 'Ada Brooks sent you a message', link: '/messages/a1_a2', at: AT };

describe('a notification', () => {
  it('starts unread and due by email', () => {
    expect(nextAppNotification(null, input)).toEqual({
      notificationId: appNotificationId('a1', 'message', 'a1_a2'),
      accountId: 'a1',
      kind: 'message',
      title: 'Ada Brooks sent you a message',
      link: '/messages/a1_a2',
      ref: 'a1_a2',
      count: 1,
      createdAt: AT,
      updatedAt: AT,
      readAt: null,
      emailPending: true,
      emailedAt: null,
    });
    expect(appNotificationId('a1', 'message', 'a1_a2')).toMatch(/^[0-9a-f]{40}$/);
    expect(appNotificationId('a2', 'message', 'a1_a2')).not.toBe(appNotificationId('a1', 'message', 'a1_a2'));
  });

  it('adds to the one there is while it is unread, without another email', () => {
    const first: AppNotificationRecord = { ...nextAppNotification(null, input), emailPending: false, emailedAt: AT };
    const later = nextAppNotification(first, { ...input, at: '2026-11-08T11:00:00.000Z' });
    expect(later).toMatchObject({ count: 2, createdAt: AT, updatedAt: '2026-11-08T11:00:00.000Z', emailPending: false, emailedAt: AT });
  });

  it('starts afresh once read', () => {
    const read: AppNotificationRecord = { ...nextAppNotification(null, input), count: 4, readAt: AT, emailPending: false, emailedAt: AT };
    expect(nextAppNotification(read, { ...input, at: '2026-11-09T09:00:00.000Z' })).toMatchObject({
      count: 1,
      readAt: null,
      createdAt: '2026-11-09T09:00:00.000Z',
      emailPending: true,
      emailedAt: null,
    });
  });

  it('keeps its title to one line', () => {
    expect(nextAppNotification(null, { ...input, title: 'Ada\nBrooks   sent\tyou a message' }).title).toBe('Ada Brooks sent you a message');
  });
});

describe('digests', () => {
  it('come daily at 13:00 UTC, and weekly on Mondays', () => {
    expect(nextDigestAt('off', new Date(AT))).toBeNull();
    expect(nextDigestAt('each', new Date(AT))).toBeNull();
    // Sunday 8 November 2026, 10:00 UTC.
    expect(nextDigestAt('daily', new Date(AT))).toBe('2026-11-08T13:00:00.000Z');
    expect(nextDigestAt('daily', new Date('2026-11-08T13:00:00.000Z'))).toBe('2026-11-09T13:00:00.000Z');
    expect(nextDigestAt('weekly', new Date(AT))).toBe('2026-11-09T13:00:00.000Z');
    expect(nextDigestAt('weekly', new Date('2026-11-09T14:00:00.000Z'))).toBe('2026-11-16T13:00:00.000Z');
  });

  it('keep their time when the choice stays, and lose it when it goes', () => {
    const daily = inboxPreference(null, 'a1', 'daily', new Date(AT));
    expect(daily).toMatchObject({ notificationEmail: 'daily', digestDueAt: '2026-11-08T13:00:00.000Z', digestSentAt: null });
    expect(inboxPreference(daily, 'a1', 'daily', new Date('2026-11-08T12:00:00.000Z')).digestDueAt).toBe('2026-11-08T13:00:00.000Z');
    expect(inboxPreference(daily, 'a1', 'off', new Date(AT)).digestDueAt).toBeNull();
    expect(inboxPreference({ ...daily, digestSentAt: AT }, 'a1', 'weekly', new Date(AT))).toMatchObject({ digestDueAt: '2026-11-09T13:00:00.000Z', digestSentAt: AT });
  });
});

describe('messages', () => {
  const ok = { from: 'a1', to: 'a2', fromStatus: 'active' as const, toStatus: 'active' as const, blocking: false, blockedBy: false, sentToday: 0, newConversation: true, startedToday: 0 };

  it('go between two Active members', () => {
    expect(checkCanMessage(ok)).toEqual({ ok: true });
    expect(checkCanMessage({ ...ok, to: 'a1' })).toMatchObject({ ok: false, reason: 'you cannot write to yourself' });
    expect(checkCanMessage({ ...ok, fromStatus: 'lapsed' })).toMatchObject({ ok: false, refusal: 'forbidden' });
    expect(checkCanMessage({ ...ok, toStatus: null })).toMatchObject({ ok: false, refusal: 'forbidden' });
  });

  it('are refused by a block without saying it is one', () => {
    const blocked = checkCanMessage({ ...ok, blockedBy: true });
    const lapsed = checkCanMessage({ ...ok, toStatus: 'lapsed' });
    expect(blocked).toEqual(lapsed);
    expect(checkCanMessage({ ...ok, blocking: true })).toMatchObject({ ok: false, reason: expect.stringMatching(/unblock/) });
  });

  it('have daily limits', () => {
    expect(checkCanMessage({ ...ok, sentToday: MESSAGES_PER_DAY })).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(checkCanMessage({ ...ok, startedToday: NEW_CONVERSATIONS_PER_DAY })).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(checkCanMessage({ ...ok, startedToday: NEW_CONVERSATIONS_PER_DAY, newConversation: false })).toEqual({ ok: true });
  });

  it('are plain text of a limited length', () => {
    expect(sendMessageSchema.safeParse({ to: 'a2', body: '  ' }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ to: 'a2', body: 'x'.repeat(2001) }).success).toBe(false);
    expect(sendMessageSchema.parse({ to: 'a2', body: ' Hello ' }).body).toBe('Hello');
  });

  it('make one conversation per pair, whoever starts it', () => {
    expect(threadIdOf('b', 'a')).toBe(threadIdOf('a', 'b'));
    const thread = threadAfterMessage(null, { threadId: 'a_b', from: 'b', to: 'a', body: 'Hi\n\nthere', sentAt: AT });
    expect(thread).toMatchObject({ members: ['a', 'b'], createdBy: 'b', lastSenderId: 'b', lastText: 'Hi there', unread: { a: 1, b: 0 } });
    const reply = threadAfterMessage(thread, { threadId: 'a_b', from: 'a', to: 'b', body: 'Hello', sentAt: '2026-11-08T10:05:00.000Z' });
    expect(reply).toMatchObject({ createdBy: 'b', lastSenderId: 'a', unread: { a: 0, b: 1 } });
    expect(otherMember(reply, 'a')).toBe('b');
  });
});

describe('the notification email', () => {
  const base = { origin: 'https://vote.example.org', name: 'Ada', contact: 'help@example.org', unsubscribe: 'https://vote.example.org/unsubscribe?token=t' };

  it('as each comes names it and links to it, never the words', () => {
    const m = notificationEmailMessage({ ...base, period: 'each', items: [{ title: 'Ben Cruz sent you a message', link: '/messages/a_b' }] });
    expect(m.subject).toBe('Ben Cruz sent you a message');
    expect(m.text).toContain('https://vote.example.org/messages/a_b');
    expect(m.text).toContain('as each comes');
    expect(m.text).toContain('https://vote.example.org/unsubscribe?token=t');
    expect(m.html).toContain('href="https://vote.example.org/account"');
  });

  it('as a digest lists them, and how many more', () => {
    const m = notificationEmailMessage({
      ...base,
      period: 'daily',
      items: [
        { title: 'Ben Cruz sent you a message', link: '/messages/a_b' },
        { title: 'Cy Dee sent you a message', link: '/messages/a_c' },
      ],
      more: 3,
    });
    expect(m.subject).toMatch(/daily notifications/);
    expect(m.text).toContain('You have 5 notifications you have not read');
    expect(m.text).toContain('And 3 more');
    expect(m.text).toContain('once a day');
  });

  it('escapes what it is given', () => {
    const m = notificationEmailMessage({ ...base, period: 'weekly', items: [{ title: '<b>Eve</b> sent you a message', link: '/messages/a_e' }] });
    expect(m.html).not.toContain('<b>Eve</b>');
    expect(m.html).toContain('&lt;b&gt;Eve&lt;/b&gt;');
  });
});
