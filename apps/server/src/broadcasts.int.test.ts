import type {
  AdminTestView,
  BroadcastAudience,
  BroadcastPreview,
  BroadcastsView,
  BroadcastSummary,
  NoticeSettingsRecord,
  OutboxMessageRecord,
  TestRecipient,
} from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NoticeSettingsService } from './notifications/notice-settings.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/**
 * An email an admin writes to members, and a System Admin's test to another System Admin or a member (design §10.12), with the outbox
 * standing in for SES.
 */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let sa2: Member;
let membershipAdmin: Member;
let electionAdmin: Member;

const URL = '/v1/admin/mail/broadcasts';

/** Settings saved, and the worker told at once rather than within its minute's cache. */
async function saveSettings(change: Partial<NoticeSettingsRecord>) {
  const { version, updatedAt: _a, updatedBy: _b, ...rest } = (await api.call('GET', '/v1/admin/notice-settings', sa1)).body as NoticeSettingsRecord;
  const saved = await api.call('PUT', '/v1/admin/notice-settings', sa1, { ...rest, ...change, basedOn: version });
  expect(saved.status).toBe(200);
  worker.app.get(NoticeSettingsService).invalidate();
}

beforeEach(async () => {
  await resetEmulators();
  for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
  [sa1, sa2] = (await api.systemAdmins()) as [Member, Member];
  membershipAdmin = await api.member('ma@example.test');
  electionAdmin = await api.member('ea@example.test');
  await api.grant(membershipAdmin.accountId, 'membership_admin', sa1);
  await api.grant(electionAdmin.accountId, 'election_admin', sa1);
  await saveSettings({ contact: 'elections@example.org' });
});

/** An account and member record: Active and opted in, unless told otherwise. */
async function member(
  email: string,
  over: { status?: string; country?: string; state?: string | null; optedIn?: boolean; newsletterOnly?: boolean } = {},
): Promise<Member> {
  const user = await api.member(email);
  const optedIn = over.optedIn ?? true;
  await api.firebase.db
    .collection('members')
    .doc(user.accountId)
    .set({
      accountId: user.accountId,
      status: over.status ?? 'active',
      legalName: email.split('@')[0],
      preferredName: null,
      country: over.country ?? 'US',
      state: over.state === undefined ? 'NY' : over.state,
      communications: {
        newsletter: optedIn ? '2026-01-01T00:00:00.000Z' : null,
        announcements: optedIn && !over.newsletterOnly ? '2026-01-01T00:00:00.000Z' : null,
      },
    });
  return user;
}

const ALL: BroadcastAudience = { kind: 'all_active' };
const outbox = async () => (await api.firebase.db.collection('notice_outbox').where('kind', '==', 'broadcast').get()).docs.map((d) => d.data() as OutboxMessageRecord);
const recipients = async () => (await outbox()).map((m) => m.accountId).sort();
const preview = async (audience: BroadcastAudience, as: User = membershipAdmin) => (await api.call('POST', `${URL}/preview`, as, { audience })).body as BroadcastPreview;
const send = (audience: BroadcastAudience = ALL, as: User = membershipAdmin, subject = 'Meeting on Friday') =>
  api.call('POST', URL, as, { subject, body: 'Hello all.\n\nWe meet on Friday.', audience });
const view = async (as: User = membershipAdmin) => (await api.call('GET', URL, as)).body as BroadcastsView;
const ledger = async (type: string) => (await api.firebase.db.collection('audit_events').where('type', '==', type).get()).docs.map((d) => d.data());

