import {
  Collections,
  MAX_CONSISTENCY_CHECKS_PER_DAY,
  consistencyCheckId,
  type ConsistencyCheckRecord,
  type ConsistencyCheckResult,
} from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReferenceLibrary } from './bylaws-check/references.js';
import { ClaudeConsistencyChecker } from './consistency-check/claude-consistency-checker.js';
import { ConsistencyCheckRunner } from './consistency-check/consistency-check-runner.js';
import { seedElection, seededBallot, type SeededElection } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';
import { fakeAnthropic, type CapturedRequest } from './testing/fake-anthropic.js';

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Account = User & { accountId: string };
let sa1: Account;
let ea: Account;
let auditor: Account;
let voter: Account;
let voter2: Account;
let outsider: Account;

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  [ea, auditor, voter, voter2, outsider] = await Promise.all([
    api.member('ea@example.test'),
    api.member('auditor@example.test'),
    api.member('voter@example.test'),
    api.member('voter2@example.test'),
    api.member('outsider@example.test'),
  ]);
  await api.grant(ea.accountId, 'election_admin', sa1);
  await api.grant(auditor.accountId, 'auditor', sa1);
});

const ballotRoute = (e: SeededElection) => `${e.url}/consistency-check`;
const editorRoute = (e: SeededElection) => `/v1/admin/elections/${e.electionId}/consistency-check`;

