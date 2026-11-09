import type { MessageReportView, MyNotificationsView, NotificationEmailView, OutboxMessageRecord, ThreadSummary, ThreadView } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InboxRecords } from './inbox/inbox.service.js';
import { NoticeSettingsService } from './notifications/notice-settings.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** In-app notifications, messages between members and notifications by email (design §10.13), the outbox for SES. */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let ada: Member;
let ben: Member;

async function member(email: string, legalName: string, status = 'active'): Promise<Member> {
  const user = await api.member(email);
  await api.firebase.db.collection('members').doc(user.accountId).set({
    accountId: user.accountId,
    status,
    legalName,
    preferredName: null,
    country: 'US',
    state: 'NY',
    communications: { newsletter: null, announcements: null },
  });
  return user;
}

beforeEach(async () => {
  await resetEmulators();
  for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
  [sa1] = (await api.systemAdmins()) as [Member, Member];
  ada = await member('ada@example.test', 'Ada Brooks');
  ben = await member('ben@example.test', 'Ben Cruz');
});

const send = (from: User, to: Member, body = 'Hello there') => api.call('POST', '/v1/messages', from, { to: to.accountId, body });
const notifications = async (as: User) => (await api.call('GET', '/v1/me/notifications', as)).body as MyNotificationsView;
const outbox = async (kind: string) => (await api.firebase.db.collection('notice_outbox').where('kind', '==', kind).get()).docs.map((d) => d.data() as OutboxMessageRecord);

