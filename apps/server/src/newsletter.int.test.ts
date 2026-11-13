import type {
  BroadcastAudience,
  BroadcastPreview,
  NewsletterLookup,
  NewsletterSubscriberRecord,
  NewsletterSummary,
  NoticeSettingsRecord,
  OutboxMessageRecord,
} from 'ustp-domain';
import { NEWSLETTER_SIGNUPS_PER_SENDER_PER_DAY } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NoticeSettingsService } from './notifications/notice-settings.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/**
 * The newsletter (design §10.15): a public sign-up confirmed by email (double opt-in), emails to its subscribers from
 * Admin › Email alone or with the members, and unsubscribing, which deletes the address. The outbox stands in for SES.
 */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa: Member;
let membershipAdmin: Member;
let electionAdmin: Member;

async function saveSettings(change: Partial<NoticeSettingsRecord>) {
  const { version, updatedAt: _a, updatedBy: _b, ...rest } = (await api.call('GET', '/v1/admin/notice-settings', sa)).body as NoticeSettingsRecord;
  expect((await api.call('PUT', '/v1/admin/notice-settings', sa, { ...rest, ...change, basedOn: version })).status).toBe(200);
  for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
}

beforeEach(async () => {
  await resetEmulators();
  for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
  [sa] = await api.systemAdmins();
  membershipAdmin = await api.member('ma@example.test');
  electionAdmin = await api.member('ea@example.test');
  await api.grant(membershipAdmin.accountId, 'membership_admin', sa);
  await api.grant(electionAdmin.accountId, 'election_admin', sa);
  await saveSettings({ contact: 'help@example.org' });
});

const signUp = (body: Record<string, unknown>, address = '203.0.113.7') =>
  api.app.inject({ method: 'POST', url: '/v1/public/newsletter', headers: { 'x-forwarded-for': address }, payload: body });
const outbox = async (kind: string) =>
  (await api.firebase.db.collection('notice_outbox').where('kind', '==', kind).get()).docs.map((d) => d.data() as OutboxMessageRecord);
const subscribers = async () => (await api.firebase.db.collection('newsletter_subscribers').get()).docs.map((d) => d.data() as NewsletterSubscriberRecord & { expireAt?: unknown });
/** The token in the latest confirmation email to `to`. */
async function confirmToken(to: string): Promise<string> {
  const mail = (await outbox('newsletter_confirm')).filter((m) => m.to === to).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  const token = mail?.text.match(/\/newsletter\/confirm\?token=([A-Za-z0-9_-]{43})/)?.[1];
  if (!token) throw new Error(`no confirmation to ${to}`);
  return token;
}
/** Signs `email` up and confirms it, as its owner would. */
async function subscribe(email: string, name = ''): Promise<void> {
  expect((await signUp({ email, name })).statusCode).toBe(202);
  await worker.tick();
  const token = await confirmToken(email);
  expect((await api.call('POST', `/v1/public/newsletter/confirm/${token}`)).body).toEqual({ confirmed: true });
}

async function activeMember(email: string): Promise<Member> {
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
      communications: { newsletter: '2026-01-01T00:00:00.000Z', announcements: '2026-01-01T00:00:00.000Z' },
    });
  return user;
}

const BROADCASTS = '/v1/admin/mail/broadcasts';
const preview = async (audience: BroadcastAudience) => (await api.call('POST', `${BROADCASTS}/preview`, membershipAdmin, { audience })).body as BroadcastPreview;
const send = (audience: BroadcastAudience) => api.call('POST', BROADCASTS, membershipAdmin, { subject: 'News', body: 'Hello.\n\nMore soon.', audience });

