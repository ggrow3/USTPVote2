import { DEFAULT_NOTICE_SETTINGS, type BroadcastRecord, type BroadcastsView, type NoticeSettingsRecord, type OutboxMessageRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NoticeSettingsService } from './notifications/notice-settings.js';
import { WeeklyDigest } from './notifications/weekly-digest.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** The weekly digest (design §10.14), with the outbox standing in for SES. */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;

async function saveSettings(change: Partial<NoticeSettingsRecord>) {
  const { version, updatedAt: _a, updatedBy: _b, ...rest } = (await api.call('GET', '/v1/admin/notice-settings', sa1)).body as NoticeSettingsRecord;
  const saved = await api.call('PUT', '/v1/admin/notice-settings', sa1, { ...rest, ...change, basedOn: version });
  expect(saved.status).toBe(200);
  worker.app.get(NoticeSettingsService).invalidate();
}

async function member(email: string, optedIn: boolean): Promise<Member> {
  const user = await api.member(email);
  await api.firebase.db
    .collection('members')
    .doc(user.accountId)
    .set({
      accountId: user.accountId,
      status: 'active',
      legalName: email.split('@')[0],
      preferredName: null,
      country: 'US',
      state: 'NY',
      communications: { newsletter: optedIn ? '2026-01-01T00:00:00.000Z' : null, announcements: null },
    });
  return user;
}

const news = (postId: string, title: string, publishedAt: string, status = 'published') =>
  api.firebase.db.collection('news_posts').doc(postId).set({ postId, slug: postId, title, status, publishedAt });
const digest = (at: string) => worker.app.get(WeeklyDigest).queueDue(new Date(at));
const broadcasts = async () => (await api.firebase.db.collection('broadcasts').get()).docs.map((d) => d.data() as BroadcastRecord);
const outbox = async () => (await api.firebase.db.collection('notice_outbox').where('kind', '==', 'broadcast').get()).docs.map((d) => d.data() as OutboxMessageRecord);

beforeEach(async () => {
  await resetEmulators();
  for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
  [sa1] = (await api.systemAdmins()) as [Member, Member];
  await member('ada@example.test', true);
  await member('ben@example.test', false);
});

describe('the weekly digest', () => {
  it('is off until a System Admin switches it on', async () => {
    await saveSettings({ contact: 'members@example.org' });
    await news('early', 'An early post', '2026-11-09T10:00:00.000Z');
    expect(await digest('2026-11-10T09:00:00.000Z')).toBe(0);
    expect(await digest('2026-11-16T13:05:00.000Z')).toBe(0);
    expect((await api.firebase.db.collection('mail_digest').doc('weekly').get()).exists).toBe(false);
    expect(await broadcasts()).toEqual([]);
  });

  it('goes on Monday with what is new since it was switched on, to those who opted in, and not again that week', async () => {
    await saveSettings({ contact: 'members@example.org', emails: { ...DEFAULT_NOTICE_SETTINGS.emails, weeklyDigest: true } });
    await news('before', 'Before the digest was on', '2026-11-09T10:00:00.000Z');
    // Tuesday: switched on; nothing is due yet, and what came before is not in the first one.
    expect(await digest('2026-11-10T09:00:00.000Z')).toBe(0);
    await news('convention', 'Convention dates', '2026-11-12T10:00:00.000Z');
    await news('draft', 'Not out yet', '2026-11-12T11:00:00.000Z', 'withdrawn');
    expect(await digest('2026-11-15T13:05:00.000Z')).toBe(0);

    expect(await digest('2026-11-16T13:05:00.000Z')).toBe(1);
    const [queued] = await broadcasts();
    expect(queued).toMatchObject({ createdBy: 'system', audience: { kind: 'all_active' }, subject: 'This week at the US Transhumanist Party: 1 news post' });
    expect(queued!.body).toContain('Convention dates');
    expect(queued!.body).not.toContain('Before the digest was on');
    expect(queued!.body).not.toContain('Not out yet');
    const ledgered = (await api.firebase.db.collection('audit_events').where('type', '==', 'notice.broadcast_requested').get()).docs.map((d) => d.data());
    expect(ledgered).toEqual([expect.objectContaining({ actor: 'system', payload: expect.objectContaining({ broadcastId: queued!.broadcastId, willGet: 1 }) })]);

    // The sender takes it from there, as it takes an email an admin wrote.
    for (let i = 0; i < 3; i++) await worker.tick();
    const sent = await outbox();
    expect(sent.map((m) => m.to)).toEqual(['ada@example.test']);
    expect(sent[0]!.text).toContain('/news/convention');
    const listed = (await api.call('GET', '/v1/admin/mail/broadcasts', sa1)).body as BroadcastsView;
    expect(JSON.stringify(listed)).toContain('the weekly digest');

    expect(await digest('2026-11-16T13:06:00.000Z')).toBe(0);
    // The next week has nothing new: no email.
    expect(await digest('2026-11-23T13:05:00.000Z')).toBe(0);
    expect(await broadcasts()).toHaveLength(1);
  });

  it('waits for a System Admin where approval is switched on', async () => {
    await saveSettings({ contact: 'members@example.org', broadcastApproval: true, emails: { ...DEFAULT_NOTICE_SETTINGS.emails, weeklyDigest: true } });
    expect(await digest('2026-11-10T09:00:00.000Z')).toBe(0);
    await news('convention', 'Convention dates', '2026-11-12T10:00:00.000Z');
    expect(await digest('2026-11-16T13:05:00.000Z')).toBe(1);
    expect((await broadcasts())[0]).toMatchObject({ status: 'awaiting_approval', approval: { status: 'waiting' } });
    await worker.tick();
    expect(await outbox()).toEqual([]);
  });
});
