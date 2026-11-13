import type { BroadcastsView, BroadcastSummary, MyNotificationsView, NoticeSettingsRecord, OutboxMessageRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NoticeSettingsService } from './notifications/notice-settings.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** Group emails that wait for a System or Site Admin's approval (design §10.12), with the outbox standing in for SES. */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let sa2: Member;
let ma: Member;

const URL = '/v1/admin/mail/broadcasts';

async function saveSettings(change: Partial<NoticeSettingsRecord>) {
  const { version, updatedAt: _a, updatedBy: _b, ...rest } = (await api.call('GET', '/v1/admin/notice-settings', sa1)).body as NoticeSettingsRecord;
  const saved = await api.call('PUT', '/v1/admin/notice-settings', sa1, { ...rest, ...change, basedOn: version });
  expect(saved.status).toBe(200);
  for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
  return saved.body as NoticeSettingsRecord;
}

beforeEach(async () => {
  await resetEmulators();
  for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
  [sa1, sa2] = (await api.systemAdmins()) as [Member, Member];
  ma = await api.member('ma@example.test');
  await api.grant(ma.accountId, 'membership_admin', sa1);
  for (const email of ['ada@example.test', 'ben@example.test']) {
    const user = await api.member(email);
    await api.firebase.db.collection('members').doc(user.accountId).set({
      accountId: user.accountId,
      status: 'active',
      legalName: email.split('@')[0],
      preferredName: null,
      country: 'US',
      state: 'NY',
      communications: { newsletter: '2026-01-01T00:00:00.000Z', announcements: null },
    });
  }
  await saveSettings({ contact: 'elections@example.org', broadcastApproval: true });
});

const send = (as: User = ma, subject = 'Meeting on Friday') => api.call('POST', URL, as, { subject, body: 'Hello all.', audience: { kind: 'all_active' } });
const view = async (as: User) => (await api.call('GET', URL, as)).body as BroadcastsView;
const outbox = async () => (await api.firebase.db.collection('notice_outbox').where('kind', '==', 'broadcast').get()).docs.map((d) => d.data() as OutboxMessageRecord);
const notifications = async (as: User) => (await api.call('GET', '/v1/me/notifications', as)).body as MyNotificationsView;
const ledger = async (type: string) => (await api.firebase.db.collection('audit_events').where('type', '==', type).get()).docs.map((d) => d.data());