describe('signing up for the newsletter', () => {
  it('waits for the confirmation link, which only the worker makes, and a GET of it changes nothing', async () => {
    expect((await api.call('GET', '/v1/public/newsletter')).body).toEqual({ open: true });
    expect((await signUp({ email: 'Ada@Example.org', name: 'Ada' })).statusCode).toBe(202);
    const [waiting] = await subscribers();
    expect(waiting).toMatchObject({ email: 'ada@example.org', name: 'Ada', status: 'pending', confirmDue: true, confirmTokenHash: null, unsubscribeToken: null });
    expect(waiting!.expireAt).toBeDefined();

    expect((await worker.tick()).body).toMatchObject({ newsletterConfirmationsSent: 1 });
    const [mail] = await outbox('newsletter_confirm');
    expect(mail).toMatchObject({ to: 'ada@example.org', accountId: null, listUnsubscribe: null });
    expect(mail!.text).toContain('Hello Ada,');
    const token = await confirmToken('ada@example.org');
    expect((await subscribers())[0]!.confirmTokenHash).not.toContain(token);

    expect((await api.call('GET', `/v1/public/newsletter/confirm/${token}`)).body).toEqual({ confirmed: false });
    expect((await subscribers())[0]!.status).toBe('pending');
    expect((await api.call('POST', `/v1/public/newsletter/confirm/${token}`)).body).toEqual({ confirmed: true });
    const [confirmed] = await subscribers();
    expect(confirmed).toMatchObject({ status: 'confirmed', confirmDue: false });
    expect(confirmed!.unsubscribeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(confirmed!.expireAt).toBeUndefined();
    expect((await api.call('POST', `/v1/public/newsletter/confirm/${token}`)).body).toEqual({ confirmed: true });
    expect((await api.call('GET', `/v1/public/newsletter/confirm/${'x'.repeat(43)}`)).status).toBe(404);
    // Not the ledger's business: an address must be erasable.
    const types = (await api.firebase.db.collection('audit_events').get()).docs.map((d) => d.get('type') as string);
    expect(types.filter((t) => t.includes('newsletter'))).toEqual([]);
  });

  it('never says whether an address is on the list, nor mails a confirmed one again', async () => {
    await subscribe('ada@example.org');
    expect((await signUp({ email: 'ada@example.org' })).statusCode).toBe(202);
    await worker.tick();
    expect(await outbox('newsletter_confirm')).toHaveLength(1);
    // One waiting gets another link only after an hour.
    expect((await signUp({ email: 'bo@example.org' })).statusCode).toBe(202);
    expect((await signUp({ email: 'bo@example.org' })).statusCode).toBe(202);
    await worker.tick();
    expect((await outbox('newsletter_confirm')).filter((m) => m.to === 'bo@example.org')).toHaveLength(1);
    expect((await subscribers()).filter((s) => s.email === 'bo@example.org')).toHaveLength(1);
  });

  it('drops a form filler’s sign-up, and limits each sender per day without keeping their address', async () => {
    expect((await signUp({ email: 'bot@example.org', website: 'https://spam.example' })).statusCode).toBe(202);
    expect(await subscribers()).toEqual([]);
    for (let i = 0; i < NEWSLETTER_SIGNUPS_PER_SENDER_PER_DAY; i++) expect((await signUp({ email: `p${i}@example.org` })).statusCode).toBe(202);
    expect((await signUp({ email: 'more@example.org' })).statusCode).toBe(429);
    expect((await signUp({ email: 'more@example.org' }, '198.51.100.2')).statusCode).toBe(202);
    const limits = (await api.firebase.db.collection('newsletter_limits').get()).docs.map((d) => JSON.stringify(d.data()));
    expect(limits.join()).not.toContain('203.0.113.7');
    expect((await signUp({ email: 'not an address' })).statusCode).toBe(400);
  });

  it('takes no sign-up while email is off or no contact is set', async () => {
    await saveSettings({ contact: null });
    expect((await api.call('GET', '/v1/public/newsletter')).body).toEqual({ open: false });
    expect((await signUp({ email: 'ada@example.org' })).statusCode).toBe(409);
    await saveSettings({ contact: 'help@example.org', allEmails: false });
    expect((await signUp({ email: 'ada@example.org' })).statusCode).toBe(409);
    expect(await subscribers()).toEqual([]);
  });
});

describe('emails to the newsletter’s subscribers', () => {
  it('go to confirmed subscribers alone, each with their own link off the list', async () => {
    await subscribe('ada@example.org', 'Ada');
    await signUp({ email: 'waiting@example.org' });
    await activeMember('member@example.test');
    expect((await preview({ kind: 'subscribers' })).subscribers).toEqual({ listed: 1, willGet: 1, skipped: { member_copy: 0, stopped: 0, undeliverable: 0 } });
    expect((await preview({ kind: 'subscribers' })).willGet).toBe(0);
    expect((await send({ kind: 'subscribers' })).status).toBe(202);
    await worker.tick();
    expect(await outbox('broadcast')).toEqual([]);
    const [copy] = await outbox('newsletter');
    expect(copy).toMatchObject({ to: 'ada@example.org', accountId: null });
    expect(copy!.text).toContain('Hello Ada,');
    const token = (await subscribers()).find((s) => s.email === 'ada@example.org')!.unsubscribeToken!;
    expect(copy!.listUnsubscribe).toContain(token);
    const requested = (await api.firebase.db.collection('audit_events').where('type', '==', 'notice.broadcast_requested').get()).docs[0]!.get('payload');
    expect(requested).toMatchObject({ audience: { kind: 'subscribers' }, willGet: 1, subscribers: 1 });
    expect(JSON.stringify(requested)).not.toContain('ada@example.org');
  });

  it('go with all Active members, an address once, never to one whose owner stopped email as a member', async () => {
    await subscribe('ada@example.org');
    await subscribe('member@example.test');
    await subscribe('left@example.test');
    await activeMember('member@example.test');
    const left = await activeMember('left@example.test');
    await api.call('POST', '/v1/me/email/unsubscribe', left);
    const audience: BroadcastAudience = { kind: 'all_active', withSubscribers: true };
    expect((await preview(audience)).subscribers).toEqual({ listed: 3, willGet: 1, skipped: { member_copy: 1, stopped: 1, undeliverable: 0 } });
    expect((await send(audience)).status).toBe(202);
    await worker.tick();
    expect((await outbox('broadcast')).map((m) => m.to)).toEqual(['member@example.test']);
    expect((await outbox('newsletter')).map((m) => m.to)).toEqual(['ada@example.org']);
  });
});

describe('leaving the list', () => {
  it('deletes the address, by the email’s link or its one-click header', async () => {
    await subscribe('ada@example.org');
    const token = (await subscribers())[0]!.unsubscribeToken!;
    expect((await api.call('GET', `/v1/public/unsubscribe/${token}/status`)).body).toEqual({ unsubscribed: false, newsletter: true });
    expect((await api.call('POST', `/v1/public/unsubscribe/${token}`)).body).toEqual({ unsubscribed: true, newsletter: true });
    expect(await subscribers()).toEqual([]);
    expect((await api.call('GET', `/v1/public/unsubscribe/${token}/status`)).status).toBe(404);
    expect((await api.call('POST', `/v1/public/unsubscribe/${token}`)).status).toBe(404);
  });
});

describe('the list in Admin › Email', () => {
  it('shows counts and one address at a time to those who write to it, and takes an address off', async () => {
    await subscribe('ada@example.org');
    await signUp({ email: 'bo@example.org' });
    expect((await api.call('GET', '/v1/admin/newsletter', membershipAdmin)).body).toEqual({ confirmed: 1, pending: 1, confirmedLast30Days: 1 } satisfies NewsletterSummary);
    expect((await api.call('GET', '/v1/admin/newsletter', electionAdmin)).status).toBe(403);
    const found = (await api.call('POST', '/v1/admin/newsletter/lookup', sa, { email: 'ADA@example.org' })).body as NewsletterLookup;
    expect(found).toMatchObject({ found: true, status: 'confirmed' });
    expect((await api.call('POST', '/v1/admin/newsletter/lookup', sa, { email: 'nobody@example.org' })).body).toMatchObject({ found: false });
    expect((await api.call('POST', '/v1/admin/newsletter/remove', membershipAdmin, { email: 'ada@example.org' })).status).toBe(204);
    expect((await api.call('POST', '/v1/admin/newsletter/remove', membershipAdmin, { email: 'ada@example.org' })).status).toBe(404);
    expect((await subscribers()).map((s) => s.email)).toEqual(['bo@example.org']);
  });
});
