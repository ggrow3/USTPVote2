import type { NoticeRecipientRecord, NoticeRecord, OutboxMessageRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { minutes, seedElection, type SeededElection } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** Vote confirmations (design §6.8): each voter is told, soon after, that their ballot was recorded, and when. */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let voters: Member[];
let electionAdmin: Member;

beforeEach(async () => {
  await resetEmulators();
  const [sa1] = await api.systemAdmins();
  electionAdmin = await api.member('ea@example.test');
  await api.grant(electionAdmin.accountId, 'election_admin', sa1);
  voters = [];
  for (let i = 0; i < 3; i++) voters.push(await api.member(`v${i}@example.test`));
});

const db = () => api.firebase.db;
const votedOf = (e: SeededElection) => `${e.electionId}_voted`;
const notice = async (e: SeededElection) => (await db().collection('notices').doc(votedOf(e)).get()).data() as NoticeRecord | undefined;
const recipient = async (e: SeededElection, accountId: string) =>
  (await db().collection('notices').doc(votedOf(e)).collection('recipients').doc(accountId).get()).data() as NoticeRecipientRecord | undefined;
const confirmations = async (e: SeededElection) =>
  (await db().collection('notice_outbox').where('electionId', '==', e.electionId).get()).docs
    .map((d) => d.data() as OutboxMessageRecord)
    .filter((m) => m.kind === 'voted');
const vote = (e: SeededElection, accountId: string, castAt = new Date().toISOString()) =>
  e.ref.collection('participation').doc(accountId).set({ accountId, castAt });
const open = () => seedElection(api, { voters: voters.map((v) => v.accountId), state: 'open', secrecy: 'open', opensAt: minutes(-60), closesAt: minutes(60 * 24 * 3) });

describe('vote confirmations', () => {
  it('tell each voter once, soon after they vote, when (never how)', async () => {
    const election = await open();
    expect((await worker.tick()).body).toMatchObject({ noticesSent: 3 }); // voting is open, to all three
    expect(await notice(election)).toBeUndefined(); // it starts with the first ballot

    await vote(election, voters[0]!.accountId, '2026-11-03T15:04:00.000Z');
    expect((await worker.tick()).body).toMatchObject({ noticesSent: 1 });
    const [sent] = await confirmations(election);
    expect(sent).toMatchObject({ to: voters[0]!.email, accountId: voters[0]!.accountId, subject: 'Your vote was recorded: Officers' });
    expect(sent!.text).toContain('Your ballot was recorded Tuesday, November 3, 2026, 10:04 AM EST (Eastern Time).');
    expect(sent!.text).toContain('If you did not vote, someone may have signed in as you');
    expect(sent!.text).not.toMatch(/commitment|receipt code|chose/i);
    expect(await recipient(election, voters[0]!.accountId)).toMatchObject({ status: 'delivered' });

    // Ticks that repeat send nothing more; the next voter gets theirs.
    expect((await worker.tick()).body).toMatchObject({ noticesSent: 0 });
    await vote(election, voters[1]!.accountId);
    expect((await worker.tick()).body).toMatchObject({ noticesSent: 1 });
    expect((await confirmations(election)).map((m) => m.accountId).sort()).toEqual([voters[0]!.accountId, voters[1]!.accountId].sort());
    expect(await notice(election)).toMatchObject({ status: 'sending', recipients: 2 });
  });

  it('reach a ballot whose record committed after a later one was seen', async () => {
    const election = await open();
    await worker.tick();
    await vote(election, voters[0]!.accountId);
    await worker.tick();
    // Cast five minutes before the last look, committed after it.
    await vote(election, voters[1]!.accountId, minutes(-5));
    await worker.tick();
    expect(await recipient(election, voters[1]!.accountId)).toMatchObject({ status: 'delivered' });
  });

  it('go out after the close for ballots cast just before it, then finish', async () => {
    const election = await open();
    await worker.tick();
    await vote(election, voters[0]!.accountId);
    await election.ref.update({ state: 'closed', closesAt: minutes(-1) });
    expect((await worker.tick()).body).toMatchObject({ noticesSent: 1 });
    expect(await notice(election)).toMatchObject({ status: 'done', recipients: 1 });
    const sent = (await db().collection('audit_events').where('type', '==', 'notice.sent').where('subject', '==', election.electionId).get()).docs
      .map((d) => d.data().payload)
      .find((p) => p.kind === 'voted');
    expect(sent).toMatchObject({ kind: 'voted', recipients: 1, sent: 1 });
  });

  it('are not sent long after the close, nor resent', async () => {
    const election = await open();
    await worker.tick();
    await vote(election, voters[0]!.accountId);
    await worker.tick();
    await vote(election, voters[1]!.accountId);
    await election.ref.update({ state: 'closed', closesAt: minutes(-60 * 25) });
    await worker.tick();
    expect(await recipient(election, voters[1]!.accountId)).toMatchObject({ status: 'failed', outcome: 'voting_closed' });
    expect(await notice(election)).toMatchObject({ status: 'done', recipients: 2 });
    expect((await api.call('POST', `/v1/admin/elections/${election.electionId}/notices/voted/resend`, electionAdmin)).status).toBe(409);
  });
});
