import type { InboxPage, InboxThreadView, MailLogPage, MyNotificationsView, MyTeamThreadSummary, MyTeamThreadView, OutboxMessageRecord } from 'ustp-domain';
import { MEMBER_INBOX_STARTS_PER_DAY } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InboxRecords } from './inbox/inbox.service.js';
import { NoticeSettingsService } from './notifications/notice-settings.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** The membership inbox (design §10.13): the membership team's conversations with each member, and their emails. */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let ma: Member;
let mb: Member;
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
    // Neither news nor announcements: the team's messages are membership business, so they go anyway.
    communications: { newsletter: null, announcements: null },
  });
  return user;
}

beforeEach(async () => {
  await resetEmulators();
  for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
  [sa1] = (await api.systemAdmins()) as [Member, Member];
  ma = await member('ma@example.test', 'Mo Admin');
  mb = await member('mb@example.test', 'Mia Bell');
  await api.grant(ma.accountId, 'membership_admin', sa1);
  await api.grant(mb.accountId, 'membership_admin', sa1);
  ada = await member('ada@example.test', 'Ada Brooks');
  ben = await member('ben@example.test', 'Ben Cruz');
});

const notifications = async (as: User) => (await api.call('GET', '/v1/me/notifications', as)).body as MyNotificationsView;
const outbox = async (kind: string) => (await api.firebase.db.collection('notice_outbox').where('kind', '==', kind).get()).docs.map((d) => d.data() as OutboxMessageRecord);
const teamWrites = (as: User, accountId: string, subject = 'Your dues', body = 'Hello Ada, your dues are paid.') =>
  api.call('POST', '/v1/admin/inbox', as, { accountId, subject, body });
const memberWrites = (as: User, subject = 'A question', body = 'How do I renew?') => api.call('POST', '/v1/membership-team', as, { subject, body });
const teamView = async (as: User, threadId: string) => (await api.call('GET', `/v1/admin/inbox/${threadId}`, as)).body as InboxThreadView;