describe('who an email goes to', () => {
  it('is Active members who opted in, and says why the rest do not get it', async () => {
    const opted = await member('opted@example.test');
    await member('newsletter@example.test', { newsletterOnly: true });
    await member('no@example.test', { optedIn: false });
    await member('lapsed@example.test', { status: 'lapsed' });
    const left = await member('left@example.test');
    await api.call('POST', '/v1/me/email/unsubscribe', left);
    const stopped = await member('stopped@example.test');
    await api.call('POST', '/v1/admin/mail/stops', membershipAdmin, { accountId: stopped.accountId, reason: 'asked by phone' });

    expect(await preview(ALL)).toEqual({
      matched: 5,
      willGet: 2,
      skipped: { email_stopped: 1, unsubscribed: 1, not_opted_in: 1, no_address: 0, unverified: 0, undeliverable: 0 },
    });
    expect((await send()).status).toBe(202);
    await worker.tick();
    expect((await outbox()).map((m) => m.to).sort()).toEqual(['newsletter@example.test', 'opted@example.test']);
    expect((await outbox()).find((m) => m.accountId === opted.accountId)).toBeDefined();
  });

  it('can be chosen by state or country', async () => {
    const ny = await member('ny@example.test', { state: 'NY' });
    const ca = await member('ca@example.test', { state: 'CA' });
    const uk = await member('uk@example.test', { country: 'GB', state: null });
    await member('fr@example.test', { country: 'FR', state: null });

    expect((await preview({ kind: 'place', states: ['NY'], countries: [] })).willGet).toBe(1);
    expect((await preview({ kind: 'place', states: [], countries: ['US'] })).willGet).toBe(2);
    expect((await api.call('POST', `${URL}/preview`, membershipAdmin, { audience: { kind: 'place', states: [], countries: [] } })).status).toBe(400);
    expect((await api.call('POST', `${URL}/preview`, membershipAdmin, { audience: { kind: 'place', states: ['ZZ'], countries: [] } })).status).toBe(400);

    await send({ kind: 'place', states: ['CA'], countries: ['GB'] });
    await worker.tick();
    expect(await recipients()).toEqual([ca.accountId, uk.accountId].sort());
    expect(await recipients()).not.toContain(ny.accountId);
  });

  it('can be picked by hand, who must still be Active and opted in', async () => {
    const a = await member('a@example.test');
    await member('b@example.test');
    const no = await member('no@example.test', { optedIn: false });
    const lapsed = await member('lapsed@example.test', { status: 'lapsed' });
    const audience: BroadcastAudience = { kind: 'picked', accountIds: [a.accountId, no.accountId, lapsed.accountId, 'nobody'] };
    expect(await preview(audience)).toMatchObject({ matched: 2, willGet: 1, skipped: { not_opted_in: 1 } });
    await send(audience);
    await worker.tick();
    expect(await recipients()).toEqual([a.accountId]);
    const [row] = (await view()).broadcasts;
    expect(row!.audience).toEqual({ kind: 'picked', count: 4 });
  });

  it('finds members to pick by name, for both roles', async () => {
    await member('ada@example.test');
    const search = (as: User) => api.call('GET', `${URL}/member-search?name=ada`, as);
    expect((await search(membershipAdmin)).body).toEqual([expect.objectContaining({ legalName: 'ada' })]);
    expect((await search(sa1)).status).toBe(200);
    expect((await search(electionAdmin)).status).toBe(403);
  });
});