async function runWorker() {
  const res = await worker.app.inject({ method: 'POST', url: '/tasks/consistency-checks' });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

const stored = async (e: SeededElection, who: Account) =>
  (await api.firebase.db.collection(Collections.consistencyChecks).doc(consistencyCheckId(e.electionId, who.accountId)).get()).data() as
    | ConsistencyCheckRecord
    | undefined;

describe('the platform consistency check', () => {
  it('runs once per voter from the ballot, through the worker (the stand-in, with the emulators)', async () => {
    const election = await seedElection(api, { voters: [voter.accountId, voter2.accountId] });
    expect(await api.call('GET', ballotRoute(election), voter)).toMatchObject({ status: 200, body: { enabled: true, check: null } });

    const queued = await api.call('POST', ballotRoute(election), voter);
    expect(queued.status).toBe(202);
    const check = queued.body as ConsistencyCheckResult;
    expect(check).toMatchObject({ status: 'queued', view: 'ballot', electionTitle: 'Officers', requestedBy: voter.accountId, bylaws: null });
    expect(check.contests).toEqual([
      { position: 1, contestId: 'plank', title: 'Plank 12' },
      { position: 2, contestId: 'chair', title: 'Chair' },
    ]);
    expect(check).not.toHaveProperty('material');

    expect(await runWorker()).toEqual({ status: 200, body: { checked: 1, failed: 0 } });
    const done = (await api.call('GET', ballotRoute(election), voter)).body.check as ConsistencyCheckResult;
    expect(done).toMatchObject({ status: 'done', checker: 'stub', model: null, error: null, findings: [] });
    expect(done.summary).toMatch(/not an AI review/);
    expect(done.references.map((r) => r.id)).toEqual(['ustp-constitution', 'transhumanist-bill-of-rights']);
    expect(await runWorker()).toEqual({ status: 200, body: { checked: 0, failed: 0 } });

    // Once: the same person is refused, from the ballot or the editor, while someone else may still ask.
    expect(await api.call('POST', ballotRoute(election), voter)).toMatchObject({
      status: 409,
      body: { detail: expect.stringMatching(/already run the consistency check for this election; each person may run it once/) },
    });
    expect((await api.call('POST', ballotRoute(election), voter2)).status).toBe(202);
    expect((await api.call('GET', ballotRoute(election), voter2)).body.check.requestedBy).toBe(voter2.accountId);
  });

  it('refuses a second request while the first is queued, even two at once', async () => {
    const election = await seedElection(api, { voters: [voter.accountId] });
    const both = await Promise.all([api.call('POST', ballotRoute(election), voter), api.call('POST', ballotRoute(election), voter)]);
    expect(both.map((r) => r.status).sort()).toEqual([202, 409]);
    expect(both.find((r) => r.status === 409)!.body.detail).toMatch(/still running|already run/);
  });

  it('neither reads nor records how, or whether, the person voted', async () => {
    const election = await seedElection(api, { voters: [voter.accountId, voter2.accountId], secrecy: 'open', state: 'open' });
    const ballot = (await api.call('GET', `${election.url}/ballot`, voter)).body;
    const cast = await api.call('POST', `${election.url}/ballots`, voter, { definitionHash: ballot.definitionHash, parts: seededBallot(election.electionId) });
    expect(cast.status).toBe(201);

    await api.call('POST', ballotRoute(election), voter);
    await api.call('POST', ballotRoute(election), voter2);
    const [voted, notVoted] = [(await stored(election, voter))!, (await stored(election, voter2))!];
    expect(voted.materialHash).toBe(notVoted.materialHash);
    expect(Object.keys(voted).sort()).toEqual(Object.keys(notVoted).sort());
    expect(JSON.stringify(voted)).not.toMatch(/castAt|"yes"|commitment|salt/);
  });

  it('is for voters on the roll from the ballot, and for Election Admins and Auditors from the editor', async () => {
    const election = await seedElection(api, { voters: [voter.accountId] });
    expect((await api.call('POST', ballotRoute(election), outsider)).status).toBe(403);
    expect((await api.call('POST', editorRoute(election), voter)).status).toBe(403);
    expect((await api.call('GET', editorRoute(election), voter)).status).toBe(403);

    const draft = await seedElection(api, { voters: [voter.accountId], state: 'draft' });
    expect((await api.call('POST', ballotRoute(draft), voter)).status).toBe(404);
    const fromEditor = await api.call('POST', editorRoute(draft), ea);
    expect(fromEditor).toMatchObject({ status: 202, body: { view: 'admin', status: 'queued' } });
    expect((await api.call('POST', editorRoute(draft), auditor)).status).toBe(202);
    expect((await api.call('POST', editorRoute(draft), ea)).status).toBe(409);
    expect((await api.call('GET', editorRoute(draft), ea)).body).toMatchObject({ enabled: true, check: { view: 'admin', requestedBy: ea.accountId } });

    // A draft that only fills offices has nothing to check.
    const offices = await seedElection(api, { voters: [voter.accountId], state: 'draft' });
    await offices.ref.collection('contests').doc('plank').delete();
    await offices.ref.collection('contests').doc('chair').update({ positionId: 'chair' });
    expect(await api.call('POST', editorRoute(offices), ea)).toMatchObject({
      status: 409,
      body: { detail: expect.stringMatching(/no proposals or options to check/) },
    });
  });

  it('lets a person ask again after a check failed, and stops everyone at the daily number', async () => {
    const election = await seedElection(api, { voters: [voter.accountId, voter2.accountId] });
    expect((await api.call('POST', ballotRoute(election), voter)).status).toBe(202);
    const ref = api.firebase.db.collection(Collections.consistencyChecks).doc(consistencyCheckId(election.electionId, voter.accountId));
    await ref.update({ status: 'failed', error: 'Claude declined to review this text' });
    expect(await api.call('POST', ballotRoute(election), voter)).toMatchObject({ status: 202, body: { status: 'queued', error: null } });

    const batch = api.firebase.db.batch();
    const now = new Date().toISOString();
    for (let i = 0; i < MAX_CONSISTENCY_CHECKS_PER_DAY; i++) {
      batch.set(api.firebase.db.collection(Collections.consistencyChecks).doc(`filler-${i}`), { status: 'done', requestedAt: now });
    }
    await batch.commit();
    expect(await api.call('POST', ballotRoute(election), voter2)).toMatchObject({
      status: 429,
      body: { detail: expect.stringMatching(/consistency checks for today/) },
    });
  });

  it('with Claude (faked), sends the ballot, the party texts and the bylaws, and nothing about who asked', async () => {
    const membership = await api.member('membership.admin@example.test');
    await api.grant(membership.accountId, 'membership_admin', sa1);
    const bylaws = 'Article I. Name.\nThe name of this organization is the United States Transhumanist Party.';
    expect((await api.call('POST', '/v1/admin/bylaws', membership, { version: '2026.1', title: 'USTP Bylaws', text: bylaws })).status).toBe(201);
    const election = await seedElection(api, { voters: [voter.accountId] });
    expect((await api.call('POST', ballotRoute(election), voter)).body.bylaws).toMatchObject({ version: '2026.1' });

    const site = (async () =>
      Response.json([
        { link: 'https://transhumanist-party.org/x/', modified_gmt: '2026-09-14T07:05:22', content: { rendered: `<p>Article VI. Platform.</p><p>${'Section text. '.repeat(500)}</p>` } },
      ])) as unknown as typeof globalThis.fetch;
    const captured: CapturedRequest = {};
    const review = {
      summary: 'One possible tension.',
      findings: [
        { contests: [1], source: 'platform', provision: 'Article VI, Section XII', passage: 'supports the right to repair', severity: 'low', explanation: 'Overlaps an adopted section.' },
        { contests: [7], source: 'bylaws', provision: 'Article I', passage: '', severity: 'high', explanation: 'Names a question that was never sent.' },
      ],
    };
    const checker = new ClaudeConsistencyChecker('sk-test', 'claude-opus-5-5', new ReferenceLibrary(api.firebase.db, site), {
      fetch: fakeAnthropic(review, captured),
    });
    expect(await new ConsistencyCheckRunner(api.firebase, checker).runQueued()).toEqual({ checked: 1, failed: 0 });

    const done = (await api.call('GET', ballotRoute(election), voter)).body.check as ConsistencyCheckResult;
    expect(done).toMatchObject({ status: 'done', checker: 'claude', model: 'claude-opus-5-5', summary: 'One possible tension.' });
    expect(done.findings).toEqual([
      { contests: [1], source: 'platform', provision: 'Article VI, Section XII', passage: 'supports the right to repair', severity: 'low', explanation: 'Overlaps an adopted section.' },
    ]);
    expect(done.references.map((r) => [r.id, r.sha256?.length])).toEqual([
      ['ustp-constitution', 64],
      ['transhumanist-bill-of-rights', 64],
    ]);
    expect(done.usage).toMatchObject({ inputTokens: 40, outputTokens: 120 });

    const sent = JSON.stringify(captured.body);
    expect(sent).toContain('The party supports the right to repair.');
    expect(sent).toContain('The name of this organization is the United States Transhumanist Party.');
    expect(sent).toContain('Article VI. Platform.');
    expect(sent).toContain('[Question 2] Chair');
    for (const secret of [voter.accountId, voter.email, voter.uid]) expect(sent).not.toContain(secret);
  });

  it('fails a check the worker cannot run, which then does not count', async () => {
    const election = await seedElection(api, { voters: [voter.accountId] });
    await api.call('POST', ballotRoute(election), voter);
    const broken = new ConsistencyCheckRunner(api.firebase, null);
    expect(await broken.runQueued()).toEqual({ checked: 0, failed: 1 });
    expect((await api.call('GET', ballotRoute(election), voter)).body.check).toMatchObject({
      status: 'failed',
      error: 'the consistency check is not set up on the worker',
    });
    expect((await api.call('POST', ballotRoute(election), voter)).status).toBe(202);
  });

  it('goes when its election is deleted', async () => {
    const election = await seedElection(api, { voters: [voter.accountId], state: 'cancelled' });
    expect((await api.call('POST', editorRoute(election), ea)).status).toBe(202);
    expect((await api.call('POST', ballotRoute(election), voter)).status).toBe(404); // cancelled: no ballot
    expect((await api.call('POST', `/v1/admin/elections/${election.electionId}/delete`, ea, { reason: 'set up by mistake' })).status).toBe(204);
    expect(await stored(election, ea)).toBeUndefined();
  });
});
