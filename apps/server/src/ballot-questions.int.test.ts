import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

/** The ballot builder's writes (design §6.5): a question saved whole, and the order of the questions. */

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;
let ea: Member;
let ea2: Member;
let auditor: Member;
let ada: Member;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' };

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  ea = await api.member('election.admin@example.test');
  ea2 = await api.member('election.admin2@example.test');
  auditor = await api.member('auditor@example.test');
  ada = await api.member('ada@example.test');
  await api.grant(ea.accountId, 'election_admin', sa1);
  await api.grant(ea2.accountId, 'election_admin', sa1);
  await api.grant(auditor.accountId, 'auditor', sa1);
  await member(ada, 'Ada Brooks');
});

async function member(user: Member, legalName: string, status = 'active') {
  await api.firebase.db.collection('members').doc(user.accountId).set({ accountId: user.accountId, status, legalName, preferredName: null, state: 'CA' });
}

async function draft(): Promise<string> {
  const res = await api.call('POST', '/v1/admin/elections', ea, { title: 'Ballot', secrecy: 'secret', opensAt: inDays(10), closesAt: inDays(17) });
  expect(res.status).toBe(201);
  return `/v1/admin/elections/${res.body.electionId}`;
}

const chooseOne = (title: string, candidates: object[] = [], more: object = {}) => ({
  contest: { kind: 'choose_n', title, seats: 1, maxSelections: 1 },
  candidates,
  ...more,
});
const save = (url: string, contestId: string, body: object, by: User = ea) => api.call('PUT', `${url}/questions/${contestId}`, by, body);
const detail = async (url: string) => (await api.call('GET', url, ea)).body;
const titles = async (url: string) =>
  ((await detail(url)).contests as { order: number; title: string }[]).sort((a, b) => a.order - b.order).map((c) => c.title);