describe('messages between members', () => {
  it('go one to one, and the recipient is notified once per conversation until they read it', async () => {
    const sent = await send(ada, ben);
    expect(sent.status).toBe(201);
    const { threadId } = sent.body as { threadId: string };
    expect((await send(ada, ben, 'Are you coming on Friday?')).status).toBe(201);

    const benSees = await notifications(ben);
    expect(benSees.unread).toBe(1);
    expect(benSees.notifications[0]).toMatchObject({ kind: 'message', title: 'Ada Brooks sent you a message', count: 2, link: `/messages/${threadId}`, readAt: null });
    expect((await notifications(ada)).unread).toBe(0);

    const list = (await api.call('GET', '/v1/messages', ben)).body as ThreadSummary[];
    expect(list).toEqual([expect.objectContaining({ threadId, with: { accountId: ada.accountId, name: 'Ada Brooks', active: true }, unread: 2, lastFromMe: false, lastText: 'Are you coming on Friday?' })]);
    const view = (await api.call('GET', `/v1/messages/${threadId}`, ben)).body as ThreadView;
    expect(view.messages.map((m) => [m.body, m.fromMe])).toEqual([
      ['Hello there', false],
      ['Are you coming on Friday?', false],
    ]);

    expect((await api.call('POST', `/v1/messages/${threadId}/read`, ben)).status).toBe(204);
    expect((await notifications(ben)).unread).toBe(0);
    expect(((await api.call('GET', '/v1/messages', ben)).body as ThreadSummary[])[0]!.unread).toBe(0);

    // A reply goes the other way, in the same conversation.
    expect(((await send(ben, ada, 'Yes')).body as { threadId: string }).threadId).toBe(threadId);
    expect((await notifications(ada)).notifications[0]).toMatchObject({ title: 'Ben Cruz sent you a message', count: 1 });
  });

  it('are read by the two alone', async () => {
    const cy = await member('cy@example.test', 'Cy Dee');
    const { threadId } = (await send(ada, ben)).body as { threadId: string };
    expect((await api.call('GET', `/v1/messages/${threadId}`, cy)).status).toBe(403);
    expect((await api.call('POST', `/v1/messages/${threadId}/read`, cy)).status).toBe(403);
    expect((await api.call('GET', '/v1/messages', cy)).body).toEqual([]);
  });

  it('need both to be Active members, and not the same', async () => {
    const lapsed = await member('lapsed@example.test', 'Lee Lapsed', 'lapsed');
    expect((await send(lapsed, ada)).status).toBe(403);
    expect((await send(ada, lapsed)).status).toBe(403);
    expect((await api.call('POST', '/v1/messages', ada, { to: ada.accountId, body: 'Me' })).status).toBe(409);
    expect((await api.call('POST', '/v1/messages', ada, { to: ben.accountId, body: '   ' })).status).toBe(400);
  });

  it('find Active members by name, the caller left out', async () => {
    const found = (await api.call('GET', '/v1/messages/people?name=a', ada)).body as { accountId: string }[];
    expect(found.map((f) => f.accountId)).not.toContain(ada.accountId);
    expect((await api.call('GET', '/v1/messages/people?name=cruz', ada)).body).toEqual([{ accountId: ben.accountId, name: 'Ben Cruz' }]);
    expect((await api.call('GET', `/v1/messages/people/${ben.accountId}`, ada)).body).toMatchObject({ person: { name: 'Ben Cruz' }, exists: false, blocking: false });
  });

  it('stop when the recipient blocks the sender, who is told only that they cannot', async () => {
    const lapsed = await member('lapsed@example.test', 'Lee Lapsed', 'lapsed');
    expect((await api.call('POST', `/v1/messages/blocks/${ada.accountId}`, ben)).status).toBe(204);
    const refused = await send(ada, ben);
    const notActive = await send(ada, lapsed);
    expect(refused.status).toBe(403);
    expect((refused.body as { detail?: string; message?: string }).detail ?? (refused.body as { message?: string }).message).toBe(
      (notActive.body as { detail?: string; message?: string }).detail ?? (notActive.body as { message?: string }).message,
    );
    expect((await send(ben, ada)).status).toBe(409);
    expect((await api.call('DELETE', `/v1/messages/blocks/${ada.accountId}`, ben)).status).toBe(204);
    expect((await send(ada, ben)).status).toBe(201);
  });

  it('can be reported by the one who got it, which the Membership Admins see alone', async () => {
    const ma = await member('ma@example.test', 'Mo Admin');
    await api.grant(ma.accountId, 'membership_admin', sa1);
    await send(ada, ben, 'First, harmless');
    const { message } = (await send(ada, ben, 'Something abusive')).body as { message: { messageId: string } };

    expect((await api.call('POST', `/v1/messages/reports/${message.messageId}`, ada, { reason: 'mine' })).status).toBe(409);
    const reported = await api.call('POST', `/v1/messages/reports/${message.messageId}`, ben, { reason: 'abusive' });
    expect(reported.status).toBe(201);
    expect(reported.body).toMatchObject({ reported: true });
    expect((await api.call('POST', `/v1/messages/reports/${message.messageId}`, ben, { reason: 'again' })).status).toBe(409);

    expect((await notifications(ma)).notifications[0]).toMatchObject({ kind: 'message_report', link: '/admin?tab=forum' });
    expect((await api.call('GET', '/v1/admin/message-reports', ben)).status).toBe(403);
    const reports = (await api.call('GET', '/v1/admin/message-reports', ma)).body as MessageReportView[];
    expect(reports).toEqual([expect.objectContaining({ body: 'Something abusive', reason: 'abusive', fromName: 'Ada Brooks', reportedByName: 'Ben Cruz', status: 'open' })]);
    expect(JSON.stringify(reports)).not.toContain('First, harmless');

    expect((await api.call('POST', `/v1/admin/message-reports/${reports[0]!.reportId}/close`, ma, { note: 'spoke to Ada' })).status).toBe(204);
    expect(((await api.call('GET', '/v1/admin/message-reports', ma)).body as MessageReportView[])[0]).toMatchObject({ status: 'closed', note: 'spoke to Ada' });
    expect((await api.call('POST', `/v1/admin/message-reports/${reports[0]!.reportId}/close`, ma, {})).status).toBe(409);
  });

  it('go with an account that is deleted', async () => {
    const { threadId } = (await send(ada, ben)).body as { threadId: string };
    await api.app.get(InboxRecords).forgetAccount(ada.accountId);
    expect((await api.call('GET', '/v1/messages', ben)).body).toEqual([]);
    expect((await api.call('GET', `/v1/messages/${threadId}`, ben)).status).toBe(404);
    expect((await notifications(ben)).notifications).toEqual([]);
    expect((await api.firebase.db.collection('member_messages').where('threadId', '==', threadId).get()).size).toBe(0);
  });
});

describe('notifications', () => {
  it('are marked read one at a time or all at once, each only by its owner', async () => {
    const cy = await member('cy@example.test', 'Cy Dee');
    await send(ada, ben);
    await send(cy, ben);
    const view = await notifications(ben);
    expect(view.unread).toBe(2);
    expect((await api.call('POST', `/v1/me/notifications/${view.notifications[0]!.notificationId}/read`, ada)).status).toBe(403);
    expect((await api.call('POST', `/v1/me/notifications/${view.notifications[0]!.notificationId}/read`, ben)).status).toBe(204);
    expect((await api.call('GET', '/v1/me/notifications/unread', ben)).body).toEqual({ unread: 1 });
    expect(((await api.call('POST', '/v1/me/notifications/read-all', ben)).body as MyNotificationsView).unread).toBe(0);
  });
});

