import type { MailCheckId, MailHealthRecord, NoticeRecord, NoticesView, SendVerificationRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { minutes, seedElection, type SeededElection } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** Each send of election email checked before it goes and after (design §6.8), with the outbox standing in for SES. */

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
const notice = async (e: SeededElection) => (await db().collection('notices').doc(`${e.electionId}_voting_open`).get()).data() as NoticeRecord;
const view = async (e: SeededElection) => (await api.call('GET', `/v1/admin/elections/${e.electionId}/notices`, electionAdmin)).body as NoticesView;
const verifications = async (e: SeededElection) =>
  (await db().collection('notice_verifications').where('electionId', '==', e.electionId).get()).docs.map((d) => d.data() as SendVerificationRecord);
/** The setup check's last run, as the worker would have saved it, with these checks failing. */
const lastCheck = (failing: MailCheckId[], checkedAt = new Date().toISOString()) =>
  db()
    .collection('mail_health')
    .doc('current')
    .set({
      checkedAt,
      trigger: 'request',
      requestedBy: null,
      transport: 'outbox',
      domain: 'transhumanist-party.org',
      overall: failing.length ? 'fail' : 'ok',
      checks: failing.map((id) => ({ id, status: 'fail', detail: 'failing in a test', fix: null })),
      probe: null,
    } satisfies MailHealthRecord);

describe('before each send', () => {
  it('holds election email while the setup check fails, and lets it go once it passes', async () => {
    await lastCheck(['sending', 'contact']);
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId) });
    expect((await worker.tick()).body).toMatchObject({ electionsOpened: 1, noticesSent: 0 });
    // The outbox needs no contact, so only the account's sending holds it.
    expect((await notice(election)).held).toEqual({ checks: ['sending'], since: expect.any(String) });
    expect((await view(election)).notices[0]).toMatchObject({ held: { checks: ['sending'] } });
    const since = (await notice(election)).held!.since;
    expect((await worker.tick()).body).toMatchObject({ noticesSent: 0 });
    expect((await notice(election)).held!.since).toBe(since);

    await lastCheck([]);
    expect((await worker.tick()).body).toMatchObject({ noticesSent: 3 });
    expect((await notice(election)).held).toBeNull();
  });

  it('is not held by a check over an hour old where nothing can be checked again (the outbox)', async () => {
    await lastCheck(['sending'], minutes(-61));
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId) });
    expect((await worker.tick()).body).toMatchObject({ noticesSent: 3 });
    expect((await notice(election)).held ?? null).toBeNull();
  });
});

describe('after each send', () => {
  it('checks it 30 minutes later, and tells Election Admins when it fell short', async () => {
    const gone = await api.member('gone@bounce.test');
    const election = await seedElection(api, { voters: [...voters.map((v) => v.accountId), gone.accountId] });
    await worker.tick();
    const [pending] = await verifications(election);
    expect(pending).toMatchObject({ kind: 'voting_open', status: 'pending', messages: 4, checkedAt: null });
    expect((await view(election)).verifications[0]).toMatchObject({ checked: 0, pending: 1 });

    expect((await worker.tick()).body).toMatchObject({ sendsVerified: 0 }); // not 30 minutes yet
    await db().collection('notice_verifications').doc(pending!.receiptId).update({ dueAt: minutes(-1) });
    expect((await worker.tick()).body).toMatchObject({ sendsVerified: 1 });
    const [checked] = await verifications(election);
    expect(checked).toMatchObject({ status: 'short', messages: 4, delivered: 3, bounced: 1, noReport: 0, checkedAt: expect.any(String) });
    expect((await view(election)).verifications[0]).toMatchObject({ checked: 1, pending: 0, shortSends: 1, messages: 4, delivered: 3, bounced: 1 });
    expect(JSON.stringify(checked)).not.toContain('@');
    expect((await worker.tick()).body).toMatchObject({ sendsVerified: 0 }); // once
  });

  it('is ok when every email reached its mail server, and goes with its election', async () => {
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId) });
    await worker.tick();
    const [pending] = await verifications(election);
    await db().collection('notice_verifications').doc(pending!.receiptId).update({ dueAt: minutes(-1) });
    await worker.tick();
    expect((await verifications(election))[0]).toMatchObject({ status: 'ok', messages: 3, delivered: 3 });
    expect((await view(election)).verifications[0]).toMatchObject({ checked: 1, shortSends: 0 });

    const { NoticesService } = await import('./notifications/notices.service.js');
    await api.app.get(NoticesService).forgetElection(election.electionId);
    expect(await verifications(election)).toEqual([]);
  });

  it('leaves a rehearsal unchecked: it mails nobody', async () => {
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId), rehearsal: true });
    await worker.tick();
    expect(await verifications(election)).toEqual([]);
  });
});