describe('the membership team writes to a member', () => {
  it('reaches them in the app and by email, as membership business, signed by the team', async () => {
    const started = await teamWrites(ma, ada.accountId);
    expect(started.status).toBe(201);
    const view = started.body as InboxThreadView;
    expect(view).toMatchObject({ accountId: ada.accountId, memberName: 'Ada Brooks', subject: 'Your dues', status: 'answered', startedBy: 'team', emailSkip: null });
    expect(view.messages).toEqual([expect.objectContaining({ from: 'team', authorId: ma.accountId, authorName: 'Mo Admin', note: false, email: { status: 'pending', reason: null, at: null } })]);

    expect((await notifications(ada)).notifications[0]).toMatchObject({
      kind: 'membership_message',
      title: 'The membership team wrote to you: Your dues',
      link: `/messages/team/${view.threadId}`,
    });

    expect((await worker.tick()).body).toMatchObject({ membershipEmailsSent: 1 });
    const [email] = await outbox('membership_message');
    expect(email).toMatchObject({ to: 'ada@example.test', accountId: ada.accountId, subject: 'Your dues' });
    expect(email!.text).toContain('your dues are paid');
    expect(email!.text).toContain(`/messages/team/${view.threadId}`);
    expect(email!.text).not.toContain('Mo Admin');
    expect(email!.listUnsubscribe).toBeTruthy();
    expect((await teamView(mb, view.threadId)).messages[0]!.email).toMatchObject({ status: 'sent', reason: null });

    // In the email log, caused by the admin who wrote it, and on the member's record for Membership Admins.
    expect((await api.call('GET', '/v1/admin/mail/log?kind=membership_message', sa1)).body).toMatchObject({
      rows: [{ accountId: ada.accountId, causedBy: ma.accountId, causedByName: 'Mo Admin', ref: view.threadId }],
    });
    const record = (await api.call('GET', `/v1/admin/mail/log/members/${ada.accountId}`, mb)).body as MailLogPage;
    expect(record.rows.map((r) => r.kind)).toContain('membership_message');
    expect((await api.call('GET', `/v1/admin/mail/log/members/${ada.accountId}`, ben)).status).toBe(403);

    // The member sees the team, never the admin.
    const mine = (await api.call('GET', '/v1/membership-team', ada)).body as MyTeamThreadSummary[];
    expect(mine).toEqual([expect.objectContaining({ threadId: view.threadId, subject: 'Your dues', closed: false, lastFromTeam: true, unread: 1 })]);
    const thread = await api.call('GET', `/v1/membership-team/${view.threadId}`, ada);
    expect((thread.body as MyTeamThreadView).messages).toEqual([expect.objectContaining({ fromTeam: true, body: 'Hello Ada, your dues are paid.' })]);
    expect(JSON.stringify(thread.body)).not.toContain(ma.accountId);
    expect(JSON.stringify(thread.body)).not.toContain('Mo Admin');

    // Opening it reads it, and the team sees when.
    expect((await api.call('POST', `/v1/membership-team/${view.threadId}/read`, ada)).status).toBe(204);
    expect((await notifications(ada)).unread).toBe(0);
    expect((await teamView(ma, view.threadId)).memberReadAt).not.toBeNull();
  });

  it('is not emailed again as a notification, for a member who has those as each comes', async () => {
    await api.call('PUT', '/v1/me/notification-email', ada, { notificationEmail: 'each' });
    await teamWrites(ma, ada.accountId);
    await worker.tick();
    expect(await outbox('membership_message')).toHaveLength(1);
    expect(await outbox('notification')).toEqual([]);
  });

  it('stays in the app when email cannot reach them, and the team sees why', async () => {
    await api.call('POST', '/v1/me/email/unsubscribe', ada);
    const view = (await teamWrites(ma, ada.accountId)).body as InboxThreadView;
    expect(view.emailSkip).toBe('unsubscribed');
    await worker.tick();
    expect(await outbox('membership_message')).toEqual([]);
    expect((await teamView(ma, view.threadId)).messages[0]!.email).toMatchObject({ status: 'not_sent', reason: 'unsubscribed' });
    expect((await notifications(ada)).unread).toBe(1);

    // All email off: nothing goes, and nothing waits for it to come back on.
    await api.firebase.db.collection('notice_settings').doc('current').delete();
    for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
    const toBen = (await teamWrites(ma, ben.accountId, 'Hello', 'Welcome, Ben.')).body as InboxThreadView;
    expect(toBen.emailSkip).toBe('email_off');
    await worker.tick();
    expect((await teamView(ma, toBen.threadId)).messages[0]!.email).toMatchObject({ status: 'not_sent', reason: 'email_off' });
    await api.firebase.db.collection('notice_settings').doc('current').set({ allEmails: true });
    worker.app.get(NoticeSettingsService).invalidate();
    await worker.tick();
    expect(await outbox('membership_message')).toEqual([]);
  });
});

describe('a member writes to the team', () => {
  it('notifies every Membership Admin, and moves between needing an answer, answered and closed', async () => {
    const started = await memberWrites(ada);
    expect(started.status).toBe(201);
    const { threadId } = started.body as MyTeamThreadView;
    for (const admin of [ma, mb]) {
      expect((await notifications(admin)).notifications[0]).toMatchObject({
        kind: 'membership_inbox',
        title: 'Ada Brooks wrote to the membership team: A question',
        link: `/admin/inbox/${threadId}`,
      });
    }
    const page = (await api.call('GET', '/v1/admin/inbox', ma)).body as InboxPage;
    expect(page.counts).toEqual({ open: 1, openMine: 0 });
    expect(page.threads).toEqual([expect.objectContaining({ threadId, memberName: 'Ada Brooks', status: 'open', startedBy: 'member', lastFrom: 'member', assignedTo: null })]);

    // An answer settles it, for every Membership Admin.
    const answered = await api.call('POST', `/v1/admin/inbox/${threadId}/messages`, ma, { body: 'Use the Account page.' });
    expect(answered.status).toBe(201);
    expect((answered.body as InboxThreadView).status).toBe('answered');
    expect((await notifications(mb)).unread).toBe(0);
    expect((await notifications(ada)).notifications[0]).toMatchObject({ kind: 'membership_message' });

    // The member's answer needs one again; a closed one opens again.
    await api.call('POST', `/v1/membership-team/${threadId}`, ada, { body: 'Thanks, done.' });
    expect((await teamView(ma, threadId)).status).toBe('open');
    expect((await notifications(mb)).notifications[0]).toMatchObject({ title: 'Ada Brooks answered: A question', readAt: null });
    expect((await api.call('POST', `/v1/admin/inbox/${threadId}/status`, ma, { status: 'closed' })).body).toMatchObject({ status: 'closed' });
    expect((await api.call('POST', `/v1/admin/inbox/${threadId}/status`, ma, { status: 'closed' })).status).toBe(409);
    expect(((await api.call('GET', '/v1/membership-team', ada)).body as MyTeamThreadSummary[])[0]).toMatchObject({ closed: true });
    await api.call('POST', `/v1/membership-team/${threadId}`, ada, { body: 'One more thing.' });
    expect((await teamView(ma, threadId)).status).toBe('open');
    expect(((await api.call('GET', '/v1/admin/inbox?status=closed', ma)).body as InboxPage).threads).toEqual([]);
  });

  it('lets anyone with a member record write, applicant or lapsed, within the day’s limit', async () => {
    const lapsed = await member('lee@example.test', 'Lee Lapsed', 'lapsed');
    expect((await memberWrites(lapsed)).status).toBe(201);
    // A System Admin with no member record has no conversation with the membership team.
    expect((await memberWrites(sa1)).status).toBe(403);
    for (let i = 1; i < MEMBER_INBOX_STARTS_PER_DAY; i++) expect((await memberWrites(lapsed, `Question ${i}`)).status).toBe(201);
    expect((await memberWrites(lapsed, 'One too many')).status).toBe(429);
    expect((await memberWrites(ada, 'Mine is fine')).status).toBe(201);
  });
});

