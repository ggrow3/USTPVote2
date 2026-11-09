import { mailMessageRecord, type MailLogPage, type NoticeSettingsRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MailRepository } from './notifications/mail.repository.js';
import { NoticeSettingsService } from './notifications/notice-settings.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** The email log (design §10.12): every email the site sent, for System Admins, with the outbox standing in for SES. */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let membershipAdmin: Member;

const log = async (query: Record<string, string> = {}, as: User = sa1) => {
  const res = await api.call('GET', `/v1/admin/mail/log?${new URLSearchParams(query)}`, as);
  expect(res.status).toBe(200);
  return res.body as MailLogPage;
};

beforeEach(async () => {
  await resetEmulators();
  for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
  [sa1] = (await api.systemAdmins()) as [Member, Member];
  membershipAdmin = await api.member('ma@example.test');
  await api.grant(membershipAdmin.accountId, 'membership_admin', sa1);
  const { version, updatedAt: _a, updatedBy: _b, ...rest } = (await api.call('GET', '/v1/admin/notice-settings', sa1)).body as NoticeSettingsRecord;
  expect((await api.call('PUT', '/v1/admin/notice-settings', sa1, { ...rest, contact: 'elections@example.org', basedOn: version })).status).toBe(200);
  worker.app.get(NoticeSettingsService).invalidate();
});

async function member(email: string, legalName: string): Promise<Member> {
  const user = await api.member(email);
  await api.firebase.db
    .collection('members')
    .doc(user.accountId)
    .set({
      accountId: user.accountId,
      status: 'active',
      legalName,
      preferredName: null,
      country: 'US',
      state: 'NY',
      communications: { newsletter: '2026-01-01T00:00:00.000Z', announcements: null },
    });
  return user;
}

describe('the email log', () => {
  it('lists each email sent, whom it went to, who caused it and what became of it', async () => {
    const ada = await member('ada@example.test', 'Ada Brooks');
    const bounce = await member('ben@bounce.test', 'Ben Cruz');
    const sent = await api.call('POST', '/v1/admin/mail/broadcasts', membershipAdmin, { subject: 'Hello', body: 'Hello all.', audience: { kind: 'all_active' } });
    expect(sent.status).toBe(202);
    expect((await api.call('POST', '/v1/admin/mail/test', sa1, {})).status).toBe(202);
    await worker.tick();
    // The outbox's acted-out delivery reports are read on the next tick.
    await worker.tick();

    const { rows, next, scanLimited } = await log();
    expect(next).toBeNull();
    expect(scanLimited).toBe(false);
    const broadcasts = rows.filter((r) => r.kind === 'broadcast');
    expect(broadcasts.map((r) => r.accountId).sort()).toEqual([ada.accountId, bounce.accountId].sort());
    for (const row of broadcasts) expect(row).toMatchObject({ causedBy: membershipAdmin.accountId, sender: 'app', delivery: 'outbox', ref: (sent.body as { broadcastId: string }).broadcastId });
    expect(broadcasts.find((r) => r.accountId === ada.accountId)).toMatchObject({ status: 'delivered', accountName: 'Ada Brooks', accountEmail: 'ada@example.test' });
    expect(broadcasts.find((r) => r.accountId === bounce.accountId)).toMatchObject({ status: 'bounced', bounce: { type: 'permanent' } });
    expect(rows.find((r) => r.kind === 'admin_test')).toMatchObject({ accountId: sa1.accountId, causedBy: sa1.accountId });
    // Newest first, and nothing that names the words.
    expect(rows.map((r) => r.sentAt)).toEqual([...rows.map((r) => r.sentAt)].sort().reverse());
    expect(JSON.stringify(rows)).not.toContain('Hello');
  });

  it('is narrowed by whom, who caused it, kind, status and days', async () => {
    const ada = await member('ada@example.test', 'Ada Brooks');
    await member('ben@bounce.test', 'Ben Cruz');
    await api.call('POST', '/v1/admin/mail/broadcasts', membershipAdmin, { subject: 'Hello', body: 'Hello all.', audience: { kind: 'all_active' } });
    await api.call('POST', '/v1/admin/mail/test', sa1, {});
    await worker.tick();
    await worker.tick();

    expect((await log({ account: ada.accountId })).rows.map((r) => r.kind)).toEqual(['broadcast']);
    expect((await log({ causedBy: sa1.accountId })).rows.map((r) => r.kind)).toEqual(['admin_test']);
    expect((await log({ kind: 'broadcast' })).rows).toHaveLength(2);
    expect((await log({ status: 'bounced' })).rows.map((r) => r.kind)).toEqual(['broadcast']);
    expect((await log({ kind: 'broadcast', status: 'delivered' })).rows.map((r) => r.accountId)).toEqual([ada.accountId]);
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect((await log({ from: today, to: today })).rows.length).toBe(3);
    expect((await log({ from: tomorrow })).rows).toEqual([]);
  });

  it('comes a page at a time', async () => {
    const mail = api.app.get(MailRepository);
    const start = Date.parse('2026-11-01T00:00:00.000Z');
    for (let i = 0; i < 120; i++) {
      await mail.create(
        mailMessageRecord({
          messageId: `m${String(i).padStart(3, '0')}`,
          kind: i % 3 ? 'voting_open' : 'welcome',
          ref: null,
          electionId: null,
          accountId: i % 2 ? 'a-odd' : 'a-even',
          causedBy: 'system',
          delivery: 'outbox',
          // Two at each minute, so the order falls back on the ID.
          at: new Date(start + Math.floor(i / 2) * 60_000).toISOString(),
        }),
      );
    }
    const seen: string[] = [];
    let page = await log();
    seen.push(...page.rows.map((r) => r.messageId));
    while (page.next) {
      page = await log({ after: page.next });
      seen.push(...page.rows.map((r) => r.messageId));
    }
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(seen[0]).toBe('m119');
    expect(seen.at(-1)).toBe('m000');

    // A filter Firestore does not read by is applied to what it returns, across pages.
    const welcomes: string[] = [];
    page = await log({ account: 'a-even', kind: 'welcome' });
    welcomes.push(...page.rows.map((r) => r.messageId));
    while (page.next) {
      page = await log({ account: 'a-even', kind: 'welcome', after: page.next });
      welcomes.push(...page.rows.map((r) => r.messageId));
    }
    expect(welcomes).toHaveLength(20);
    expect(welcomes.every((id) => Number(id.slice(1)) % 6 === 0)).toBe(true);
  });

  it('is for System Admins only, and refuses what it does not understand', async () => {
    expect((await api.call('GET', '/v1/admin/mail/log', membershipAdmin)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/mail/log?kind=spam', sa1)).status).toBe(400);
    expect((await api.call('GET', '/v1/admin/mail/log?after=nonsense', sa1)).status).toBe(400);
    expect((await api.call('GET', '/v1/admin/mail/log?from=2026-11-08&to=2026-11-01', sa1)).status).toBe(400);
  });
});
