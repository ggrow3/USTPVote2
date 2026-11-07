import { DEFAULT_NOTICE_SETTINGS, type MailStopRow, type MemberMailFlag, type MyEmailView, type NoticeSettingsRecord, type OutboxMessageRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NoticeSettingsService } from './notifications/notice-settings.js';
import { seedElection, type SeededElection } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/**
 * Who gets none of the site's email (design §10.12): System Admins' switch for all of it, members an admin stopped email
 * to, and the unsubscribe link in every email, with the outbox standing in for SES.
 */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let membershipAdmin: Member;
let electionAdmin: Member;

beforeEach(async () => {
  await resetEmulators();
  for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
  [sa1] = await api.systemAdmins();
  membershipAdmin = await api.member('ma@example.test');
  electionAdmin = await api.member('ea@example.test');
  await api.grant(membershipAdmin.accountId, 'membership_admin', sa1);
  await api.grant(electionAdmin.accountId, 'election_admin', sa1);
});

const outbox = async () => (await api.firebase.db.collection('notice_outbox').get()).docs.map((d) => d.data() as OutboxMessageRecord);
const outboxOf = async (e: SeededElection) => (await outbox()).filter((m) => m.electionId === e.electionId);
const mine = async (as: User) => (await api.call('GET', '/v1/me/email', as)).body as MyEmailView;
const stops = async (as: User = membershipAdmin) => (await api.call('GET', '/v1/admin/mail/stops', as)).body as MailStopRow[];
const flags = async () => (await api.call('GET', '/v1/admin/mail/members', membershipAdmin)).body as MemberMailFlag[];
/** The token from an email's link, as a member would follow it. */
const tokenIn = (message: OutboxMessageRecord) => /\/unsubscribe\?token=([A-Za-z0-9_-]{43})/.exec(message.text)![1]!;
/** A request with no sign-in and no JSON, as a mail client or a browser makes. */
const raw = async (method: 'GET' | 'POST', path: string, headers: Record<string, string> = {}, payload?: string) => {
  const res = await api.app.inject({ method, url: path, headers, ...(payload !== undefined && { payload }) });
  return { status: res.statusCode, location: res.headers.location, json: () => JSON.parse(res.body) as unknown };
};
const oneClick = (token: string) =>
  raw('POST', `/v1/public/unsubscribe/${token}`, { 'content-type': 'application/x-www-form-urlencoded' }, 'List-Unsubscribe=One-Click');

async function switchAll(on: boolean) {
  const { version, updatedAt: _a, updatedBy: _b, ...rest } = (await api.call('GET', '/v1/admin/notice-settings', sa1)).body as NoticeSettingsRecord;
  const saved = await api.call('PUT', '/v1/admin/notice-settings', sa1, { ...rest, basedOn: version, allEmails: on });
  expect(saved.status).toBe(200);
  worker.app.get(NoticeSettingsService).invalidate();
}

describe('the unsubscribe link', () => {
  it('is in every email, in the text, the HTML and the header', async () => {
    const ada = await api.member('ada@example.test');
    await seedElection(api, { voters: [ada.accountId] });
    await worker.tick();
    const [message] = await outbox();
    const token = tokenIn(message!);
    expect(message!.html).toContain(`/unsubscribe?token=${token}`);
    expect(message!.listUnsubscribe).toMatch(new RegExp(`/v1/public/unsubscribe/${token}$`));
    // The same member keeps one link.
    await api.call('POST', '/v1/me/email/test', ada);
    await worker.tick();
    const test = (await outbox()).find((m) => m.kind === 'member_test')!;
    expect(tokenIn(test)).toBe(token);
  });

  it('opening it changes nothing; the button unsubscribes, with no sign-in, and they get nothing more', async () => {
    const ada = await api.member('ada@example.test');
    const ben = await api.member('ben@example.test');
    await seedElection(api, { voters: [ada.accountId, ben.accountId] });
    await worker.tick();
    const token = tokenIn((await outbox()).find((m) => m.accountId === ada.accountId)!);

    // What a mail scanner does: follows the link, and the link in the header.
    const opened = await raw('GET', `/v1/public/unsubscribe/${token}`);
    expect(opened.status).toBe(302);
    expect(opened.location).toContain(`/unsubscribe?token=${token}`);
    expect(await (await raw('GET', `/v1/public/unsubscribe/${token}/status`)).json()).toEqual({ unsubscribed: false });
    expect((await mine(ada)).state).toBe('ok');

    expect((await raw('POST', `/v1/public/unsubscribe/${token}`)).status).toBe(200);
    expect(await (await raw('GET', `/v1/public/unsubscribe/${token}/status`)).json()).toEqual({ unsubscribed: true });
    expect(await mine(ada)).toMatchObject({ state: 'unsubscribed', since: expect.any(String), unsubscribedAt: expect.any(String), stoppedAt: null });

    // The next election: Ben gets it, Ada is skipped and counted, and is told nothing.
    const before = (await outbox()).length;
    const next = await seedElection(api, { voters: [ada.accountId, ben.accountId] });
    await worker.tick();
    expect((await outbox()).length).toBe(before + 1);
    expect((await outboxOf(next)).map((m) => m.accountId)).toEqual([ben.accountId]);
    const recipient = await api.firebase.db.collection('notices').doc(`${next.electionId}_voting_open`).collection('recipients').doc(ada.accountId).get();
    expect(recipient.data()).toMatchObject({ status: 'skipped', outcome: 'unsubscribed' });
  });

  it('takes a mail client’s one-click form', async () => {
    const ada = await api.member('ada@example.test');
    await seedElection(api, { voters: [ada.accountId] });
    await worker.tick();
    const res = await oneClick(tokenIn((await outbox())[0]!));
    expect(res.status).toBe(200);
    expect((await mine(ada)).state).toBe('unsubscribed');
  });

  it('is refused when it is no one’s, and says nothing of whose it is', async () => {
    const unknown = 'A'.repeat(43);
    expect((await raw('POST', `/v1/public/unsubscribe/${unknown}`)).status).toBe(404);
    expect((await raw('GET', `/v1/public/unsubscribe/${unknown}/status`)).status).toBe(404);
    expect((await raw('POST', '/v1/public/unsubscribe/short')).status).toBe(404);

    const ada = await api.member('ada@example.test');
    await seedElection(api, { voters: [ada.accountId] });
    await worker.tick();
    const body = JSON.stringify(await (await raw('GET', `/v1/public/unsubscribe/${tokenIn((await outbox())[0]!)}/status`)).json());
    expect(body).not.toContain(ada.accountId);
    expect(body).not.toContain('ada@');
  });
});

