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
let member: Member;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' };

beforeEach(async () => {
  await resetEmulators();
  const [sa1, sa2] = await api.systemAdmins();
  ea = await api.member('election.admin@example.test');
  ea2 = await api.member('election.admin2@example.test');
  auditor = await api.member('auditor@example.test');
  member = await api.member('member@example.test');
  await api.grant(ea.accountId, 'election_admin', sa1, sa2);
  await api.grant(ea2.accountId, 'election_admin', sa1, sa2);
  await api.grant(auditor.accountId, 'auditor', sa1, sa2);
});

async function draft(overrides: Record<string, unknown> = {}) {
  const res = await api.call('POST', '/v1/admin/elections', ea, {
    title: '2026 Officer Election',
    secrecy: 'secret',
    opensAt: inDays(10),
    closesAt: inDays(17),
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body;
}

describe('access', () => {
  it('lets Election Admins edit, Auditors read, and nobody else in', async () => {
    const election = await draft();
    expect((await api.call('GET', '/v1/admin/elections', member)).status).toBe(403);
    expect((await api.call('GET', `/v1/admin/elections/${election.electionId}`, auditor)).status).toBe(200);
    expect((await api.call('PATCH', `/v1/admin/elections/${election.electionId}`, auditor, { title: 'x' })).status).toBe(403);
    expect((await api.call('POST', '/v1/admin/proposals', auditor, { title: 't', body: 'b' })).status).toBe(403);
  });
});

describe('building an election', () => {
  it('assembles proposal and candidate contests into a schedulable definition', async () => {
    const election = await draft();
    const url = `/v1/admin/elections/${election.electionId}`;
    expect((await api.call('GET', url, ea)).body).toMatchObject({
      election: { state: 'draft', kAnonymity: 10 },
      problems: ['add at least one contest'],
    });

    const proposal = (await api.call('POST', '/v1/admin/proposals', ea, { title: 'Plank 12', body: 'Adopt plank 12.' })).body;
    expect(proposal.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const plank = await api.call('POST', `${url}/contests`, ea, {
      kind: 'proposal',
      title: 'Plank 12',
      proposalSnapshotId: proposal.snapshotId,
      passRule: MAJORITY,
    });
    expect(plank.body).toMatchObject({ order: 1, spec: { kind: 'proposal', id: plank.body.contestId } });

    const chair = (await api.call('POST', `${url}/contests`, ea, { kind: 'irv', title: 'Chair' })).body;
    expect((await api.call('GET', url, ea)).body.problems).toEqual(['“Chair”: add candidates']);

    const alex = (await api.call('POST', `${url}/contests/${chair.contestId}/candidates`, ea, { name: 'Alex' })).body;
    const before = (await api.call('GET', url, ea)).body.definitionHash;
    const blair = (await api.call('POST', `${url}/contests/${chair.contestId}/candidates`, ea, { name: 'Blair' })).body;

    const detail = (await api.call('GET', url, ea)).body;
    expect(detail.problems).toEqual([]);
    expect(detail.definitionHash).not.toBe(before);
    expect(detail.contests.map((c: { title: string }) => c.title)).toEqual(['Plank 12', 'Chair']);
    expect(detail.contests[1].spec.candidates).toEqual([alex.candidateId, blair.candidateId]);
    expect(detail.proposals.map((p: { snapshotId: string }) => p.snapshotId)).toEqual([proposal.snapshotId]);
  });

  it('keeps the candidate list in step when candidates and contests are removed', async () => {
    const { electionId } = await draft();
    const url = `/v1/admin/elections/${electionId}`;
    const board = (await api.call('POST', `${url}/contests`, ea, { kind: 'choose_n', title: 'Board', seats: 2, maxSelections: 2 })).body;
    const ids = [];
    for (const name of ['A', 'B', 'C']) {
      ids.push((await api.call('POST', `${url}/contests/${board.contestId}/candidates`, ea, { name })).body.candidateId);
    }
    expect((await api.call('DELETE', `${url}/contests/${board.contestId}/candidates/${ids[1]}`, ea)).status).toBe(204);
    expect((await api.call('GET', url, ea)).body.contests[0].spec.candidates).toEqual([ids[0], ids[2]]);

    expect((await api.call('DELETE', `${url}/contests/${board.contestId}`, ea)).status).toBe(204);
    const after = (await api.call('GET', url, ea)).body;
    expect(after.contests).toEqual([]);
    expect(after.candidates).toEqual([]);
  });

  it('reports rule problems and refuses impossible input', async () => {
    const { electionId } = await draft();
    const url = `/v1/admin/elections/${electionId}`;
    expect((await api.call('PATCH', url, ea, { closesAt: inDays(1) })).status).toBe(400);
    expect(
      (await api.call('POST', `${url}/contests`, ea, { kind: 'proposal', title: 'P', proposalSnapshotId: 'nope', passRule: MAJORITY }))
        .status,
    ).toBe(400);

    const board = (await api.call('POST', `${url}/contests`, ea, { kind: 'choose_n', title: 'Board', seats: 3, maxSelections: 3 })).body;
    await api.call('POST', `${url}/contests/${board.contestId}/candidates`, ea, { name: 'A' });
    await api.call('POST', `${url}/contests/${board.contestId}/candidates`, ea, { name: 'B' });
    expect((await api.call('GET', url, ea)).body.problems).toEqual([
      '“Board”: seats must be an integer in 1..2',
      '“Board”: maxSelections must be an integer in 1..2',
    ]);
  });
});

describe('integrity of the draft', () => {
  it('keeps an Election Admin who is a candidate out of that election', async () => {
    const { electionId } = await draft();
    const url = `/v1/admin/elections/${electionId}`;
    const chair = (await api.call('POST', `${url}/contests`, ea, { kind: 'irv', title: 'Chair' })).body;

    const self = await api.call('POST', `${url}/contests/${chair.contestId}/candidates`, ea, { name: 'Me', accountId: ea.accountId });
    expect(self.status).toBe(403);

    // Another Election Admin adds them; from then on they cannot edit this election.
    const added = await api.call('POST', `${url}/contests/${chair.contestId}/candidates`, ea2, { name: 'EA', accountId: ea.accountId });
    expect(added.status).toBe(201);
    const blocked = await api.call('PATCH', url, ea, { title: 'Renamed' });
    expect(blocked).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/you are a candidate/) } });
    expect((await api.call('PATCH', url, ea2, { title: 'Renamed' })).status).toBe(200);
  });

  it('allows edits only while the election is a draft', async () => {
    const { electionId } = await draft();
    await api.firebase.db.collection('elections').doc(electionId).update({ state: 'scheduled' });
    const res = await api.call('PATCH', `/v1/admin/elections/${electionId}`, ea, { title: 'Late change' });
    expect(res).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/only drafts can be edited/) } });
  });
});
