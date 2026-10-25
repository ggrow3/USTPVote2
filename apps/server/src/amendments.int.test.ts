import { sha256Hex } from 'ustp-audit';
import { ballotViewProblems, proposalContentHash, splitLines, type AmendmentChange } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

/** Bylaws amendments in the record (design §6.6): proposals, contests, scheduling, the publish lock, the ballot. */

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let ma: Member;
let ea: Member;
let auditor: Member;
let voter: Member;

// Lines: 1 title, 2–3 Article I, 4–5 Article II, 6 the empty line after the final newline.
const text = 'USTP Bylaws\nArticle I. Name.\nThe party is the USTP.\nArticle II. Membership.\nMembership is open to all.\n';
const lines = splitLines(text);
const base = { version: '2026.1', contentHash: sha256Hex(text) };

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' };
const admin = (electionId: string) => `/v1/admin/elections/${electionId}`;
const decide = (by: User, id: string) => api.call('POST', `/v1/admin/approvals/${id}/decision`, by, { decision: 'approve', reason: 'ok' });

const replace = (line: number, now: string, against = base): { v: 1; base: typeof base; changes: AmendmentChange[] } => ({
  v: 1,
  base: against,
  changes: [{ op: 'replace', from: line, to: line, expect: [lines[line - 1]!], lines: [now] }],
});

const publish = (version: string, amends: string | null, body = text) =>
  api.call('POST', '/v1/admin/bylaws', ma, { version, title: 'USTP Bylaws', text: body, amends });

async function proposal(title: string, amendment: unknown) {
  const res = await api.call('POST', '/v1/admin/proposals', ea, { title, body: 'Reasons.', amendment });
  expect(res.status).toBe(201);
  return res.body;
}

async function election(...snapshotIds: string[]): Promise<string> {
  const created = await api.call('POST', '/v1/admin/elections', ea, { title: 'Bylaws vote', secrecy: 'secret', opensAt: inDays(10), closesAt: inDays(17) });
  for (const [i, id] of snapshotIds.entries()) {
    const contest = await api.call('POST', `${admin(created.body.electionId)}/contests`, ea, {
      kind: 'proposal',
      title: `Amendment ${i + 1}`,
      proposalSnapshotId: id,
      passRule: MAJORITY,
    });
    expect(contest.status).toBe(201);
  }
  return created.body.electionId;
}

async function approvedRoll(electionId: string) {
  const roll = await api.call('POST', `${admin(electionId)}/roll`, ea, { reason: 'roll' });
  expect((await decide(auditor, roll.body.approvalId)).body.status).toBe('executed');
}

beforeEach(async () => {
  await resetEmulators();
  const [sa1] = await api.systemAdmins();
  ma = await api.member('membership.admin@example.test');
  ea = await api.member('election.admin@example.test');
  auditor = await api.member('auditor@example.test');
  voter = await api.member('voter@example.test');
  await api.grant(ma.accountId, 'membership_admin', sa1);
  await api.grant(ea.accountId, 'election_admin', sa1);
  await api.grant(auditor.accountId, 'auditor', sa1);
  await api.firebase.db.collection('members').doc(voter.accountId).set({ accountId: voter.accountId, status: 'active', legalName: 'Vee' });
  expect((await publish('2026.1', null)).status).toBe(201);
});

describe('amendment proposals', () => {
  it('are captured against the current bylaws and hashed with the lines they change', async () => {
    const amendment = replace(5, 'Membership is open to every adult.');
    const created = await proposal('Membership', amendment);
    expect(created).toMatchObject({ amendment, contentHash: proposalContentHash('Membership', 'Reasons.', amendment) });
    expect(created.contentHash).not.toBe(proposalContentHash('Membership', 'Reasons.'));
    const plain = await proposal('Plank 12', undefined);
    expect(plain.contentHash).toBe(proposalContentHash('Plank 12', 'Reasons.'));
    expect(plain).not.toHaveProperty('amendment');
  });

  it('are refused when they do not fit the text, name no published version, or amend an older one', async () => {
    const post = (amendment: unknown) => api.call('POST', '/v1/admin/proposals', ea, { title: 'Membership', body: 'Reasons.', amendment });
    const stale = { ...replace(5, 'x'), changes: [{ op: 'replace', from: 5, to: 5, expect: ['Membership is closed.'], lines: ['x'] }] };
    expect(await post(stale)).toMatchObject({ status: 400, body: { detail: expect.stringMatching(/does not fit version 2026\.1.*line 5 no longer read as quoted/) } });
    expect(await post(replace(5, 'x', { version: '2025.9', contentHash: base.contentHash }))).toMatchObject({
      status: 400,
      body: { detail: 'there is no bylaws version 2025.9' },
    });
    expect((await publish('2026.2', '2026.1', `${text}Article III. Officers.\n`)).status).toBe(201);
    expect(await post(replace(5, 'x'))).toMatchObject({
      status: 409,
      body: { detail: 'version 2026.1 is no longer the current bylaws; write the amendment against version 2026.2' },
    });
  });
});