describe('the member’s own choice', () => {
  it('unsubscribes and turns email back on from their Account page, and refuses test emails between', async () => {
    const ada = await api.member('ada@example.test');
    expect((await api.call('POST', '/v1/me/email/unsubscribe', ada)).body).toMatchObject({ state: 'unsubscribed' });
    expect((await api.call('GET', '/v1/me', ada)).body.mail).toMatchObject({ state: 'unsubscribed' });
    expect((await api.call('POST', '/v1/me/email/test', ada)).status).toBe(409);

    const election = await seedElection(api, { voters: [ada.accountId] });
    await worker.tick();
    expect(await outboxOf(election)).toEqual([]);

    expect((await api.call('POST', '/v1/me/email/resubscribe', ada)).body).toMatchObject({ state: 'ok', unsubscribedAt: null });
    expect((await api.call('POST', '/v1/me/email/test', ada)).status).toBe(202);
  });

  it('cannot be undone by an admin', async () => {
    const ada = await api.member('ada@example.test');
    await api.call('POST', '/v1/me/email/unsubscribe', ada);
    expect((await api.call('POST', `/v1/admin/mail/stops/${ada.accountId}/restore`, membershipAdmin, { reason: 'please' })).status).toBe(409);
    expect((await mine(ada)).state).toBe('unsubscribed');
  });
});

