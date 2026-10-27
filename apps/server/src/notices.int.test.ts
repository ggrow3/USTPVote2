import type { NoticeRecipientRecord, NoticeRecord, NoticesView, OutboxMessageRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NoticeSender } from './notifications/notice-sender.js';
import { NoticesService } from './notifications/notices.service.js';
import { closeNow, minutes, seedElection, type SeededElection } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** The voting-open notice (design §6.7): one message per person on the roll, recorded, counted, resent on request. */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let voters: Member[];
let sa1: Member;
let electionAdmin: Member;
let auditor: Member;

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  electionAdmin = await api.member('ea@example.test');
  auditor = await api.member('auditor@example.test');
  await api.grant(electionAdmin.accountId, 'election_admin', sa1);
  await api.grant(auditor.accountId, 'auditor', sa1);
  voters = [];
  for (let i = 0; i < 4; i++) voters.push(await api.member(`v${i}@example.test`));
});

const db = () => api.firebase.db;
const noticeOf = (e: SeededElection) => `${e.electionId}_voting_open`;
const outbox = async (e: SeededElection) =>
  (await db().collection('notice_outbox').where('electionId', '==', e.electionId).get()).docs.map((d) => d.data() as OutboxMessageRecord);
const recipients = async (e: SeededElection) =>
  (await db().collection('notices').doc(noticeOf(e)).collection('recipients').get()).docs.map((d) => d.data() as NoticeRecipientRecord);
const recipient = async (e: SeededElection, accountId: string) =>
  (await db().collection('notices').doc(noticeOf(e)).collection('recipients').doc(accountId).get()).data() as NoticeRecipientRecord;
const notice = async (e: SeededElection) => (await db().collection('notices').doc(noticeOf(e)).get()).data() as NoticeRecord | undefined;
const ledger = async (type: string, e: SeededElection) =>
  (await db().collection('audit_events').where('type', '==', type).where('subject', '==', e.electionId).get()).docs.map((d) => d.data());
const view = (e: SeededElection, as: User = electionAdmin) => api.call('GET', `/v1/admin/elections/${e.electionId}/notices`, as);
const resend = (e: SeededElection, as: User = electionAdmin) => api.call('POST', `/v1/admin/elections/${e.electionId}/notices/voting_open/resend`, as);

/** A member whose account address is at a domain the outbox acts out a provider's answer for. */
const memberAt = (email: string) => api.member(email);