describe('approval of emails to members', () => {
  it('is off until a System Admin switches it on, and the switch is ledgered', async () => {
    const changes = (await ledger('notice.settings_changed')).flatMap((e) => e.payload.changes as { field: string }[]);
    expect(changes.map((c) => c.field)).toContain('broadcastApproval');
    await saveSettings({ broadcastApproval: false });
    expect(((await send()).body as BroadcastSummary).status).toBe('preparing');
  });

  it('holds an email until a System Admin approves it, notifying them all, then it goes', async () => {
    const sent = await send();
    expect(sent.status).toBe(202);
    const email = sent.body as BroadcastSummary;
    expect(email).toMatchObject({ status: 'awaiting_approval', approval: { status: 'waiting' }, mine: true });
    expect((await ledger('notice.broadcast_requested'))[0]!.payload).toMatchObject({ approvalRequired: true });

    await worker.tick();
    expect(await outbox()).toEqual([]);

    for (const admin of [sa1, sa2]) {
      expect((await notifications(admin)).notifications[0]).toMatchObject({ kind: 'broadcast_approval', link: '/admin?tab=email', readAt: null });
    }
    expect((await notifications(ma)).notifications).toEqual([]);

    const forMa = await view(ma);
    expect(forMa).toMatchObject({ approvalRequired: true, canApprove: false });
    expect(forMa.broadcasts[0]).toMatchObject({ status: 'awaiting_approval', willGetNow: 2, body: 'Hello all.' });
    expect((await api.call('POST', `${URL}/${email.broadcastId}/approve`, ma)).status).toBe(403);
    expect((await view(sa2)).canApprove).toBe(true);

    const approved = await api.call('POST', `${URL}/${email.broadcastId}/approve`, sa2);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'preparing', approval: { status: 'approved', decidedByName: expect.any(String) } });
    expect((await ledger('notice.broadcast_approved'))[0]).toMatchObject({ actor: sa2.accountId, payload: { broadcastId: email.broadcastId } });
    // Decided: the other System Admin's notification asks nothing more, and the writer is told.
    expect((await notifications(sa1)).unread).toBe(0);
    expect((await notifications(ma)).notifications[0]).toMatchObject({ kind: 'broadcast_decided', title: 'Your email “Meeting on Friday” was approved and is going out' });
    expect((await api.call('POST', `${URL}/${email.broadcastId}/approve`, sa1)).status).toBe(409);

    await worker.tick();
    expect((await outbox()).map((m) => m.to).sort()).toEqual(['ada@example.test', 'ben@example.test']);
  });

  it('lets a System Admin approve their own', async () => {
    const email = (await send(sa1)).body as BroadcastSummary;
    expect(email.status).toBe('awaiting_approval');
    expect((await notifications(sa2)).unread).toBe(1);
    expect((await notifications(sa1)).unread).toBe(0);
    expect((await api.call('POST', `${URL}/${email.broadcastId}/approve`, sa1)).status).toBe(200);
    expect((await notifications(sa1)).notifications).toEqual([]);
    await worker.tick();
    expect(await outbox()).toHaveLength(2);
  });

  it('lets a Site Admin approve one too, notified with the System Admins (design §10.1)', async () => {
    const site = await api.member('site@example.test');
    await api.grant(site.accountId, 'site_admin', sa1);
    const email = (await send()).body as BroadcastSummary;
    expect((await notifications(site)).notifications[0]).toMatchObject({ kind: 'broadcast_approval', readAt: null });
    expect((await view(site)).canApprove).toBe(true);
    const approved = await api.call('POST', `${URL}/${email.broadcastId}/approve`, site);
    expect(approved).toMatchObject({ status: 200, body: { status: 'preparing', approval: { status: 'approved' } } });
    expect((await ledger('notice.broadcast_approved'))[0]).toMatchObject({ actor: site.accountId });
    expect((await notifications(sa1)).unread).toBe(0);
  });

  it('can be rejected with a reason, and then nobody gets it', async () => {
    const email = (await send()).body as BroadcastSummary;
    expect((await api.call('POST', `${URL}/${email.broadcastId}/reject`, sa1, { reason: '' })).status).toBe(400);
    const rejected = await api.call('POST', `${URL}/${email.broadcastId}/reject`, sa1, { reason: 'Not before the board meets' });
    expect(rejected.body).toMatchObject({ status: 'rejected', approval: { status: 'rejected', reason: 'Not before the board meets' } });
    expect((await ledger('notice.broadcast_rejected'))[0]).toMatchObject({ actor: sa1.accountId, payload: { reason: 'Not before the board meets' } });
    expect((await notifications(ma)).notifications[0]!.title).toBe('Your email “Meeting on Friday” was not approved: Not before the board meets');
    await worker.tick();
    expect(await outbox()).toEqual([]);
    // Finished: another can be written.
    expect((await send()).status).toBe(202);
  });

  it('waits one at a time, and can be withdrawn while it waits', async () => {
    const email = (await send()).body as BroadcastSummary;
    const second = await send(sa1, 'Another');
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain('waiting for a System or Site Admin');
    expect((await view(ma)).blocked).toMatch(/waiting for a System or Site Admin/);

    expect((await api.call('POST', `${URL}/${email.broadcastId}/cancel`, ma)).body).toMatchObject({ status: 'cancelled' });
    expect((await ledger('notice.broadcast_cancelled'))[0]!.payload).toMatchObject({ beforeApproval: true });
    expect((await notifications(sa1)).unread).toBe(0);
    expect((await api.call('POST', `${URL}/${email.broadcastId}/approve`, sa1)).status).toBe(409);
  });

  it('still waits if the switch goes off meanwhile', async () => {
    const email = (await send()).body as BroadcastSummary;
    await saveSettings({ broadcastApproval: false });
    await worker.tick();
    expect(await outbox()).toEqual([]);
    expect((await view(sa1)).broadcasts.find((b) => b.broadcastId === email.broadcastId)!.status).toBe('awaiting_approval');
  });
});
