import { addMonths, type ApprovalRequestRecord, type LedgerEntry, type PositionsView, type PositionTermRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let ma: Member;
let ea: Member;
let auditor: Member;
let ada: Member;
let bob: Member;

/** Gives the account a member record with this status, as the membership context would. */
async function memberRecord(user: Member, legalName: string, status = 'active') {
  await api.firebase.db
    .collection('members')
    .doc(user.accountId)
    .set({ accountId: user.accountId, status, legalName, preferredName: null, state: 'CA' });
}

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  ma = await api.member('membership.admin@example.test');
  ea = await api.member('election.admin@example.test');
  auditor = await api.member('auditor@example.test');
  ada = await api.member('ada@example.test');
  bob = await api.member('bob@example.test');
  await api.grant(ma.accountId, 'membership_admin', sa1);
  await api.grant(ea.accountId, 'election_admin', sa1);
  await api.grant(auditor.accountId, 'auditor', sa1);
  await memberRecord(ada, 'Ada Brooks');
  await memberRecord(bob, 'Bob Adams');
  for (const office of [
    { positionId: 'chair', title: 'Chair', seats: 1, termMonths: 24 },
    { positionId: 'board', title: 'Board member', seats: 2, termMonths: 12 },
  ]) {
    expect((await api.call('POST', '/v1/admin/positions', ea, { ...office, reason: 'bylaws art. 4' })).status).toBe(201);
  }
});

const REASON = 'Vacancy filled by the officers’ vote of 2026-10-20 under bylaws art. 4.3';
const appoint = (by: User, positionId: string, body: Record<string, unknown>) =>
  api.call('POST', `/v1/admin/positions/${positionId}/appointments`, by, { reason: REASON, ...body });
const decide = (by: User, id: string, decision: 'approve' | 'reject' = 'approve') =>
  api.call('POST', `/v1/admin/approvals/${id}/decision`, by, { decision, reason: 'checked against the minutes' });
const publicTerms = async () => ((await api.call('GET', '/v1/public/positions')).body as PositionsView).terms;
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

/** Requests and approves an appointment; returns the new term. */
async function appointed(positionId: string, member: Member, body: Record<string, unknown> = {}): Promise<PositionTermRecord> {
  const req = await appoint(ma, positionId, { accountId: member.accountId, ...body });
  expect(req.status).toBe(201);
  expect((await decide(auditor, req.body.id)).body.status).toBe('executed');
  return (await publicTerms()).find((t) => t.accountId === member.accountId && t.positionId === positionId)!;
}

async function entries(type: string): Promise<LedgerEntry[]> {
  const snap = await api.firebase.db.collection('audit_events').where('type', '==', type).orderBy('seq').get();
  return snap.docs.map((d) => d.data() as LedgerEntry);
}

