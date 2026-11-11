import { DEFAULT_NOTICE_SETTINGS, type MyNotificationsView, type OutboxMessageRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NoticeSettingsService } from './notifications/notice-settings.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** What an application to join tells the applicant and the Membership Admins (design §5.2), in the bell and by email. */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let admin: Member;
let otherAdmin: Member;
let bylaws: { version: string; contentHash: string };

const application = () => ({
  bylawsVersion: bylaws.version,
  bylawsHash: bylaws.contentHash,
  legalName: 'Robin Applicant',
  dateOfBirth: '1990-04-01',
  attestsAge: true,
  formVersion: 0,
  usVoteEligible: true,
  agreesWithCoreIdeals: true,
  state: 'CA',
  city: 'San Francisco',
  postalCode: '94110',
});

beforeEach(async () => {
  await resetEmulators();
  for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
  [sa1] = (await api.systemAdmins()) as [Member, Member];
  admin = await api.member('membership.admin@example.test');
  otherAdmin = await api.member('second.admin@example.test');
  await api.grant(admin.accountId, 'membership_admin', sa1);
  await api.grant(otherAdmin.accountId, 'membership_admin', sa1);
  const published = await api.call('POST', '/v1/admin/bylaws', admin, { version: '2026.1', title: 'USTP Bylaws', text: 'Article I. Name.\n' });
  expect(published.status).toBe(201);
  bylaws = published.body;
});

const notifications = async (as: User) => (await api.call('GET', '/v1/me/notifications', as)).body as MyNotificationsView;
const outbox = async () =>
  (await api.firebase.db.collection('notice_outbox').where('kind', '==', 'notification').get()).docs
    .map((d) => d.data() as OutboxMessageRecord)
    .sort((a, b) => a.subject.localeCompare(b.subject));
async function apply(email: string): Promise<{ who: Member; applicationId: string }> {
  const who = await api.member(email);
  const res = await api.call('POST', '/v1/registration/applications', who, application());
  expect(res.status).toBe(201);
  return { who, applicationId: res.body.applicationId };
}
const decide = (applicationId: string, decision: 'approve' | 'reject', reason = 'reviewed') =>
  api.call('POST', `/v1/admin/applications/${applicationId}/decision`, admin, { decision, reason });

describe('an application to join', () => {
  it('tells the applicant it arrived, by bell and email, and every Membership Admin that one waits', async () => {
    const robin = await apply('robin@example.test');
    const mine = await notifications(robin.who);
    expect(mine.unread).toBe(1);
    expect(mine.notifications[0]).toMatchObject({ kind: 'application_received', link: '/register', title: 'We have your application to join the US Transhumanist Party' });

    await apply('sam@example.test');
    for (const one of [admin, otherAdmin]) {
      const theirs = await notifications(one);
      // Two applications, one notice while it is unread.
      expect(theirs.notifications).toEqual([expect.objectContaining({ kind: 'application_waiting', count: 2, link: '/admin?tab=applications' })]);
    }

    // The applicant never chose notifications by email: theirs goes anyway. The admins' does not.
    expect((await worker.tick()).body).toMatchObject({ notificationEmailsSent: 2 });
    const sent = await outbox();
    expect(sent.map((m) => m.to).sort()).toEqual(['robin@example.test', 'sam@example.test']);
    expect(sent[0]).toMatchObject({ subject: 'We have your application to join the US Transhumanist Party' });
    expect(sent[0]!.text).toContain('A Membership Admin will read it and decide.');
    expect(sent[0]!.text).toContain('because you applied to join');
    expect(sent[0]!.text).not.toContain('you chose, on your Account page');
    // Not sent twice.
    expect((await worker.tick()).body).toMatchObject({ notificationEmailsSent: 0 });
  });

  it('tells the applicant the decision, a rejection with the reason written', async () => {
    const robin = await apply('robin@example.test');
    const sam = await apply('sam@example.test');
    await worker.tick();
    expect((await decide(robin.applicationId, 'approve')).status).toBe(201);
    expect((await decide(sam.applicationId, 'reject', 'We could not confirm your age')).status).toBe(201);

    expect((await notifications(robin.who)).notifications[0]).toMatchObject({ kind: 'application_approved', link: '/vote' });
    expect((await notifications(sam.who)).notifications[0]).toMatchObject({ kind: 'application_rejected', link: '/register' });
    // Read on the site first: the email still goes, as their record of it.
    await api.call('POST', '/v1/me/notifications/read-all', robin.who);

    expect((await worker.tick()).body).toMatchObject({ notificationEmailsSent: 2 });
    const sent = await outbox();
    const approved = sent.find((m) => m.subject.startsWith('Your application was approved'));
    const rejected = sent.find((m) => m.subject.includes('was not approved'));
    expect(approved).toMatchObject({ to: 'robin@example.test' });
    expect(approved!.text).toContain('Welcome.');
    expect(rejected).toMatchObject({ to: 'sam@example.test' });
    expect(rejected!.text).toContain('We could not confirm your age');
    expect(rejected!.text).toContain('You may apply again');
  });

  it('sends no email of a kind a System Admin switched off, and the bell still has it', async () => {
    await api.firebase.db
      .collection('notice_settings')
      .doc('current')
      .set({ allEmails: true, emails: { ...DEFAULT_NOTICE_SETTINGS.emails, applicationReceived: false } });
    for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
    const robin = await apply('robin@example.test');
    expect((await worker.tick()).body).toMatchObject({ notificationEmailsSent: 0 });
    expect((await notifications(robin.who)).unread).toBe(1);
    expect((await decide(robin.applicationId, 'approve')).status).toBe(201);
    expect((await worker.tick()).body).toMatchObject({ notificationEmailsSent: 1 });
    expect((await outbox()).map((m) => m.to)).toEqual(['robin@example.test']);
  });
});
