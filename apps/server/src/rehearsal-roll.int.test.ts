import { verifyEcdsaP256 } from 'ustp-audit';
import { rollSigningInput, type PersonaSummary, type SigningKeyRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** Rehearsal rolls (design §6.3, §10.4): test voters only, testing mode only, and recorded as such everywhere. */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  process.env.TESTING_MODE = 'true';
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(async () => {
  await Promise.all([api.close(), worker.close()]);
  delete process.env.TESTING_MODE;
});

type Member = User & { accountId: string };
let sa1: Member;
let member: Member;
let personas: PersonaSummary[];

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' };
const as = (label: string) => ({ 'x-act-as': personas.find((p) => p.label === label)!.accountId });
const ea = () => as('Test Election Admin');
const auditor = () => as('Test Auditor');
const testVoters = () => personas.filter((p) => p.kind === 'voter').map((p) => p.accountId);

/** A draft election with one proposal contest, set up by the Test Election Admin. */
async function draft(): Promise<string> {
  const text = await api.call('POST', '/v1/admin/proposals', sa1, { title: 'Plank 12', body: 'Adopt it.' }, ea());
  const created = await api.call('POST', '/v1/admin/elections', sa1, { title: 'Rehearsal', secrecy: 'secret', opensAt: inDays(1), closesAt: inDays(2) }, ea());
  const contest = await api.call(
    'POST',
    `/v1/admin/elections/${created.body.electionId}/contests`,
    sa1,
    { kind: 'proposal', title: 'Plank 12', proposalSnapshotId: text.body.snapshotId, passRule: MAJORITY },
    ea(),
  );
  expect(contest.status).toBe(201);
  return created.body.electionId;
}

const decide = (approvalId: string, headers = auditor(), on = api) =>
  on.call('POST', `/v1/admin/approvals/${approvalId}/decision`, sa1, { decision: 'approve', reason: 'ok' }, headers);
const ledger = async (type: string) =>
  (await api.firebase.db.collection('audit_events').where('type', '==', type).get()).docs.map((d) => d.data());

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  const admins = (await api.call('POST', '/v1/testing/personas', sa1, {})).body as PersonaSummary[];
  personas = admins;
  const bylaws = { version: '2026.1', title: 'USTP Bylaws', text: 'Article I. Name.\n' };
  expect((await api.call('POST', '/v1/admin/bylaws', sa1, bylaws, as('Test Membership Admin'))).status).toBe(201);
  personas = (await api.call('POST', '/v1/testing/personas', sa1, { voters: 3 })).body;
  // A real Active member, who a rehearsal roll must leave out.
  member = await api.member('member@example.test');
  await api.firebase.db.collection('members').doc(member.accountId).set({ accountId: member.accountId, status: 'active', legalName: 'Mem' });
});