describe('appointments to offices', () => {
  it('appoint an Active member with two people, marked as an appointment publicly and in the ledger', async () => {
    const req = await appoint(ma, 'chair', { accountId: ada.accountId });
    expect(req).toMatchObject({
      status: 201,
      body: {
        action: 'position.appoint',
        subject: ada.accountId,
        approverRole: 'auditor',
        reason: REASON,
        payload: { positionId: 'chair', accountId: ada.accountId, holderName: 'Ada Brooks', startsAt: null, endsAt: null, termMonths: 24 },
      },
    });
    expect(await publicTerms()).toEqual([]); // nothing until an Auditor approves

    expect((await decide(ma, req.body.id)).status).toBe(403); // the requester
    expect((await decide(ea, req.body.id)).status).toBe(403); // not an Auditor
    const decided = await decide(auditor, req.body.id);
    expect(decided.body).toMatchObject({ status: 'executed', decidedBy: auditor.accountId });

    const [term] = await publicTerms();
    expect(term).toMatchObject({
      basis: 'appointment',
      positionId: 'chair',
      holderName: 'Ada Brooks',
      accountId: ada.accountId,
      approvalId: req.body.id,
      reason: REASON,
      status: 'active',
      endedAt: null,
    });
    // From the approval, for the office's full term.
    expect(Date.parse(term!.startsAt)).toBeGreaterThan(Date.parse(req.body.requestedAt));
    expect(Date.parse(term!.startsAt)).toBeLessThanOrEqual(Date.parse(decided.body.decidedAt));
    expect(term!.endsAt).toBe(addMonths(term!.startsAt, 24));
    expect(term).not.toHaveProperty('resultsHash');
    expect((await api.call('GET', '/v1/admin/positions', auditor)).body.terms).toEqual([term]);

    // Ledgered publicly, with the reason; the request itself stays with Auditors.
    const [entry] = await entries('position_term.appointed');
    expect(entry).toMatchObject({
      actor: auditor.accountId,
      subject: 'chair',
      payload: {
        termId: term!.termId,
        positionId: 'chair',
        holderName: 'Ada Brooks',
        accountId: ada.accountId,
        startsAt: term!.startsAt,
        endsAt: term!.endsAt,
        reason: REASON,
        approvalId: req.body.id,
      },
    });
    const [requested] = (await entries('approval.requested')).filter((e) => e.payload.action === 'position.appoint');
    expect(requested).toMatchObject({ actor: ma.accountId, subject: ada.accountId, payload: { reason: REASON } });
    await worker.tick(); // seals the entries into a signed block
    expect((await api.call('GET', `/v1/public/ledger/entries/${entry!.seq}`)).body.entry).toMatchObject({ type: 'position_term.appointed' });
    expect((await api.call('GET', `/v1/public/ledger/entries/${requested!.seq}`)).status).toBe(404);
  });

  it('are asked for by Membership and Election Admins, who may find the member by name', async () => {
    expect((await appoint(ea, 'board', { accountId: ada.accountId })).status).toBe(201);
    for (const user of [auditor, sa1, bob]) expect((await appoint(user, 'board', { accountId: bob.accountId })).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/member-search?name=brooks', ma)).body).toEqual([
      { accountId: ada.accountId, legalName: 'Ada Brooks', preferredName: null, state: 'CA' },
    ]);
  });

  it('let the appointee neither ask nor approve', async () => {
    await memberRecord(ma, 'Mae Admin');
    expect((await appoint(ma, 'chair', { accountId: ma.accountId })).body.detail).toBe('you cannot request this for your own account');
    await memberRecord(auditor, 'Aud Itor');
    const req = await appoint(ma, 'chair', { accountId: auditor.accountId });
    expect(req.status).toBe(201);
    expect((await decide(auditor, req.body.id)).body.detail).toBe('you cannot approve an action on your own account');
  });

  it('only appoint an Active member', async () => {
    const carol = await api.member('carol@example.test');
    expect((await appoint(ma, 'chair', { accountId: carol.accountId })).status).toBe(409); // no member record
    await memberRecord(carol, 'Carol Lapsed', 'lapsed');
    expect(await appoint(ma, 'chair', { accountId: carol.accountId })).toMatchObject({
      status: 409,
      body: { detail: 'only an Active member can be appointed, and Carol Lapsed is not one' },
    });
    expect((await appoint(ma, 'nope', { accountId: ada.accountId })).status).toBe(404);

    // Suspended after the request: the approval checks again.
    await memberRecord(carol, 'Carol Lapsed');
    const req = await appoint(ma, 'chair', { accountId: carol.accountId });
    await memberRecord(carol, 'Carol Lapsed', 'suspended');
    expect((await decide(auditor, req.body.id)).status).toBe(409);
    expect(((await api.firebase.db.collection('approval_requests').doc(req.body.id).get()).data() as ApprovalRequestRecord).status).toBe('pending');
  });

  it('fill only a free seat, and never displace a sitting holder', async () => {
    await appointed('chair', ada);
    expect(await appoint(ma, 'chair', { accountId: bob.accountId })).toMatchObject({
      status: 409,
      body: { detail: 'Chair has no free seat (its one seat is held): end a term first, then appoint' },
    });
    expect((await appoint(ma, 'chair', { accountId: ada.accountId })).body.detail).toBe('Ada Brooks already holds the office of Chair');

    // Two seats: two people, one request per member at a time.
    expect((await appoint(ma, 'board', { accountId: ada.accountId })).status).toBe(201);
    expect((await appoint(ea, 'board', { accountId: ada.accountId })).body.detail).toBe('a request for this is already waiting for a decision');
    const second = await appoint(ma, 'board', { accountId: bob.accountId });
    const carol = await api.member('carol@example.test');
    await memberRecord(carol, 'Carol Chen');
    const third = await appoint(ma, 'board', { accountId: carol.accountId }); // a seat looks free while nobody is approved
    const pending = ((await api.call('GET', '/v1/admin/approvals?status=pending', auditor)).body as ApprovalRequestRecord[]).filter(
      (r) => r.action === 'position.appoint',
    );
    expect(pending.map((r) => r.subject).sort()).toEqual([ada.accountId, bob.accountId, carol.accountId].sort());
    expect((await decide(auditor, pending.find((r) => r.subject === ada.accountId)!.id)).status).toBe(201);
    expect((await decide(auditor, second.body.id)).status).toBe(201);
    expect(await decide(auditor, third.body.id)).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/^Board member has no free seat/) } });
    expect((await decide(auditor, third.body.id, 'reject')).body.status).toBe('rejected');
    expect((await publicTerms()).filter((t) => t.positionId === 'board').map((t) => t.holderName).sort()).toEqual(['Ada Brooks', 'Bob Adams']);
  });

  it('start when approved or earlier, and last no longer than the office’s term', async () => {
    expect((await appoint(ma, 'chair', { accountId: ada.accountId, startsAt: days(2) })).status).toBe(409);
    expect((await appoint(ma, 'chair', { accountId: ada.accountId, termMonths: 25 })).body.detail).toBe('a term of Chair lasts at most 24 months');
    expect((await appoint(ma, 'chair', { accountId: ada.accountId, endsAt: days(800) })).status).toBe(409);
    expect((await appoint(ma, 'chair', { accountId: ada.accountId, startsAt: days(-800) })).body.detail).toBe('the term would already be over');
    expect((await appoint(ma, 'chair', { accountId: ada.accountId, endsAt: days(30), termMonths: 3 })).status).toBe(400);

    // Someone already serving when the system starts: their term began a year ago.
    const since = new Date(Date.UTC(new Date().getUTCFullYear() - 1, new Date().getUTCMonth(), 1)).toISOString();
    const chair = await appointed('chair', ada, { startsAt: since });
    expect(chair).toMatchObject({ startsAt: since, endsAt: addMonths(since, 24) });

    // An interim appointment until a set date.
    const until = days(90);
    expect(await appointed('board', bob, { endsAt: until })).toMatchObject({ endsAt: until });
    const months = await appointed('board', ada, { termMonths: 3 });
    expect(months.endsAt).toBe(addMonths(months.startsAt, 3));
  });

  it('can be ended early, or the appointee removed, only with two people; the seat is then free', async () => {
    const term = await appointed('chair', ada);
    const end = await api.call('POST', `/v1/admin/positions/chair/terms/${term.termId}/end`, ea, { reason: 'resigned' });
    expect(end).toMatchObject({ status: 201, body: { action: 'position.modify', payload: { change: 'end_term', termId: term.termId } } });
    expect(await publicTerms()).toHaveLength(1);
    expect((await decide(ea, end.body.id)).status).toBe(403);
    expect((await decide(auditor, end.body.id)).body.status).toBe('executed');
    expect(await publicTerms()).toEqual([]);
    const ended = ((await api.call('GET', '/v1/admin/positions', auditor)).body as PositionsView).terms[0];
    expect(ended).toMatchObject({ basis: 'appointment', status: 'ended', endReason: 'resigned', endedAt: expect.any(String) });
    expect((await entries('position_term.ended'))[0]!.payload).toMatchObject({ termId: term.termId, reason: 'resigned' });

    // The appointee, an admin themselves, may not end their own term.
    await memberRecord(ma, 'Mae Admin');
    const own = await api.call('POST', '/v1/admin/positions/chair/appointments', ea, { accountId: ma.accountId, reason: REASON });
    expect((await decide(auditor, own.body.id)).body.status).toBe('executed');
    const maTerm = (await publicTerms())[0]!;
    expect((await api.call('POST', `/v1/admin/positions/chair/terms/${maTerm.termId}/end`, ma, { reason: 'stepping down' })).status).toBe(403);
  });

  it('create nothing when rejected', async () => {
    const req = await appoint(ma, 'chair', { accountId: ada.accountId });
    expect((await decide(auditor, req.body.id, 'reject')).body.status).toBe('rejected');
    expect(await publicTerms()).toEqual([]);
    expect(await entries('position_term.appointed')).toEqual([]);
  });
});