describe('saving a question whole', () => {
  it('creates a question under the ID the builder gave it, with its options in order', async () => {
    const url = await draft();
    const res = await save(url, 'chair', chooseOne('Chair', [
      { candidateId: 'c1', name: 'Alex' },
      { candidateId: 'c2', name: 'Blair', statement: 'For transparency.' },
    ]));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      contest: { contestId: 'chair', order: 1, title: 'Chair', spec: { kind: 'choose_n', id: 'chair', candidates: ['c1', 'c2'] } },
      candidates: [
        { candidateId: 'c1', contestId: 'chair', name: 'Alex', statement: null, accountId: null },
        { candidateId: 'c2', contestId: 'chair', name: 'Blair', statement: 'For transparency.', accountId: null },
      ],
    });
    const d = await detail(url);
    expect(d.problems).toEqual([]);
    expect(d.candidates.map((k: { name: string }) => k.name).sort()).toEqual(['Alex', 'Blair']);
  });

  it('renames, adds, reorders and removes options in one save', async () => {
    const url = await draft();
    await save(url, 'chair', chooseOne('Chair', [
      { candidateId: 'c1', name: 'Alex' },
      { candidateId: 'c2', name: 'Blair' },
      { candidateId: 'c3', name: 'Casey' },
    ]));
    const res = await save(url, 'chair', {
      contest: { kind: 'irv', title: 'Chair (ranked)', description: 'One seat.' },
      candidates: [
        { candidateId: 'c3', name: 'Casey' },
        { candidateId: 'c4', name: 'Dana' },
        { candidateId: 'c1', name: 'Alex Moore' },
      ],
    });
    expect(res.body.contest).toMatchObject({ title: 'Chair (ranked)', description: 'One seat.', spec: { kind: 'irv', candidates: ['c3', 'c4', 'c1'] } });
    const d = await detail(url);
    expect(d.candidates.map((k: { candidateId: string; name: string }) => `${k.candidateId}:${k.name}`).sort()).toEqual([
      'c1:Alex Moore',
      'c3:Casey',
      'c4:Dana',
    ]);
    expect(d.problems).toEqual([]);
  });

  it('saves a yes / no question before its text is chosen, listing the text among the problems', async () => {
    const url = await draft();
    const body = { contest: { kind: 'proposal', title: 'Plank 12', proposalSnapshotId: null, passRule: MAJORITY } };
    expect((await save(url, 'plank', body)).status).toBe(200);
    expect((await detail(url)).problems).toEqual(['“Plank 12”: attach the proposal text being voted on']);

    const text = (await api.call('POST', '/v1/admin/proposals', ea, { title: 'Plank 12', body: 'Adopt plank 12.' })).body;
    const attached = await save(url, 'plank', { contest: { ...body.contest, proposalSnapshotId: text.snapshotId } });
    expect(attached.body.contest.proposalSnapshotId).toBe(text.snapshotId);
    expect((await detail(url)).problems).toEqual([]);
    expect((await save(url, 'plank', { contest: { ...body.contest, proposalSnapshotId: 'nope' } })).status).toBe(400);
  });

  it('turns a candidate question into a yes / no one, deleting its options', async () => {
    const url = await draft();
    await save(url, 'q', chooseOne('Q', [{ candidateId: 'c1', name: 'Alex' }]));
    await save(url, 'q', { contest: { kind: 'proposal', title: 'Q', proposalSnapshotId: null, passRule: MAJORITY } });
    expect((await detail(url)).candidates).toEqual([]);
  });

  it('places a new question at a position, and keeps an existing one where it is', async () => {
    const url = await draft();
    await save(url, 'a', chooseOne('A'));
    await save(url, 'c', chooseOne('C'));
    await save(url, 'b', chooseOne('B', [], { position: 2 }));
    expect(await titles(url)).toEqual(['A', 'B', 'C']);
    await save(url, 'a', chooseOne('A again', [], { position: 3 }));
    expect(await titles(url)).toEqual(['A again', 'B', 'C']);
  });

  it('restores a deleted question exactly: undoing a delete gives back the same definition hash', async () => {
    const url = await draft();
    await save(url, 'a', chooseOne('A', [{ candidateId: 'a1', name: 'Alex' }]));
    const question = chooseOne('B', [{ candidateId: 'b1', name: 'Blair' }, { candidateId: 'b2', name: 'Casey' }]);
    await save(url, 'b', question);
    await save(url, 'c', chooseOne('C', [{ candidateId: 'c1', name: 'Dana' }]));
    const before = await detail(url);

    expect((await api.call('DELETE', `${url}/contests/b`, ea)).status).toBe(204);
    expect(await titles(url)).toEqual(['A', 'C']);
    expect((await save(url, 'b', { ...question, position: 2 })).status).toBe(200);

    const after = await detail(url);
    expect(await titles(url)).toEqual(['A', 'B', 'C']);
    expect(after.definitionHash).toBe(before.definitionHash);
  });

  it('refuses an option that belongs to another question, and bad IDs', async () => {
    const url = await draft();
    await save(url, 'a', chooseOne('A', [{ candidateId: 'k1', name: 'Alex' }]));
    const stolen = await save(url, 'b', chooseOne('B', [{ candidateId: 'k1', name: 'Alex' }]));
    expect(stolen).toMatchObject({ status: 409, body: { detail: 'option k1 belongs to another question' } });
    expect((await save(url, 'bad id!', chooseOne('B'))).status).toBe(400);
    expect((await save(url, 'b', chooseOne('B', [{ candidateId: 'k 2', name: 'X' }]))).status).toBe(400);
    expect((await save(url, 'b', { contest: { kind: 'proposal', title: 'P', proposalSnapshotId: null, passRule: MAJORITY }, candidates: [{ candidateId: 'x', name: 'X' }] })).status).toBe(400);
    expect((await save(url, 'b', chooseOne(' '))).body.errors).toEqual([{ path: 'contest.title', message: 'enter a title' }]);
  });

  it('links Active members only, never the admin, and checks a link only when it is new', async () => {
    const url = await draft();
    const linked = await save(url, 'q', chooseOne('Q', [{ candidateId: 'k1', name: 'Ada Brooks', accountId: ada.accountId }]));
    expect(linked.body.candidates[0].accountId).toBe(ada.accountId);

    // Ada lapses after being linked; saving the question again keeps her linked (§6.5).
    await member(ada, 'Ada Brooks', 'lapsed');
    const again = await save(url, 'q', chooseOne('Q, renamed', [{ candidateId: 'k1', name: 'Ada Brooks', accountId: ada.accountId }]));
    expect(again.status).toBe(200);
    // A new link to a lapsed member is refused.
    const fresh = await save(url, 'r', chooseOne('R', [{ candidateId: 'k2', name: 'Ada Brooks', accountId: ada.accountId }]));
    expect(fresh).toMatchObject({ status: 400, body: { detail: `account ${ada.accountId} is not an Active member` } });

    const self = await save(url, 'r', chooseOne('R', [{ candidateId: 'k3', name: 'Me', accountId: ea.accountId }]));
    expect(self.status).toBe(403);
    const twice = await save(url, 'r', chooseOne('R', [
      { candidateId: 'k4', name: 'Ada', accountId: ada.accountId },
      { candidateId: 'k5', name: 'Ada B.', accountId: ada.accountId },
    ]));
    expect(twice.status).toBe(400);
  });

  it('checks the office a question fills', async () => {
    const url = await draft();
    expect((await save(url, 'q', { contest: { kind: 'irv', title: 'Chair', positionId: 'chair' } })).status).toBe(400);
    await api.call('POST', '/v1/admin/positions', ea, { positionId: 'chair', title: 'Chair', seats: 1, termMonths: 24, reason: 'bylaws art. 4' });
    expect((await save(url, 'q', { contest: { kind: 'irv', title: 'Chair', positionId: 'chair' } })).body.contest.positionId).toBe('chair');
  });

  it('is for Election Admins on drafts they do not stand in', async () => {
    const url = await draft();
    await member(ea, 'Election Admin');
    expect((await save(url, 'q', chooseOne('Q'), auditor)).status).toBe(403);
    expect((await save(url, 'q', chooseOne('Q', [{ candidateId: 'k1', name: 'EA', accountId: ea.accountId }]), ea2)).status).toBe(200);
    expect((await save(url, 'q', chooseOne('Q'))).body.detail).toMatch(/you are a candidate/);

    const other = await draft2();
    await api.firebase.db.collection('elections').doc(other.split('/').pop()!).update({ state: 'scheduled' });
    expect((await save(other, 'q', chooseOne('Q'), ea2)).status).toBe(409);
  });

  async function draft2() {
    const res = await api.call('POST', '/v1/admin/elections', ea2, { title: 'Other', secrecy: 'secret', opensAt: inDays(10), closesAt: inDays(17) });
    return `/v1/admin/elections/${res.body.electionId}`;
  }
});

describe('the order of the questions', () => {
  it('puts the questions in the order given', async () => {
    const url = await draft();
    for (const id of ['a', 'b', 'c']) await save(url, id, chooseOne(id.toUpperCase()));
    const before = (await detail(url)).definitionHash;
    expect((await api.call('PUT', `${url}/question-order`, ea, { contestIds: ['c', 'a', 'b'] })).status).toBe(204);
    expect(await titles(url)).toEqual(['C', 'A', 'B']);
    expect((await detail(url)).definitionHash).not.toBe(before);
  });

  it('refuses a list that is not every question once', async () => {
    const url = await draft();
    for (const id of ['a', 'b']) await save(url, id, chooseOne(id.toUpperCase()));
    const stale = await api.call('PUT', `${url}/question-order`, ea, { contestIds: ['b'] });
    expect(stale).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/reload/) } });
    expect((await api.call('PUT', `${url}/question-order`, ea, { contestIds: ['b', 'a', 'x'] })).status).toBe(409);
    expect((await api.call('PUT', `${url}/question-order`, auditor, { contestIds: ['b', 'a'] })).status).toBe(403);
    expect(await titles(url)).toEqual(['A', 'B']);
  });
});
