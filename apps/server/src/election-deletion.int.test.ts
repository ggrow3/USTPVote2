import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeNow, ledgerTypes, seedElection, seededBallot } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let ea: Member;
let auditor: Member;
let voter: Member;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' };
const admin = (electionId: string) => `/v1/admin/elections/${electionId}`;
const remove = (electionId: string, by: User = ea) => api.call('POST', `${admin(electionId)}/delete`, by, { reason: 'set up by mistake' });
const decide = (by: User, id: string) => api.call('POST', `/v1/admin/approvals/${id}/decision`, by, { decision: 'approve', reason: 'ok' });

/** Cancels a scheduled or open election through the two-person rule. */
async function cancelWithAuditor(electionId: string) {
  const { request } = (await api.call('POST', `${admin(electionId)}/cancel`, ea, { reason: 'called off' })).body;
  expect((await decide(auditor, request.id)).body.status).toBe('executed');
}

const exists = async (path: string) => (await api.firebase.db.doc(path).get()).exists;
const count = async (path: string) => (await api.firebase.db.collection(path).get()).size;

beforeEach(async () => {
  await resetEmulators();
  const [sa1] = await api.systemAdmins();
  ea = await api.member('election.admin@example.test');
  auditor = await api.member('auditor@example.test');
  voter = await api.member('voter@example.test');
  await api.grant(ea.accountId, 'election_admin', sa1);
  await api.grant(auditor.accountId, 'auditor', sa1);
  await api.firebase.db.collection('members').doc(voter.accountId).set({ accountId: voter.accountId, status: 'active', legalName: 'Vee' });
});

