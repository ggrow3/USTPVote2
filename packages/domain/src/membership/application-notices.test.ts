import { describe, expect, it } from 'vitest';
import { ALWAYS_EMAILED, nextAppNotification } from '../inbox/notifications.js';
import { notificationEmailMessage } from '../notifications/message.js';
import { applicationDecidedNotice, applicationReceivedNotice, applicationWaitingNotice } from './application-notices.js';

const email = (notice: { title: string; link: string; detail?: string }) =>
  notificationEmailMessage({
    origin: 'https://vote.example.org',
    name: 'Robin',
    contact: 'members@example.org',
    period: 'each',
    items: [{ title: notice.title, link: notice.link }],
    application: { detail: notice.detail ?? null },
  });

describe('what an application tells people', () => {
  it('emails the applicant whatever they chose, each kind with its own switch, and never the admins', () => {
    expect(ALWAYS_EMAILED[applicationReceivedNotice('a1').kind]).toBe('applicationReceived');
    expect(ALWAYS_EMAILED[applicationDecidedNotice('a1', 'approve', 'ok').kind]).toBe('applicationApproved');
    expect(ALWAYS_EMAILED[applicationDecidedNotice('a1', 'reject', 'no').kind]).toBe('applicationRejected');
    expect(ALWAYS_EMAILED[applicationWaitingNotice().kind]).toBeUndefined();
  });

  it('says what happens next, and why the email came', () => {
    const received = email(applicationReceivedNotice('a1'));
    expect(received.subject).toBe('We have your application to join the US Transhumanist Party');
    expect(received.text).toContain('A Membership Admin will read it and decide.');
    expect(received.text).toContain('https://vote.example.org/register');
    expect(received.text).toContain('You are getting this email because you applied to join the US Transhumanist Party.');
    expect(received.text).not.toContain('Account page');
    expect(received.text).toContain('Unsubscribe');
  });

  it('gives a rejection its reason, as one line, and says they may apply again', () => {
    const rejected = email(applicationDecidedNotice('a1', 'reject', 'We could not\nconfirm your age'));
    expect(rejected.text).toContain('The Membership Admin who decided it wrote: We could not confirm your age');
    expect(rejected.text).toContain('You may apply again on the Register page.');
    expect(rejected.html).not.toContain('<script');
  });

  it('keeps the detail on the notification, and a waiting notice counts up while unread', () => {
    const notice = applicationDecidedNotice('a1', 'approve', 'ok');
    const record = nextAppNotification(null, { ...notice, accountId: 'acct', at: '2026-11-10T00:00:00.000Z' });
    expect(record).toMatchObject({ kind: 'application_approved', link: '/vote', emailPending: true, count: 1 });
    expect(record.detail).toContain('Welcome.');
    const waiting = nextAppNotification(null, { ...applicationWaitingNotice(), accountId: 'admin', at: '2026-11-10T00:00:00.000Z' });
    expect(waiting).not.toHaveProperty('detail');
    expect(nextAppNotification(waiting, { ...applicationWaitingNotice(), accountId: 'admin', at: '2026-11-10T01:00:00.000Z' }).count).toBe(2);
  });
});