describe('the team’s own tools', () => {
  it('gives a conversation to one Membership Admin, who alone is told of the member’s next answer', async () => {
    const { threadId } = (await memberWrites(ada)).body as MyTeamThreadView;
    await api.call('POST', '/v1/me/notifications/read-all', ma);
    await api.call('POST', '/v1/me/notifications/read-all', mb);

    expect((await api.call('POST', `/v1/admin/inbox/${threadId}/assign`, ma, { accountId: ben.accountId })).status).toBe(409);
    const given = await api.call('POST', `/v1/admin/inbox/${threadId}/assign`, ma, { accountId: mb.accountId });
    expect(given.body).toMatchObject({ assignedTo: mb.accountId, assignedToName: 'Mia Bell' });
    expect((await notifications(mb)).notifications[0]).toMatchObject({ title: 'Mo Admin gave you a conversation with Ada Brooks: A question', readAt: null });
    expect((await notifications(ma)).unread).toBe(0);

    await api.call('POST', `/v1/membership-team/${threadId}`, ada, { body: 'Still there?' });
    expect((await notifications(ma)).unread).toBe(0);
    expect(((await api.call('GET', '/v1/admin/inbox?assigned=me', mb)).body as InboxPage).threads.map((t) => t.threadId)).toEqual([threadId]);
    expect(((await api.call('GET', '/v1/admin/inbox?assigned=me', ma)).body as InboxPage).threads).toEqual([]);
    expect(((await api.call('GET', '/v1/admin/inbox?assigned=nobody', ma)).body as InboxPage).threads).toEqual([]);
    expect(((await api.call('GET', '/v1/admin/inbox', mb)).body as InboxPage).counts).toEqual({ open: 1, openMine: 1 });
  });

  it('keeps notes for the team: never shown to the member, never emailed, and the status stays', async () => {
    const { threadId } = (await memberWrites(ada)).body as MyTeamThreadView;
    const noted = await api.call('POST', `/v1/admin/inbox/${threadId}/messages`, ma, { body: 'Checked: dues paid in March.', note: true });
    expect(noted.status).toBe(201);
    expect(noted.body).toMatchObject({ status: 'open', lastFrom: 'member' });
    expect((noted.body as InboxThreadView).messages.at(-1)).toMatchObject({ note: true, email: null, authorName: 'Mo Admin' });
    expect((await api.call('POST', `/v1/admin/inbox/${threadId}/messages`, ma, { body: 'x', note: true, close: true })).status).toBe(400);
    const mine = (await api.call('GET', `/v1/membership-team/${threadId}`, ada)).body as MyTeamThreadView;
    expect(mine.messages.map((m) => m.body)).toEqual(['How do I renew?']);
    await worker.tick();
    expect(await outbox('membership_message')).toEqual([]);
  });

  it('is for Membership Admins alone, and each member sees only their own', async () => {
    const { threadId } = (await memberWrites(ada)).body as MyTeamThreadView;
    expect((await api.call('GET', '/v1/admin/inbox', ben)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/inbox', sa1)).status).toBe(403);
    expect((await api.call('GET', `/v1/admin/inbox/${threadId}`, sa1)).status).toBe(403);
    expect((await api.call('GET', `/v1/membership-team/${threadId}`, ben)).status).toBe(404);
    expect((await api.call('POST', `/v1/membership-team/${threadId}`, ben, { body: 'Hi' })).status).toBe(404);
    expect((await api.call('POST', `/v1/membership-team/${threadId}/read`, ben)).status).toBe(404);
    expect((await api.call('GET', '/v1/membership-team', ben)).body).toEqual([]);
    // Not to themselves, and only to someone with a member record.
    expect((await teamWrites(ma, ma.accountId)).status).toBe(409);
    expect((await teamWrites(ma, sa1.accountId)).status).toBe(404);
  });

  it('lists one member’s conversations for their record', async () => {
    await memberWrites(ada);
    await teamWrites(ma, ada.accountId, 'Welcome');
    await teamWrites(ma, ben.accountId, 'Hello Ben');
    const page = (await api.call('GET', `/v1/admin/inbox?account=${ada.accountId}`, mb)).body as InboxPage;
    expect(page.threads.map((t) => t.subject).sort()).toEqual(['A question', 'Welcome']);
  });

  it('pages through the inbox, latest first', async () => {
    const at = Date.parse('2026-11-01T10:00:00.000Z');
    const batch = api.firebase.db.batch();
    for (let i = 0; i < 55; i++) {
      const iso = new Date(at + i * 60_000).toISOString();
      batch.set(api.firebase.db.collection('membership_threads').doc(`t${String(i).padStart(2, '0')}`), {
        threadId: `t${String(i).padStart(2, '0')}`,
        accountId: ada.accountId,
        subject: `Question ${i}`,
        status: 'open',
        assignedTo: null,
        startedBy: 'member',
        createdBy: ada.accountId,
        createdAt: iso,
        lastMessageAt: iso,
        lastFrom: 'member',
        lastText: 'x',
        messageCount: 1,
        memberUnread: 0,
        memberReadAt: null,
        updatedAt: iso,
        updatedBy: ada.accountId,
      });
    }
    await batch.commit();
    const first = (await api.call('GET', '/v1/admin/inbox?status=open', ma)).body as InboxPage;
    expect(first.threads).toHaveLength(50);
    expect(first.threads[0]!.subject).toBe('Question 54');
    expect(first.counts.open).toBe(55);
    const second = (await api.call('GET', `/v1/admin/inbox?status=open&after=${encodeURIComponent(first.next!)}`, ma)).body as InboxPage;
    expect(second.threads.map((t) => t.subject)).toEqual(['Question 4', 'Question 3', 'Question 2', 'Question 1', 'Question 0']);
    expect(second.next).toBeNull();
    expect((await api.call('GET', '/v1/admin/inbox?after=nonsense', ma)).status).toBe(400);
  });
});

describe('a deleted account', () => {
  it('takes its conversations with the team, and the team’s notifications about them', async () => {
    const { threadId } = (await memberWrites(ada)).body as MyTeamThreadView;
    await teamWrites(ma, ada.accountId, 'Welcome');
    const kept = (await teamWrites(ma, ben.accountId, 'Hello Ben')).body as InboxThreadView;
    expect((await notifications(mb)).notifications.some((n) => n.link === `/admin/inbox/${threadId}`)).toBe(true);

    await api.app.get(InboxRecords).forgetAccount(ada.accountId);
    const db = api.firebase.db;
    expect((await db.collection('membership_threads').where('accountId', '==', ada.accountId).get()).empty).toBe(true);
    expect((await db.collection('membership_messages').where('accountId', '==', ada.accountId).get()).empty).toBe(true);
    expect((await notifications(mb)).notifications.some((n) => n.link === `/admin/inbox/${threadId}`)).toBe(false);
    expect((await api.call('GET', `/v1/admin/inbox/${kept.threadId}`, ma)).status).toBe(200);
  });
});