describe('deleting an election', () => {
  it('deletes a cancelled draft and everything stored with it, and ledgers the deletion', async () => {
    const { electionId } = (
      await api.call('POST', '/v1/admin/elections', ea, { title: 'Officers', secrecy: 'secret', opensAt: inDays(10), closesAt: inDays(17) })
    ).body;
    const url = admin(electionId);
    const text = (await api.call('POST', '/v1/admin/proposals', ea, { title: 'Plank', body: 'Adopt it.' })).body;
    await api.call('POST', `${url}/contests`, ea, { kind: 'proposal', title: 'Plank', proposalSnapshotId: text.snapshotId, passRule: MAJORITY });
    const chair = (await api.call('POST', `${url}/contests`, ea, { kind: 'irv', title: 'Chair' })).body;
    await api.call('POST', `${url}/contests/${chair.contestId}/candidates`, ea, { name: 'Alex' });
    await api.call('POST', `${url}/contests/${chair.contestId}/candidates`, ea, { name: 'Blair' });
    const roll = (await api.call('POST', `${url}/roll`, ea, { reason: 'roll' })).body;
    await decide(auditor, roll.approvalId);
    const pending = (await api.call('POST', `${url}/schedule`, ea, { reason: 'go' })).body;

    expect(await remove(electionId)).toMatchObject({ status: 409, body: { detail: 'a draft election cannot be deleted; only cancelled ones can' } });
    expect((await api.call('GET', url, ea)).body.ballotsCast).toBeNull();
    await api.call('POST', `${url}/cancel`, ea, { reason: 'duplicate' });
    expect((await api.call('GET', url, ea)).body.ballotsCast).toBe(0);
    expect((await remove(electionId, auditor)).status).toBe(403);

    expect((await remove(electionId)).status).toBe(204);
    expect((await api.call('GET', url, ea)).status).toBe(404);
    expect((await api.call('GET', '/v1/admin/elections', ea)).body).toEqual([]);
    expect((await api.call('GET', `/v1/public/elections/${electionId}`)).status).toBe(404);
    expect(await exists(`elections/${electionId}`)).toBe(false);
    expect(await count(`elections/${electionId}/contests`)).toBe(0);
    expect(await count(`elections/${electionId}/candidates`)).toBe(0);
    expect((await api.firebase.db.collection('eligibility_snapshots').where('electionId', '==', electionId).get()).empty).toBe(true);
    // The pending request goes; the decided one stays as the record of who approved what.
    expect(await exists(`approval_requests/${pending.id}`)).toBe(false);
    expect((await api.firebase.db.doc(`approval_requests/${roll.approvalId}`).get()).data()).toMatchObject({ status: 'executed' });
    // Proposal texts are shared between elections and stay.
    expect(await exists(`proposal_snapshots/${text.snapshotId}`)).toBe(true);
    expect((await remove(electionId)).status).toBe(404);

    const types = await ledgerTypes(api, electionId);
    expect(types.slice(-2)).toEqual(['election.cancelled', 'election.deleted']);
    const deleted = (await api.firebase.db.collection('audit_events').where('type', '==', 'election.deleted').get()).docs[0]!.data();
    expect(deleted).toMatchObject({ actor: ea.accountId, subject: electionId, payload: { electionId, title: 'Officers', reason: 'set up by mistake' } });

    // The chain still verifies, and once in a block the deletion is a public entry like the cancellation.
    expect((await worker.tick()).status).toBe(200);
    expect((await api.call('GET', '/v1/admin/audit/verify', auditor)).body).toMatchObject({ ok: true });
    const served = await api.call('GET', `/v1/public/ledger/entries/${deleted.seq}`);
    expect(served).toMatchObject({ status: 200, body: { entry: { type: 'election.deleted', hash: deleted.hash } } });
  });

  it('waits for the worker to destroy a cancelled election’s pool key, then deletes its tie-break seed too', async () => {
    const seeded = await seedElection(api, { voters: [voter.accountId], opensAt: inDays(1), closesAt: inDays(2) });
    const { tieBreakSeedRef } = (await seeded.ref.get()).data()!;
    expect((await worker.tick()).body).toMatchObject({ poolKeysCreated: 1 });
    await cancelWithAuditor(seeded.electionId);

    expect(await remove(seeded.electionId)).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/encryption key is still being destroyed/) } });
    expect((await worker.tick()).status).toBe(200);
    expect((await seeded.ref.get()).data()).toMatchObject({ poolKeyDestroyedAt: expect.any(String) });

    expect((await remove(seeded.electionId)).status).toBe(204);
    expect(await exists(`elections/${seeded.electionId}`)).toBe(false);
    expect(await exists(`eligibility_snapshots/r-${seeded.electionId}`)).toBe(false);
    expect(await exists(`emulator_secrets/${tieBreakSeedRef}`)).toBe(false);
    expect((await ledgerTypes(api, seeded.electionId)).slice(-3)).toEqual(['election.cancelled', 'election.pool_key_destroyed', 'election.deleted']);
    expect((await worker.tick()).status).toBe(200);
    expect((await api.call('GET', '/v1/admin/audit/verify', auditor)).body).toMatchObject({ ok: true });
  });

  it('refuses an election in which a ballot was cast, even once cancelled', async () => {
    const seeded = await seedElection(api, { voters: [voter.accountId], secrecy: 'open' });
    expect((await worker.tick()).body).toMatchObject({ electionsOpened: 1 });
    const { definitionHash } = (await api.call('GET', `${seeded.url}/ballot`, voter)).body;
    expect((await api.call('POST', `${seeded.url}/ballots`, voter, { definitionHash, parts: seededBallot(seeded.electionId) })).status).toBe(201);

    expect((await remove(seeded.electionId)).status).toBe(409);
    await cancelWithAuditor(seeded.electionId);
    expect((await api.call('GET', admin(seeded.electionId), ea)).body.ballotsCast).toBe(1);
    expect(await remove(seeded.electionId)).toMatchObject({ status: 409, body: { detail: '1 ballot was cast in it, so it stays on record' } });
    expect(await exists(`elections/${seeded.electionId}`)).toBe(true);
    expect(await ledgerTypes(api, seeded.electionId)).not.toContain('election.deleted');
  });

  it('keeps an Election Admin who is a candidate from deleting it', async () => {
    const seeded = await seedElection(api, { voters: [voter.accountId], secrecy: 'open', state: 'cancelled', blairAccountId: ea.accountId });
    expect(await remove(seeded.electionId)).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/candidate in this election/) } });
  });
});

