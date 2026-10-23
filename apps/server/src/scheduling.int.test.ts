import { createHash } from 'node:crypto';
import { rollMerkleRoot, sortRoll } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let ea: Member;
let ea2: Member;
let auditor: Member;
let voters: Member[];

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' };

/** Marks an account Active directly (the membership flow itself is covered elsewhere). */
async function makeActive(m: Member) {
  await api.firebase.db.collection('members').doc(m.accountId).set({
    accountId: m.accountId,
    status: 'active',
    legalName: m.email,
    preferredName: null,
    state: 'CA',
    bylawsVersion: '2026.1',
    memberSince: new Date().toISOString(),
    statusChangedAt: new Date().toISOString(),
  });
}

async function readyElection(): Promise<string> {
  const { electionId } = (
    await api.call('POST', '/v1/admin/elections', ea, { title: 'Officers', secrecy: 'secret', opensAt: inDays(10), closesAt: inDays(17) })
  ).body;
  const url = `/v1/admin/elections/${electionId}`;
  const text = (await api.call('POST', '/v1/admin/proposals', ea, { title: 'Plank', body: 'Adopt it.' })).body;
  await api.call('POST', `${url}/contests`, ea, { kind: 'proposal', title: 'Plank', proposalSnapshotId: text.snapshotId, passRule: MAJORITY });
  const chair = (await api.call('POST', `${url}/contests`, ea, { kind: 'irv', title: 'Chair' })).body;
  await api.call('POST', `${url}/contests/${chair.contestId}/candidates`, ea, { name: 'Alex' });
  await api.call('POST', `${url}/contests/${chair.contestId}/candidates`, ea, { name: 'Blair' });
  expect((await api.call('GET', url, ea)).body.problems).toEqual([]);
  return electionId;
}

const decide = (by: User, id: string, decision: 'approve' | 'reject') =>
  api.call('POST', `/v1/admin/approvals/${id}/decision`, by, { decision, reason: 'reviewed' });

async function approvedRoll(electionId: string) {
  const roll = await api.call('POST', `/v1/admin/elections/${electionId}/roll`, ea, { reason: 'roll for 2026' });
  expect(roll.status).toBe(201);
  expect((await decide(auditor, roll.body.approvalId, 'approve')).body.status).toBe('executed');
  return roll.body;
}

async function ledger(type: string) {
  const snap = await api.firebase.db.collection('audit_events').where('type', '==', type).get();
  return snap.docs.map((d) => d.data());
}

beforeEach(async () => {
  await resetEmulators();
  const [sa1, sa2] = await api.systemAdmins();
  ea = await api.member('election.admin@example.test');
  ea2 = await api.member('election.admin2@example.test');
  auditor = await api.member('auditor@example.test');
  await api.grant(ea.accountId, 'election_admin', sa1);
  await api.grant(ea2.accountId, 'election_admin', sa1);
  await api.grant(auditor.accountId, 'auditor', sa1);
  voters = [await api.member('v1@example.test'), await api.member('v2@example.test'), await api.member('v3@example.test')];
  for (const v of voters) await makeActive(v);
});

describe('voter roll', () => {
  it('snapshots the Active members and takes effect only when an Auditor approves', async () => {
    const electionId = await readyElection();
    const url = `/v1/admin/elections/${electionId}`;
    const roll = (await api.call('POST', `${url}/roll`, ea, { reason: 'roll for 2026' })).body;
    const ids = sortRoll(voters.map((v) => v.accountId));
    expect(roll).toMatchObject({ status: 'pending', count: 3, merkleRoot: rollMerkleRoot(electionId, ids) });
    expect(roll.accountIds).toBeUndefined();

    const detail = (await api.call('GET', url, auditor)).body;
    expect(detail.roll).toMatchObject({ status: 'pending', count: 3 });
    expect(detail.pending.map((r: { action: string }) => r.action)).toEqual(['roll.approve']);
    expect(detail.election.rollSnapshotId).toBeNull();

    const view = (await api.call('GET', `${url}/roll`, auditor)).body;
    expect(view.entries.map((e: { accountId: string }) => e.accountId)).toEqual(ids);
    expect(view.entries[0]).toMatchObject({ legalName: expect.stringMatching(/@example.test/), state: 'CA' });

    expect((await api.call('POST', `${url}/roll`, ea, { reason: 'again' })).status).toBe(409);
    expect((await decide(auditor, roll.approvalId, 'approve')).body.status).toBe('executed');
    const after = (await api.call('GET', url, ea)).body;
    expect(after.election.rollSnapshotId).toBe(roll.snapshotId);
    expect(after.roll.status).toBe('approved');
    expect(await ledger('roll.approved')).toEqual([
      expect.objectContaining({ subject: electionId, payload: expect.objectContaining({ count: 3, merkleRoot: roll.merkleRoot }) }),
    ]);
  });

  it('marks a rejected roll, and refuses an empty one', async () => {
    const electionId = await readyElection();
    const roll = (await api.call('POST', `/v1/admin/elections/${electionId}/roll`, ea, { reason: 'r' })).body;
    await decide(auditor, roll.approvalId, 'reject');
    expect((await api.call('GET', `/v1/admin/elections/${electionId}`, ea)).body.roll.status).toBe('rejected');

    await api.firebase.db.recursiveDelete(api.firebase.db.collection('members'));
    expect((await api.call('POST', `/v1/admin/elections/${electionId}/roll`, ea, { reason: 'r' })).body.detail).toMatch(
      /no Active members/,
    );
  });
});