describe('an admin stopping a member’s email', () => {
  it.each([
    ['a Membership Admin', () => membershipAdmin],
    ['a System Admin', () => sa1],
  ])('%s can stop and restore it, by address; the member sees it and cannot undo it', async (_who, as) => {
    const ada = await api.member('ada@example.test');
    await api.firebase.db.collection('members').doc(ada.accountId).set({ accountId: ada.accountId, status: 'active', legalName: 'Ada Brooks' }); // the flags are of members
    const stopped = await api.call('POST', '/v1/admin/mail/stops', as(), { email: 'ADA@example.test', reason: 'asked us by phone' });
    expect(stopped.status).toBe(204);

    expect(await mine(ada)).toMatchObject({ state: 'email_stopped', stoppedAt: expect.any(String) });
    expect((await api.call('POST', '/v1/me/email/test', ada)).status).toBe(409);
    expect(await stops(as())).toEqual([
      expect.objectContaining({ accountId: ada.accountId, name: 'Ada Brooks', email: 'ada@example.test', stoppedAt: expect.any(String), stoppedBy: expect.any(String), unsubscribedAt: null }),
    ]);
    expect(await flags()).toContainEqual(expect.objectContaining({ accountId: ada.accountId, state: 'email_stopped' }));

    // Their own switch does not lift it.
    await api.call('POST', '/v1/me/email/resubscribe', ada);
    expect((await mine(ada)).state).toBe('email_stopped');

    const election = await seedElection(api, { voters: [ada.accountId] });
    await worker.tick();
    expect(await outboxOf(election)).toEqual([]);
    const recipient = await api.firebase.db.collection('notices').doc(`${election.electionId}_voting_open`).collection('recipients').doc(ada.accountId).get();
    expect(recipient.data()).toMatchObject({ status: 'skipped', outcome: 'email_stopped' });

    expect((await api.call('POST', `/v1/admin/mail/stops/${ada.accountId}/restore`, as(), { reason: 'asked to get it again' })).status).toBe(204);
    expect((await mine(ada)).state).toBe('ok');
    expect(await stops(as())).toEqual([]);

    const ledger = (await api.firebase.db.collection('audit_events').where('type', '==', 'member.email_stopped').get()).docs.map((d) => d.data());
    expect(ledger.map((e) => e.payload)).toEqual(
      expect.arrayContaining([
        { stopped: true, reason: 'asked us by phone' },
        { stopped: false, reason: 'asked to get it again' },
      ]),
    );
    expect(ledger.every((e) => e.actor === as().accountId && e.subject === ada.accountId)).toBe(true);
  });

  it('is by ID from a member’s profile too, leaves their own unsubscribing standing, and is for those roles alone', async () => {
    const ada = await api.member('ada@example.test');
    const stop = (as: User, body: object) => api.call('POST', '/v1/admin/mail/stops', as, body);
    expect((await stop(electionAdmin, { accountId: ada.accountId, reason: 'x' })).status).toBe(403);
    expect((await stop(ada, { accountId: ada.accountId, reason: 'x' })).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/mail/stops', electionAdmin)).status).toBe(403);
    expect((await stop(membershipAdmin, { accountId: ada.accountId, reason: '  ' })).status).toBe(400);
    expect((await stop(membershipAdmin, { email: 'nobody@example.test', reason: 'x' })).status).toBe(404);
    expect((await stop(membershipAdmin, { accountId: membershipAdmin.accountId, reason: 'x' })).status).toBe(403);

    await api.call('POST', '/v1/me/email/unsubscribe', ada);
    expect((await stop(membershipAdmin, { accountId: ada.accountId, reason: 'x' })).status).toBe(204);
    expect((await stop(membershipAdmin, { accountId: ada.accountId, reason: 'x' })).status).toBe(409);
    await api.call('POST', `/v1/admin/mail/stops/${ada.accountId}/restore`, membershipAdmin, { reason: 'y' });
    expect((await mine(ada)).state).toBe('unsubscribed');
  });

  it('is forgotten with the account', async () => {
    const ada = await api.member('ada@example.test');
    await api.call('POST', '/v1/me/email/unsubscribe', ada);
    expect((await api.firebase.db.collection('mail_preferences').doc(ada.accountId).get()).exists).toBe(true);
    const { MailRecords } = await import('./notifications/mail-records.js');
    await api.app.get(MailRecords).forgetAccount(ada.accountId);
    expect((await api.firebase.db.collection('mail_preferences').doc(ada.accountId).get()).exists).toBe(false);
  });
});

describe('the switch for all email', () => {
  /** A site where nobody has saved any settings: what a new deployment starts with. */
  async function neverSaved() {
    await api.firebase.db.collection('notice_settings').doc('current').delete();
    for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
  }

  it('is off until a System Admin switches it on, so a new site emails nobody', async () => {
    expect(DEFAULT_NOTICE_SETTINGS.allEmails).toBe(false);
    await neverSaved();
    expect(((await api.call('GET', '/v1/admin/notice-settings', sa1)).body as NoticeSettingsRecord).allEmails).toBe(false);
    const ada = await api.member('ada@example.test');
    const election = await seedElection(api, { voters: [ada.accountId] });
    await worker.tick();
    expect(await outboxOf(election)).toEqual([]);
    expect((await api.call('POST', '/v1/me/email/test', ada)).status).toBe(409);
    expect((await mine(ada)).requestsEnabled).toBe(false);

    await switchAll(true);
    await worker.tick();
    expect((await outboxOf(election)).map((m) => m.accountId)).toEqual([ada.accountId]);
  });

  it('is for System Admins, and is ledgered', async () => {
    await switchAll(false);
    const entries = (await api.firebase.db.collection('audit_events').where('type', '==', 'notice.settings_changed').get()).docs.map((d) => d.data());
    expect(entries[0]!.payload.changes).toEqual([{ field: 'allEmails', from: true, to: false }]);
  });

  it('holds everything while off, keeps it when another page saves without it, and lets it go when back on', async () => {
    const ada = await api.member('ada@example.test');
    await switchAll(false);
    const election = await seedElection(api, { voters: [ada.accountId] });
    await worker.tick();
    expect(await outbox()).toEqual([]);
    expect((await api.firebase.db.collection('notices').doc(`${election.electionId}_voting_open`).get()).exists).toBe(false);

    // Test emails are refused, for members and Election Admins, with nothing queued.
    expect((await api.call('POST', '/v1/me/email/test', ada)).status).toBe(409);
    expect((await mine(ada)).requestsEnabled).toBe(false);
    expect((await api.call('POST', `/v1/admin/elections/${election.electionId}/notices/voting_open/test`, electionAdmin)).status).toBe(409);

    // A page opened before the switch existed saves without it, and it stays off.
    const { version, allEmails: _all, updatedAt: _a, updatedBy: _b, ...rest } = (await api.call('GET', '/v1/admin/notice-settings', sa1)).body as NoticeSettingsRecord;
    expect((await api.call('PUT', '/v1/admin/notice-settings', sa1, { ...rest, basedOn: version, reminderHours: 12 })).status).toBe(200);
    expect(((await api.call('GET', '/v1/admin/notice-settings', sa1)).body as NoticeSettingsRecord).allEmails).toBe(false);

    await switchAll(true);
    await worker.tick();
    expect((await outboxOf(election)).map((m) => m.accountId)).toEqual([ada.accountId]);
  });

  it('holds a notice already going, which goes on when it is back on', async () => {
    const voters: Member[] = [];
    for (const name of ['a', 'b']) voters.push(await api.member(`${name}@example.test`));
    await switchAll(true);
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId) });
    await switchAll(false);
    await worker.tick();
    expect(await outboxOf(election)).toEqual([]);
    await switchAll(true);
    await worker.tick();
    expect(await outboxOf(election)).toHaveLength(2);
  });

  it('leaves the setup check’s messages going, and the check says email is off', async () => {
    await switchAll(false);
    expect((await api.call('POST', '/v1/admin/mail/health/check', sa1)).status).toBe(202);
    await worker.tick();
    const health = (await api.call('GET', '/v1/admin/mail/health', sa1)).body as { health: { checks: { id: string; status: string; detail: string }[] } };
    const transport = health.health.checks.find((c) => c.id === 'transport')!;
    expect(transport.status).toBe('warn');
    expect(transport.detail).toContain('switched all');
    // Only the probes went, to Amazon's simulator: no member was mailed.
    const sent = await outbox();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((m) => m.kind === 'probe')).toBe(true);
  });

});