describe('the voting-open notice', () => {
  it('records exactly one message per person on the roll when the election opens, however often the worker runs', async () => {
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId) });
    const tick = await worker.tick();
    expect(tick.status).toBe(200);
    expect(tick.body).toMatchObject({ electionsOpened: 1, noticesSent: 4 });

    // Ticks that overlap or repeat send nothing more.
    const again = await Promise.all([worker.tick(), worker.tick(), worker.tick()]);
    expect(again.map((t) => t.body.noticesSent)).toEqual([0, 0, 0]);

    const messages = await outbox(election);
    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.to).sort()).toEqual(voters.map((v) => v.email).sort());
    expect(new Set(messages.map((m) => m.accountId)).size).toBe(4);
    const [first] = messages;
    expect(first!.subject).toBe('Voting is open: Officers');
    expect(first!.from).toBe('USTP Elections <elections@ustpvote.test>');
    expect(first!.text).toContain(`http://localhost:5173/ballot/${election.electionId}`);
    expect(first!.text).toContain(`http://localhost:5173/v1/public/elections/${election.electionId}/calendar.ics`);
    expect(first!.text).toContain('http://localhost:5173/verify');
    expect(first!.html).toContain('Open your ballot for “Officers”');

    expect((await recipients(election)).map((r) => r.status)).toEqual(['sent', 'sent', 'sent', 'sent']);
    // The records never hold an address.
    expect(JSON.stringify(await recipients(election))).not.toContain('@');
    const sent = await ledger('notice.sent', election);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      actor: 'system',
      payload: { electionId: election.electionId, kind: 'voting_open', round: 1, delivery: 'outbox', recipients: 4, sent: 4, failed: 0, bounced: 0, skipped: 0 },
    });
    expect(JSON.stringify(sent[0]!.payload)).not.toContain('@');
  });

  it('skips people with nowhere to send it, fails refused addresses, and retries a provider that is down', async () => {
    const unverified = await api.user('unverified@example.test', { emailVerified: false });
    const unverifiedAccount = (await api.call('POST', '/v1/accounts', unverified)).body.accountId as string;
    const refused = await memberAt('nobody@refused.test');
    const down = await memberAt('later@unavailable.test');
    const roll = [voters[0]!.accountId, unverifiedAccount, refused.accountId, down.accountId, 'no-such-account'];
    const election = await seedElection(api, { voters: roll });

    expect((await worker.tick()).body).toMatchObject({ electionsOpened: 1, noticesSent: 1 });
    expect(await recipient(election, unverifiedAccount)).toMatchObject({ status: 'skipped', outcome: 'unverified_address' });
    expect(await recipient(election, 'no-such-account')).toMatchObject({ status: 'skipped', outcome: 'no_address' });
    expect(await recipient(election, refused.accountId)).toMatchObject({ status: 'failed', outcome: 'refused' });
    expect(await recipient(election, down.accountId)).toMatchObject({ status: 'pending', outcome: 'unavailable', attempts: 1 });
    expect((await notice(election))!.status).toBe('sending');

    await worker.tick();
    await worker.tick();
    expect(await recipient(election, down.accountId)).toMatchObject({ status: 'failed', outcome: 'unavailable', attempts: 3 });
    expect((await notice(election))!.status).toBe('done');
    expect((await ledger('notice.sent', election))[0]!.payload).toMatchObject({ recipients: 5, sent: 1, failed: 2, skipped: 2 });
    expect(await outbox(election)).toHaveLength(1);
  });

  it('shows Election Admins and Auditors the counts, and lets an Election Admin resend to those it failed for', async () => {
    const refused = await memberAt('typo@refused.test');
    const election = await seedElection(api, { voters: [...voters.map((v) => v.accountId), refused.accountId] });
    expect((await resend(election)).status).toBe(404); // no notice yet
    await worker.tick();

    const seen = await view(election);
    expect(seen.status).toBe(200);
    expect(seen.body as NoticesView).toMatchObject({
      delivery: 'outbox',
      notices: [
        {
          kind: 'voting_open',
          delivery: 'outbox',
          rehearsal: false,
          status: 'done',
          round: 1,
          recipients: 5,
          counts: { pending: 0, sent: 4, failed: 1, bounced: 0, skipped: 0 },
        },
      ],
    });
    expect(JSON.stringify(seen.body)).not.toContain('@');
    expect((await view(election, auditor)).status).toBe(200);
    expect((await view(election, voters[0]!)).status).toBe(403);
    expect((await resend(election, auditor)).status).toBe(403);

    // The member fixes their address; the resend reaches them and nobody else.
    await db().collection('accounts').doc(refused.accountId).update({ primaryEmail: 'fixed@example.test' });
    const resent = await resend(election);
    expect(resent.status).toBe(200);
    expect(resent.body).toMatchObject({ status: 'sending', round: 2, counts: { failed: 1 } });
    expect((await resend(election)).status).toBe(409); // still sending
    expect(await ledger('notice.resend_requested', election)).toEqual([
      expect.objectContaining({ actor: electionAdmin.accountId, payload: { electionId: election.electionId, kind: 'voting_open', round: 2, failed: 1 } }),
    ]);

    expect((await worker.tick()).body).toMatchObject({ noticesSent: 1 });
    const messages = await outbox(election);
    expect(messages).toHaveLength(5);
    expect(messages.filter((m) => m.accountId === refused.accountId).map((m) => m.to)).toEqual(['fixed@example.test']);
    expect((await view(election)).body.notices[0]).toMatchObject({ status: 'done', round: 2, counts: { sent: 5, failed: 0 } });
    expect((await ledger('notice.sent', election)).map((e) => e.payload.round).sort()).toEqual([1, 2]);
    expect((await resend(election)).status).toBe(409); // failed for nobody now
  });

  it('refuses a resend once voting has closed, and never tells anyone it is open after it closed', async () => {
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId), state: 'open', secrecy: 'open' });
    // The notice starts, but this run has no time left to send.
    await worker.app.get(NoticeSender).sendDue(0);
    expect((await notice(election))!.status).toBe('sending');
    expect(await outbox(election)).toHaveLength(0);

    await closeNow(api, election);
    expect((await worker.tick()).body).toMatchObject({ electionsClosed: 1, noticesSent: 0 });
    expect(await outbox(election)).toHaveLength(0);
    expect((await recipients(election)).map((r) => r.outcome)).toEqual(Array(4).fill('voting_closed'));
    expect((await ledger('notice.sent', election))[0]!.payload).toMatchObject({ sent: 0, failed: 4 });
    expect((await resend(election)).status).toBe(409);
  });

  it('fails a send a worker was interrupted in, rather than risk sending it twice', async () => {
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId), state: 'open', secrecy: 'open', opensAt: minutes(-1) });
    await worker.app.get(NoticeSender).sendDue(0);
    const stuck = voters[0]!.accountId;
    await db()
      .collection('notices')
      .doc(noticeOf(election))
      .collection('recipients')
      .doc(stuck)
      .update({ status: 'sending', attempts: 1, claimedAt: minutes(-10) });

    expect((await worker.tick()).body).toMatchObject({ noticesSent: 3 });
    expect(await recipient(election, stuck)).toMatchObject({ status: 'failed', outcome: 'interrupted' });
    expect((await outbox(election)).map((m) => m.accountId)).not.toContain(stuck);
  });

  it('is removed with a deleted election', async () => {
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId) });
    await worker.tick();
    expect(await outbox(election)).toHaveLength(4);
    await api.app.get(NoticesService).forgetElection(election.electionId);
    expect(await notice(election)).toBeUndefined();
    expect(await recipients(election)).toHaveLength(0);
    expect(await outbox(election)).toHaveLength(0);
  });
});

describe('a rehearsal roll', () => {
  it('gets no notice where testing mode is off', async () => {
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId), rehearsal: true });
    expect((await worker.tick()).body).toMatchObject({ electionsOpened: 1, noticesSent: 0 });
    expect(await notice(election)).toBeUndefined();
    expect(await outbox(election)).toHaveLength(0);
    expect((await view(election)).body).toEqual({ delivery: 'outbox', notices: [] });
  });

  it('gets its notice in the outbox, addressed to nobody, where testing mode is on', async () => {
    process.env.TESTING_MODE = 'true';
    const testing = await TestWorker.start().finally(() => delete process.env.TESTING_MODE);
    try {
      // Test voters have no address; these accounts have one, which a rehearsal still never uses.
      const election = await seedElection(api, { voters: voters.map((v) => v.accountId), rehearsal: true });
      expect((await testing.tick()).body).toMatchObject({ electionsOpened: 1, noticesSent: 4 });
      const messages = await outbox(election);
      expect(messages).toHaveLength(4);
      expect(messages.map((m) => m.to)).toEqual([null, null, null, null]);
      expect(await notice(election)).toMatchObject({ rehearsal: true, delivery: 'outbox', status: 'done' });
    } finally {
      await testing.close();
    }
  });
});