describe('sending one', () => {
  it('is for Membership and System Admins alone, each ledgered, never naming the members', async () => {
    const m = await member('m@example.test');
    expect((await send(ALL, electionAdmin)).status).toBe(403);
    expect((await send(ALL, m)).status).toBe(403);
    expect((await api.call('GET', URL, electionAdmin)).status).toBe(403);
    expect((await api.call('POST', `${URL}/preview`, m, { audience: ALL })).status).toBe(403);
    expect((await api.call('POST', URL, membershipAdmin, { subject: ' ', body: 'x', audience: ALL })).status).toBe(400);
    expect((await api.call('POST', URL, membershipAdmin, { subject: 'a\nb', body: 'x', audience: ALL })).status).toBe(400);

    expect((await send({ kind: 'picked', accountIds: [m.accountId] }, sa1)).status).toBe(202);
    const [entry] = await ledger('notice.broadcast_requested');
    expect(entry).toMatchObject({ actor: sa1.accountId, payload: { subject: 'Meeting on Friday', audience: { kind: 'picked', count: 1 }, willGet: 1, bodyHash: expect.any(String) } });
    expect(JSON.stringify(entry)).not.toContain(m.accountId.slice(0, 20));
    expect(JSON.stringify(entry)).not.toContain('We meet on Friday');
  });

  it('writes the admin’s words as plain text, with the member’s own unsubscribe link', async () => {
    await member('ada@example.test');
    await api.call('POST', URL, membershipAdmin, { subject: 'A <b>bold</b> plan', body: 'Come & see.\n\n<script>alert(1)</script>', audience: ALL });
    await worker.tick();
    const [message] = await outbox();
    expect(message!.subject).toBe('A <b>bold</b> plan');
    expect(message!.text).toContain('Hello ada,');
    expect(message!.text).toContain('Come & see.');
    expect(message!.text).toMatch(/Unsubscribe from all email from the party: \S+\/unsubscribe\?token=/);
    expect(message!.html).toContain('Come &amp; see.');
    expect(message!.html).not.toContain('<script>');
    expect(message!.html).not.toContain('<b>bold');
    expect(message!.listUnsubscribe).toMatch(/\/v1\/public\/unsubscribe\//);
    expect(message!.text).toContain('elections@example.org');
  });

  it('reports how it went, delivery included, and keeps it for the record', async () => {
    const fine = await member('fine@example.test');
    await member('gone@bounce.test');
    await send();
    expect((await view()).broadcasts[0]).toMatchObject({ status: 'preparing', subject: 'Meeting on Friday' });
    await worker.tick();
    await worker.tick(); // the reports
    const [row] = (await view()).broadcasts as BroadcastSummary[];
    expect(row).toMatchObject({ status: 'done', body: 'Hello all.\n\nWe meet on Friday.', completedAt: expect.any(String), preview: { willGet: 2 } });
    expect(row!.counts).toMatchObject({ pending: 0, sent: 2, delivered: 1, bounced: 1 });
    // It shows among the member's own emails.
    const own = (await api.call('GET', '/v1/me/email', fine)).body as { messages: { kind: string; status: string }[] };
    expect(own.messages).toEqual([expect.objectContaining({ kind: 'broadcast', status: 'delivered' })]);
  });

  it('skips a member who stops email after it was prepared', async () => {
    const a = await member('a@example.test');
    await member('b@example.test');
    await send();
    const ref = (await api.firebase.db.collection('broadcasts').get()).docs[0]!.ref;
    const { to, preview: prepared } = await (async () => {
      const { BroadcastAudienceReader } = await import('./notifications/broadcasts.js');
      return worker.app.get(BroadcastAudienceReader).resolve(ALL);
    })();
    // As the worker leaves it when interrupted just after preparing.
    const { BroadcastRepository } = await import('./notifications/broadcast.repository.js');
    await worker.app.get(BroadcastRepository).addRecipients(ref.id, to, new Date().toISOString());
    await ref.update({ status: 'sending', preview: prepared });
    await api.call('POST', '/v1/me/email/unsubscribe', a);
    await worker.tick();
    expect((await outbox()).map((m) => m.to)).toEqual(['b@example.test']);
    expect((await view()).broadcasts[0]!.counts).toMatchObject({ sent: 1, skipped: 1 });
  });

  it('is refused while it could not go, and says why', async () => {
    await member('a@example.test');
    await saveSettings({ allEmails: false });
    expect((await view()).blocked).toContain('all email is switched off');
    expect((await send()).status).toBe(409);
    await saveSettings({ allEmails: true, contact: null });
    expect((await view()).blocked).toContain('no contact');
    expect((await send()).status).toBe(409);
    await saveSettings({ contact: 'elections@example.org' });
    expect((await view()).blocked).toBeNull();

    await member('no@example.test', { optedIn: false });
    expect((await send({ kind: 'place', states: ['AK'], countries: [] })).status).toBe(409);
    expect((await ledger('notice.broadcast_requested')).length).toBe(0);
  });

  it('goes one at a time', async () => {
    await member('a@example.test');
    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(409);
    expect((await view()).blocked).toContain('another email');
    await worker.tick();
    expect((await send()).status).toBe(202);
  });

  it('waits while all email is switched off, and goes on when it is back on', async () => {
    await member('a@example.test');
    await send();
    await saveSettings({ allEmails: false });
    await worker.tick();
    expect(await outbox()).toEqual([]);
    await saveSettings({ allEmails: true });
    expect((await worker.tick()).body).toMatchObject({ broadcastEmailsSent: 1 });
  });

  it('can be stopped, leaving the rest unsent, ledgered', async () => {
    await member('a@example.test');
    expect((await send()).status).toBe(202);
    const [row] = (await view()).broadcasts;
    const cancel = (as: User) => api.call('POST', `${URL}/${row!.broadcastId}/cancel`, as);
    expect((await cancel(electionAdmin)).status).toBe(403);
    expect((await cancel(sa1)).body).toMatchObject({ status: 'cancelled' });
    expect((await cancel(sa1)).status).toBe(409);
    expect((await api.call('POST', `${URL}/nothing/cancel`, sa1)).status).toBe(404);
    await worker.tick();
    expect(await outbox()).toEqual([]);
    expect(await ledger('notice.broadcast_cancelled')).toEqual([expect.objectContaining({ actor: sa1.accountId, payload: { broadcastId: row!.broadcastId } })]);
    // A new one can go.
    expect((await send()).status).toBe(202);
  });

  it('forgets a member’s copy with their account', async () => {
    const a = await member('a@example.test');
    await send();
    await worker.tick();
    const copies = () => api.firebase.db.collection('broadcast_recipients').where('accountId', '==', a.accountId).get();
    expect((await copies()).size).toBe(1);
    const { MailRecords } = await import('./notifications/mail-records.js');
    await api.app.get(MailRecords).forgetAccount(a.accountId);
    expect((await copies()).size).toBe(0);
  });
});

describe('a test email', () => {
  const test = (as: User, to?: string) => api.call('POST', '/v1/admin/mail/test', as, to ? { to } : {});
  const testView = async (as: User = sa1) => (await api.call('GET', '/v1/admin/mail/test', as)).body as AdminTestView;
  const tests = async () => (await api.firebase.db.collection('notice_outbox').where('kind', '==', 'admin_test').get()).docs.map((d) => d.data() as OutboxMessageRecord);

  it('can go to another System Admin while all email is off, and the one who asked sees how it went', async () => {
    await saveSettings({ allEmails: false });
    expect((await testView()).systemAdmins[0]!.accountId).toBe(sa1.accountId);
    expect((await testView()).systemAdmins.map((a) => a.accountId)).toContain(sa2.accountId);

    expect((await test(sa1, sa2.accountId)).status).toBe(202);
    await worker.tick();
    await worker.tick(); // its delivery report
    const [sent] = await tests();
    expect(sent).toMatchObject({ accountId: sa2.accountId });
    expect(sent!.text).toContain('This test email was asked for in Admin › Email');
    expect((await testView()).last).toMatchObject({ status: 'done', outcome: null, delivery: 'delivered' });
    // It is on the record of the one who got it.
    const mine = (await api.call('GET', '/v1/me/email', sa2)).body as { messages: { kind: string }[] };
    expect(mine.messages.map((m) => m.kind)).toContain('admin_test');
  });

  it('goes to the one who asked by default', async () => {
    expect((await test(sa1)).status).toBe(202);
    await worker.tick();
    expect((await tests()).map((m) => m.accountId)).toEqual([sa1.accountId]);
  });

  it('can go to a member while all email is off, in words for a member, and to nobody who left, was refused or is no member', async () => {
    await saveSettings({ allEmails: false });
    const ada = await member('ada@example.test');
    const lee = await member('lee@example.test', { status: 'lapsed' });
    const resigned = await member('rae@example.test', { status: 'resigned' });
    const rejected = await member('rex@example.test', { status: 'rejected' });
    for (const to of [resigned.accountId, rejected.accountId, membershipAdmin.accountId, 'nobody']) expect((await test(sa1, to)).status).toBe(403);
    expect(await tests()).toEqual([]);

    expect((await test(sa1, ada.accountId)).status).toBe(202);
    await worker.tick();
    const [sent] = await tests();
    expect(sent).toMatchObject({ accountId: ada.accountId });
    expect(sent!.text).toContain('An administrator of the site sent you this test email');
    expect(sent!.text).not.toContain('Admin › Email');
    expect((await testView()).last).toMatchObject({ toName: 'ada', status: 'done', outcome: null });

    // A lapsed member too, and only the one chosen each time.
    expect((await test(sa1, lee.accountId)).status).toBe(202);
    await worker.tick();
    expect((await tests()).map((m) => m.accountId).sort()).toEqual([ada.accountId, lee.accountId].sort());
  });

  it('finds System Admins and members by name or by email address, for System Admins alone', async () => {
    const ada = await member('ada@example.test');
    await member('adam@example.test', { status: 'resigned' });
    const search = (q: string, as: User = sa1) => api.call('GET', `/v1/admin/mail/test/recipients?${new URLSearchParams({ q })}`, as);

    const byName = (await search('ada')).body as TestRecipient[];
    expect(byName).toEqual([{ accountId: ada.accountId, name: 'ada', email: 'ada@example.test', systemAdmin: false, adminRole: null, memberStatus: 'active', place: 'NY' }]);
    expect(((await search(' ADA@Example.test ')).body as TestRecipient[]).map((r) => r.accountId)).toEqual([ada.accountId]);
    // The System Admins, by part of their address; they need no member record.
    const admins = (await search('sa2@')).body as TestRecipient[];
    expect(admins).toEqual([expect.objectContaining({ accountId: sa2.accountId, systemAdmin: true, adminRole: 'system_admin', memberStatus: null })]);

    expect((await search('ada', membershipAdmin)).status).toBe(403);
    expect((await search('  ')).status).toBe(400);
  });

  it('is for System Admins, and refused to a System Admin who gets no email', async () => {
    expect((await test(membershipAdmin)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/mail/test', membershipAdmin)).status).toBe(403);
    await api.call('POST', '/v1/me/email/unsubscribe', sa2);
    const refused = await test(sa1, sa2.accountId);
    expect(refused.status).toBe(409);
  });
});