describe('deleting a rehearsal (design §10.4)', () => {
  /** The same api with testing mode on, as on dev; `api` above has it off, as in production. */
  let testing: TestApi;
  let voter2: Member;
  beforeAll(async () => {
    process.env.TESTING_MODE = 'true';
    testing = await TestApi.start();
    delete process.env.TESTING_MODE;
  });
  afterAll(() => testing.close());
  beforeEach(async () => {
    voter2 = await api.member('voter2@example.test');
  });

  const removeRehearsal = (electionId: string) =>
    testing.call('POST', `${admin(electionId)}/delete`, ea, { reason: 'demo over' });

  /** A secret rehearsal both voters voted in, closed and tallied, then certified by the Election Admin and Auditor. */
  async function certifiedRehearsal(opts: { chairPositionId?: string } = {}) {
    const seeded = await seedElection(testing, { voters: [voter.accountId, voter2.accountId], kAnonymity: 2, rehearsal: true, ...opts });
    expect((await worker.tick()).body).toMatchObject({ electionsOpened: 1 });
    const { definitionHash } = (await testing.call('GET', `${seeded.url}/ballot`, voter)).body;
    for (const v of [voter, voter2]) {
      expect((await testing.call('POST', `${seeded.url}/ballots`, v, { definitionHash, parts: seededBallot(seeded.electionId) })).status).toBe(201);
    }
    await closeNow(testing, seeded);
    expect((await worker.tick()).body).toMatchObject({ resultsComputed: 1 });
    expect(await removeRehearsal(seeded.electionId)).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/once its results are certified/) } });
    const req = await testing.call('POST', `${admin(seeded.electionId)}/certify`, ea, { reason: 'demo count' });
    expect((await testing.call('POST', `/v1/admin/approvals/${req.body.id}/decision`, auditor, { decision: 'approve', reason: 'ok' })).body.status).toBe(
      'executed',
    );
    return seeded;
  }

  it('deletes a certified rehearsal with its ballots and results, where testing mode is on', async () => {
    const seeded = await certifiedRehearsal();
    const { tieBreakSeedRef } = (await seeded.ref.get()).data()!;
    expect((await testing.call('GET', admin(seeded.electionId), ea)).body).toMatchObject({ ballotsCast: 2, officeTerms: 0 });
    expect(await removeRehearsal(seeded.electionId)).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/encryption key/) } });
    expect((await worker.tick()).body).toMatchObject({ poolKeysDestroyed: 1 });

    // Where testing mode is off (production), a rehearsal is held to the ordinary rule.
    expect(await remove(seeded.electionId)).toMatchObject({ status: 409, body: { detail: 'a certified election cannot be deleted; only cancelled ones can' } });

    expect((await removeRehearsal(seeded.electionId)).status).toBe(204);
    expect(await exists(`elections/${seeded.electionId}`)).toBe(false);
    for (const sub of ['participation', 'ballot_pool', 'sealed_blocks', 'contests', 'candidates']) {
      expect(await count(`elections/${seeded.electionId}/${sub}`)).toBe(0);
    }
    expect(await exists(`results/${seeded.electionId}`)).toBe(false);
    expect(await exists(`eligibility_snapshots/r-${seeded.electionId}`)).toBe(false);
    expect(await exists(`emulator_secrets/${tieBreakSeedRef}`)).toBe(false);
    expect((await testing.call('GET', `/v1/public/elections/${seeded.electionId}/results`)).status).toBe(404);

    const types = await ledgerTypes(testing, seeded.electionId);
    expect(types.slice(-3)).toEqual(['results.certified', 'election.pool_key_destroyed', 'election.deleted']);
    const deleted = (await api.firebase.db.collection('audit_events').where('type', '==', 'election.deleted').get()).docs[0]!.data();
    expect(deleted.payload).toEqual({ electionId: seeded.electionId, title: 'Officers', reason: 'demo over', rehearsal: true, ballotsCast: 2 });
    expect((await worker.tick()).status).toBe(200);
    expect((await testing.call('GET', '/v1/admin/audit/verify', auditor)).body).toMatchObject({ ok: true });
  });

  it('keeps a rehearsal whose certification seated someone in an office', async () => {
    expect((await testing.call('POST', '/v1/admin/positions', ea, { positionId: 'chair', title: 'Chair', seats: 1, termMonths: 24, reason: 'test' })).status).toBe(201);
    const seeded = await certifiedRehearsal({ chairPositionId: 'chair' });
    expect((await worker.tick()).body).toMatchObject({ poolKeysDestroyed: 1 });
    expect((await testing.call('GET', admin(seeded.electionId), ea)).body).toMatchObject({ officeTerms: 1 });
    expect(await removeRehearsal(seeded.electionId)).toMatchObject({ status: 409, body: { detail: 'its certification started a term of office, so it stays on record' } });
    expect(await exists(`elections/${seeded.electionId}`)).toBe(true);
  });
});