describe('an election with amendments', () => {
  it('refuses a contest whose amendment conflicts with another, and accepts an adjacent one', async () => {
    const first = await proposal('Membership', replace(5, 'Membership is open to every adult.'));
    const clash = await proposal('Membership again', replace(5, 'Membership is by invitation.'));
    const adjacent = await proposal('Article II', replace(4, 'Article II. Members.'));
    const electionId = await election(first.snapshotId);
    const add = (snapshotId: string) =>
      api.call('POST', `${admin(electionId)}/contests`, ea, { kind: 'proposal', title: 'Another', proposalSnapshotId: snapshotId, passRule: MAJORITY });
    expect(await add(clash.snapshotId)).toMatchObject({ status: 409, body: { detail: '"Amendment 1" and "Another" change the same lines' } });
    expect((await add(adjacent.snapshotId)).status).toBe(201);
    expect((await api.call('GET', admin(electionId), ea)).body.problems).toEqual([]);
  });

  it('names its base when scheduled, gives voters the lines to check, and holds the bylaws until it is cancelled', async () => {
    const amendment = replace(5, 'Membership is open to every adult.');
    const electionId = await election((await proposal('Membership', amendment)).snapshotId);
    await approvedRoll(electionId);
    const request = (await api.call('POST', `${admin(electionId)}/schedule`, ea, { reason: 'go' })).body;
    expect((await decide(auditor, request.id)).body.status).toBe('executed');

    expect((await api.call('GET', admin(electionId), ea)).body.election.amendsBylaws).toEqual(base);
    const record = (await api.call('GET', `/v1/public/elections/${electionId}`)).body;
    expect(record.definition.contests[0].proposal.amendsBylaws).toEqual(base);
    const ballot = await api.call('GET', `/v1/elections/${electionId}/ballot`, voter);
    expect(ballot.body.proposals[0].amendment).toEqual(amendment);
    expect(ballotViewProblems(ballot.body)).toEqual([]);

    const next = `${text}Article III. Officers.\n`;
    expect(await publish('2026.2', '2026.1', next)).toMatchObject({
      status: 409,
      body: { detail: 'the election "Bylaws vote" amends version 2026.1 and is scheduled; publish once it is certified or cancelled' },
    });
    const cancel = (await api.call('POST', `${admin(electionId)}/cancel`, ea, { reason: 'withdrawn' })).body;
    expect((await decide(auditor, cancel.request.id)).body.status).toBe('executed');
    expect((await publish('2026.2', '2026.1', next)).status).toBe(201);
  });

  it('cannot be scheduled once the bylaws change, even with scheduling already requested', async () => {
    const electionId = await election((await proposal('Membership', replace(5, 'Membership is open to every adult.'))).snapshotId);
    await approvedRoll(electionId);
    const request = (await api.call('POST', `${admin(electionId)}/schedule`, ea, { reason: 'go' })).body;
    // A draft does not hold the bylaws, so a new version can still be published before the Auditor decides.
    expect((await publish('2026.2', '2026.1', `${text}Article III. Officers.\n`)).status).toBe(201);
    const stale = /the proposals amend bylaws version 2026\.1, but version 2026\.2 is current/;
    expect(await decide(auditor, request.id)).toMatchObject({ status: 409, body: { detail: expect.stringMatching(stale) } });
    expect((await api.call('GET', admin(electionId), ea)).body.problems).toEqual([expect.stringMatching(stale)]);
    expect(await api.call('POST', `${admin(electionId)}/schedule`, ea, { reason: 'again' })).toMatchObject({
      status: 409,
      body: { detail: expect.stringMatching(stale) },
    });
  });
});