describe('notifications by email', () => {
  const choose = (as: User, notificationEmail: string) => api.call('PUT', '/v1/me/notification-email', as, { notificationEmail });

  it('are off until the member chooses, and then come as each comes, never with the words', async () => {
    expect((await api.call('GET', '/v1/me/notification-email', ben)).body).toMatchObject({ notificationEmail: 'off', mail: 'ok', sending: true });
    await send(ada, ben, 'A private word');
    await worker.tick();
    expect(await outbox('notification')).toEqual([]);

    expect((await choose(ben, 'each')).body).toMatchObject({ notificationEmail: 'each', digestDueAt: null });
    await api.call('POST', '/v1/me/notifications/read-all', ben);
    const { threadId } = (await send(ada, ben, 'Another private word')).body as { threadId: string };
    await send(ada, ben, 'And a third');
    expect((await worker.tick()).body).toMatchObject({ notificationEmailsSent: 1 });
    const [email] = await outbox('notification');
    expect(email).toMatchObject({ to: 'ben@example.test', accountId: ben.accountId, subject: 'Ada Brooks sent you a message' });
    expect(email!.text).not.toContain('private word');
    // It leads to the Messages page, never to the conversation, whose address names both accounts.
    expect(email!.text).toContain('/messages');
    expect(email!.text).not.toContain(threadId);
    expect(email!.listUnsubscribe).toBeTruthy();
    // The email log has it, caused by the site.
    expect((await api.call('GET', '/v1/admin/mail/log?kind=notification', sa1)).body).toMatchObject({ rows: [{ accountId: ben.accountId, causedBy: 'system' }] });
    // No second email about it while it is unread.
    await worker.tick();
    expect(await outbox('notification')).toHaveLength(1);
  });

  it('come as a digest of what is unread, when it is due', async () => {
    const chosen = (await choose(ben, 'daily')).body as NotificationEmailView;
    expect(chosen.digestDueAt).toMatch(/T13:00:00.000Z$/);
    await send(ada, ben);
    await worker.tick();
    expect(await outbox('notification_digest')).toEqual([]);

    await api.firebase.db.collection('inbox_preferences').doc(ben.accountId).update({ digestDueAt: new Date(Date.now() - 1000).toISOString() });
    await worker.tick();
    const [digest] = await outbox('notification_digest');
    expect(digest).toMatchObject({ to: 'ben@example.test', subject: 'Your daily notifications from the US Transhumanist Party' });
    expect(digest!.text).toContain('Ada Brooks sent you a message');
    const after = (await api.firebase.db.collection('inbox_preferences').doc(ben.accountId).get()).data()!;
    expect(Date.parse(after.digestDueAt as string)).toBeGreaterThan(Date.now());

    // Nothing new since: the next digest has nothing to say, so none goes.
    await api.firebase.db.collection('inbox_preferences').doc(ben.accountId).update({ digestDueAt: new Date(Date.now() - 1000).toISOString() });
    await worker.tick();
    expect(await outbox('notification_digest')).toHaveLength(1);
  });

  it('go nowhere while all email is off, after an unsubscribe, or with the switch off, and do not wait', async () => {
    await choose(ben, 'each');
    await api.firebase.db.collection('notice_settings').doc('current').delete();
    worker.app.get(NoticeSettingsService).invalidate();
    api.app.get(NoticeSettingsService).invalidate();
    expect((await api.call('GET', '/v1/me/notification-email', ben)).body).toMatchObject({ sending: false });
    await send(ada, ben);
    await worker.tick();
    expect(await outbox('notification')).toEqual([]);
    // Switched back on, what came while it was off does not follow.
    await api.firebase.db.collection('notice_settings').doc('current').set({ allEmails: true });
    worker.app.get(NoticeSettingsService).invalidate();
    await worker.tick();
    expect(await outbox('notification')).toEqual([]);

    await api.call('POST', '/v1/me/email/unsubscribe', ben);
    expect((await api.call('GET', '/v1/me/notification-email', ben)).body).toMatchObject({ mail: 'unsubscribed' });
    await api.call('POST', '/v1/me/notifications/read-all', ben);
    await send(ada, ben);
    await worker.tick();
    expect(await outbox('notification')).toEqual([]);
  });

  it('refuse a choice there is not', async () => {
    expect((await choose(ben, 'hourly')).status).toBe(400);
  });
});