describe('scheduling', () => {
  it('needs a ready definition and an approved roll', async () => {
    const { electionId } = (
      await api.call('POST', '/v1/admin/elections', ea, { title: 'Empty', secrecy: 'open', opensAt: inDays(5), closesAt: inDays(6) })
    ).body;
    expect((await api.call('POST', `/v1/admin/elections/${electionId}/schedule`, ea, { reason: 'go' })).body.detail).toMatch(
      /not ready to schedule: add at least one contest/,
    );
    const ready = await readyElection();
    expect((await api.call('POST', `/v1/admin/elections/${ready}/schedule`, ea, { reason: 'go' })).body.detail).toMatch(
      /voter roll approved first/,
    );
  });

  it('freezes exactly the requested definition and commits to a secret tie-break seed', async () => {
    const electionId = await readyElection();
    const url = `/v1/admin/elections/${electionId}`;
    await approvedRoll(electionId);

    // An edit after the request invalidates it: the Auditor cannot approve something they have not seen.
    const stale = (await api.call('POST', `${url}/schedule`, ea, { reason: 'ready' })).body;
    await api.call('PATCH', url, ea2, { description: 'edited after the request' });
    const refused = await decide(auditor, stale.id, 'approve');
    expect(refused).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/changed after scheduling was requested/) } });
    await decide(auditor, stale.id, 'reject');

    const request = (await api.call('POST', `${url}/schedule`, ea, { reason: 'ready now' })).body;
    const before = (await api.call('GET', url, auditor)).body;
    expect(request.payload.definitionHash).toBe(before.definitionHash);
    expect((await decide(auditor, request.id, 'approve')).body.status).toBe('executed');

    const { election } = (await api.call('GET', url, ea)).body;
    expect(election).toMatchObject({ state: 'scheduled', definitionHash: before.definitionHash, scheduledAt: expect.any(String) });
    const seed = (await api.firebase.db.collection('emulator_secrets').doc(election.tieBreakSeedRef).get()).data()!.value;
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(election.tieBreakSeedCommitment).toBe(createHash('sha256').update(Buffer.from(seed, 'hex')).digest('hex'));
    expect(JSON.stringify((await api.call('GET', url, auditor)).body)).not.toContain(seed);
    expect(await ledger('election.scheduled')).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ definitionHash: before.definitionHash, tieBreakSeedCommitment: election.tieBreakSeedCommitment }),
      }),
    ]);

    // Frozen: no more edits, no new roll.
    expect((await api.call('PATCH', url, ea, { title: 'late' })).status).toBe(409);
    expect((await api.call('POST', `${url}/roll`, ea, { reason: 'late' })).status).toBe(409);
  });
});

describe('cancelling', () => {
  it('cancels a draft at once, and a scheduled election only with an Auditor', async () => {
    const draft = await readyElection();
    expect((await api.call('POST', `/v1/admin/elections/${draft}/cancel`, ea, { reason: 'duplicate' })).body).toEqual({
      cancelled: true,
      request: null,
    });
    expect((await api.call('GET', `/v1/admin/elections/${draft}`, ea)).body.election.state).toBe('cancelled');

    const electionId = await readyElection();
    await approvedRoll(electionId);
    const schedule = (await api.call('POST', `/v1/admin/elections/${electionId}/schedule`, ea, { reason: 'go' })).body;
    await decide(auditor, schedule.id, 'approve');
    const cancel = (await api.call('POST', `/v1/admin/elections/${electionId}/cancel`, ea, { reason: 'bylaws dispute' })).body;
    expect(cancel).toMatchObject({ cancelled: false, request: { action: 'election.cancel', payload: { fromState: 'scheduled' } } });
    expect((await api.call('GET', `/v1/admin/elections/${electionId}`, ea)).body.election.state).toBe('scheduled');
    await decide(auditor, cancel.request.id, 'approve');
    expect((await api.call('GET', `/v1/admin/elections/${electionId}`, ea)).body.election.state).toBe('cancelled');
    expect((await ledger('election.cancelled')).map((e) => e.payload.fromState).sort()).toEqual(['draft', 'scheduled']);
  });
});

describe('recusal', () => {
  it('keeps an Auditor who is a candidate from deciding on that election', async () => {
    const electionId = await readyElection();
    const url = `/v1/admin/elections/${electionId}`;
    const chair = (await api.call('GET', url, ea)).body.contests[1];
    await api.call('POST', `${url}/contests/${chair.contestId}/candidates`, ea, { name: 'Auditor', accountId: auditor.accountId });
    const roll = (await api.call('POST', `${url}/roll`, ea, { reason: 'r' })).body;
    const res = await decide(auditor, roll.approvalId, 'approve');
    expect(res).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/candidate in this election/) } });
  });
});