describe('a rehearsal roll', () => {
  it('holds only the test voters and says so in the request, the ledger, the record and the signature', async () => {
    const electionId = await draft();
    const url = `/v1/admin/elections/${electionId}`;
    const roll = await api.call('POST', `${url}/roll`, sa1, { reason: 'rehearsal', voters: 'test_voters' }, ea());
    expect(roll.body).toMatchObject({ count: 3, criteria: { status: 'active', testVotersOnly: true } });
    const view = (await api.call('GET', `${url}/roll`, sa1, undefined, auditor())).body;
    expect(view.entries.map((e: { accountId: string }) => e.accountId).sort()).toEqual(testVoters().sort());

    const pending = (await api.call('GET', '/v1/admin/approvals?status=pending', sa1, undefined, auditor())).body;
    expect(pending[0].payload.criteria).toEqual({ status: 'active', testVotersOnly: true });
    expect((await decide(roll.body.approvalId)).body.status).toBe('executed');
    expect((await ledger('roll.approved'))[0]!.payload.criteria).toEqual({ status: 'active', testVotersOnly: true });

    const schedule = await api.call('POST', `${url}/schedule`, sa1, { reason: 'go' }, ea());
    expect((await decide(schedule.body.id)).body.status).toBe('executed');
    await worker.tick();
    const record = (await api.call('GET', `/v1/public/elections/${electionId}`)).body;
    expect(record.roll).toMatchObject({ criteria: { status: 'active', testVotersOnly: true }, count: 3, signature: expect.any(Object) });
    const keys = (await api.call('GET', '/v1/public/ledger/keys')).body as SigningKeyRecord[];
    const key = keys.find((k) => k.keyVersion === record.roll.signature.keyVersion)!;
    const statement = {
      electionId,
      snapshotId: record.roll.snapshotId,
      criteria: record.roll.criteria,
      asOf: record.roll.asOf,
      count: 3,
      merkleRoot: record.roll.merkleRoot,
      approvalId: roll.body.approvalId,
    };
    expect(await verifyEcdsaP256(key.publicKeyPem, rollSigningInput(statement), record.roll.signature.signature)).toBe(true);
    const asMembers = { ...statement, criteria: { status: 'active' as const } };
    expect(await verifyEcdsaP256(key.publicKeyPem, rollSigningInput(asMembers), record.roll.signature.signature)).toBe(false);
  });

  it('stops waiting for a decision once its request expires, and can be requested again', async () => {
    const electionId = await draft();
    const url = `/v1/admin/elections/${electionId}`;
    const roll = await api.call('POST', `${url}/roll`, sa1, { reason: 'Test', voters: 'test_voters' }, ea());
    const waiting = async () => ({
      list: ((await api.call('GET', '/v1/admin/approvals?status=pending', sa1, undefined, auditor())).body as { id: string }[]).map((r) => r.id),
      election: ((await api.call('GET', url, sa1, undefined, ea())).body.pending as { id: string }[]).map((r) => r.id),
    });
    expect(await waiting()).toEqual({ list: [roll.body.approvalId], election: [roll.body.approvalId] });
    expect((await api.call('POST', `${url}/roll`, sa1, { reason: 'again', voters: 'test_voters' }, ea())).status).toBe(409);

    // Thirteen days on: six days past the request's expiry.
    const ref = api.firebase.db.collection('approval_requests').doc(roll.body.approvalId);
    await ref.update({ requestedAt: inDays(-13), expiresAt: inDays(-6) });
    expect(await waiting()).toEqual({ list: [], election: [] });
    expect(await decide(roll.body.approvalId)).toMatchObject({ status: 403, body: { detail: 'request has expired' } });

    const again = await api.call('POST', `${url}/roll`, sa1, { reason: 'again', voters: 'test_voters' }, ea());
    expect(again.status).toBe(201);
    expect(await waiting()).toEqual({ list: [again.body.approvalId], election: [again.body.approvalId] });
    expect((await decide(again.body.approvalId)).body.status).toBe('executed');
    expect((await api.call('GET', url, sa1, undefined, ea())).body.roll).toMatchObject({ snapshotId: again.body.snapshotId, status: 'approved' });
  });

  it('leaves an ordinary roll exactly as it was: every Active member, no criteria in the approval', async () => {
    const electionId = await draft();
    const roll = await api.call('POST', `/v1/admin/elections/${electionId}/roll`, sa1, { reason: 'real' }, ea());
    expect(roll.body).toMatchObject({ count: 4, criteria: { status: 'active' } });
    expect(roll.body.criteria).not.toHaveProperty('testVotersOnly');
    expect((await decide(roll.body.approvalId)).body.status).toBe('executed');
    expect((await ledger('roll.approved'))[0]!.payload).not.toHaveProperty('criteria');
  });

  it('is refused without test voters', async () => {
    const electionId = await draft();
    await Promise.all(testVoters().map((id) => api.firebase.db.collection('members').doc(id).update({ status: 'lapsed' })));
    const roll = await api.call('POST', `/v1/admin/elections/${electionId}/roll`, sa1, { reason: 'rehearsal', voters: 'test_voters' }, ea());
    expect(roll).toMatchObject({ status: 409, body: { detail: 'there are no Active test voters; add them under Admin → Testing' } });
  });
});

describe('with testing mode off', () => {
  let off: TestApi;
  let ea2: Member;
  let auditor2: Member;
  beforeAll(async () => {
    delete process.env.TESTING_MODE;
    off = await TestApi.start();
  });
  afterAll(async () => {
    await off.close();
    process.env.TESTING_MODE = 'true';
  });
  beforeEach(async () => {
    // Real admins, since nobody can act as a persona where testing mode is off.
    ea2 = await api.member('ea@example.test');
    auditor2 = await api.member('auditor@example.test');
    await api.grant(ea2.accountId, 'election_admin', sa1);
    await api.grant(auditor2.accountId, 'auditor', sa1);
  });

  it('refuses to request, approve or schedule on a rehearsal roll', async () => {
    const electionId = await draft();
    const url = `/v1/admin/elections/${electionId}`;
    expect(await off.call('POST', `${url}/roll`, ea2, { reason: 'rehearsal', voters: 'test_voters' })).toMatchObject({
      status: 403,
      body: { detail: 'a rehearsal roll needs testing mode, which is off on this deployment' },
    });

    // Requested where testing mode is on, then decided where it is off.
    const roll = await api.call('POST', `${url}/roll`, ea2, { reason: 'rehearsal', voters: 'test_voters' });
    const refused = await off.call('POST', `/v1/admin/approvals/${roll.body.approvalId}/decision`, auditor2, { decision: 'approve', reason: 'ok' });
    expect(refused).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/rehearsal roll of test voters only, and testing mode is off/) } });

    // Approved where testing mode is on; scheduling is then decided where it is off.
    expect((await api.call('POST', `/v1/admin/approvals/${roll.body.approvalId}/decision`, auditor2, { decision: 'approve', reason: 'ok' })).body.status).toBe(
      'executed',
    );
    const schedule = await api.call('POST', `${url}/schedule`, ea2, { reason: 'go' });
    const notScheduled = await off.call('POST', `/v1/admin/approvals/${schedule.body.id}/decision`, auditor2, { decision: 'approve', reason: 'ok' });
    expect(notScheduled).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/testing mode is off/) } });
  });
});