describe('a System Admin’s test email', () => {
  const ask = (as: User) => api.call('POST', '/v1/admin/mail/test', as);

  it('goes to their own address only, even while all email is off, and they see what became of it', async () => {
    await switchAll(false);
    const ada = await api.member('ada@example.test');
    const election = await seedElection(api, { voters: [ada.accountId] });
    const asked = await ask(sa1);
    expect(asked.status).toBe(202);
    expect((asked.body as MyEmailView).requests[0]).toMatchObject({ kind: 'admin_test', status: 'pending' });

    await worker.tick();
    await worker.tick(); // its delivery report
    const sent = (await outbox()).filter((m) => m.kind === 'admin_test');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.accountId).toBe(sa1.accountId);
    expect(sent[0]!.text).toContain('You asked for this test email in Admin › Email');
    expect(sent[0]!.text).toMatch(/\/unsubscribe\?token=/);
    // Nobody else was mailed.
    expect(await outboxOf(election)).toEqual([]);
    const view = await mine(sa1);
    expect(view.requests[0]).toMatchObject({ kind: 'admin_test', status: 'done', outcome: null, messageId: expect.any(String) });
    expect(view.messages[0]).toMatchObject({ kind: 'admin_test', status: 'delivered' });
  });

  it('leaves members’ waiting requests waiting while all email is off', async () => {
    const ada = await api.member('ada@example.test');
    await api.call('POST', '/v1/me/email/test', ada); // queued while on
    await switchAll(false);
    await ask(sa1);
    await worker.tick();
    expect((await outbox()).map((m) => m.kind).filter((k) => k !== 'probe')).toEqual(['admin_test']);
    expect((await mine(ada)).requests[0]).toMatchObject({ kind: 'test', status: 'pending' });
    await switchAll(true);
    await worker.tick();
    expect((await outbox()).map((m) => m.kind)).toContain('member_test');
  });

  it('is for System Admins alone, one at a time, and a few a day', async () => {
    expect((await ask(membershipAdmin)).status).toBe(403);
    expect((await ask(electionAdmin)).status).toBe(403);
    expect((await ask(sa1)).status).toBe(202);
    expect((await ask(sa1)).status).toBe(409); // one waits already
    for (let i = 0; i < 9; i++) {
      await worker.tick();
      expect((await ask(sa1)).status).toBe(202);
    }
    await worker.tick();
    expect((await ask(sa1)).status).toBe(429);
  });

  it('does not go to a System Admin who unsubscribed', async () => {
    await api.call('POST', '/v1/me/email/unsubscribe', sa1);
    expect((await ask(sa1)).status).toBe(409);
  });
});
