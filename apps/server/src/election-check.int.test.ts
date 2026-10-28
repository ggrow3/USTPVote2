import { Collections, type ElectionCheckRecord, type ElectionCheckState, type ElectionCheckView, type ElectionDetail, type PublicElectionCheck } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ElectionCheckMaterials } from './election-check/election-check-material.js';
import { ElectionCheckRunner } from './election-check/election-check-runner.js';
import { seedElection, type SeededElection } from './testing/elections.js';
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
let member: Member;
let membershipAdmin: Member;

/** The stand-in notes proposals below two-thirds (line 2) and without a quorum (line 3). */
const BYLAWS = ['Article I. Name.', 'Article II. Amendments need two-thirds of the votes cast.', 'Article III. A quorum is one tenth of the members.'].join('\n');

beforeEach(async () => {
  await resetEmulators();
  const [sa1] = await api.systemAdmins();
  membershipAdmin = await api.member('membership.admin@example.test');
  ea = await api.member('election.admin@example.test');
  auditor = await api.member('auditor@example.test');
  member = await api.member('someone@example.test');
  await api.grant(membershipAdmin.accountId, 'membership_admin', sa1);
  await api.grant(ea.accountId, 'election_admin', sa1);
  await api.grant(auditor.accountId, 'auditor', sa1);
  expect((await api.call('POST', '/v1/admin/bylaws', membershipAdmin, { version: '2026.1', title: 'USTP Bylaws', text: BYLAWS })).status).toBe(201);
});

const checksUrl = (e: SeededElection) => `/v1/admin/elections/${e.electionId}/bylaws-checks`;
const publicUrl = (e: SeededElection) => `/v1/public/elections/${e.electionId}/bylaws-check`;
const state = async (e: SeededElection, by: User = ea) => (await api.call('GET', checksUrl(e), by)).body as ElectionCheckState;
const latest = async (e: SeededElection, by: User = ea) => (await state(e, by)).check as ElectionCheckView;

async function runWorker() {
  const res = await worker.app.inject({ method: 'POST', url: '/tasks/election-checks' });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

/** Freezes the draft as it stands, as an approved schedule request would. */
async function schedule(e: SeededElection) {
  const detail = (await api.call('GET', `/v1/admin/elections/${e.electionId}`, ea)).body as ElectionDetail;
  await e.ref.update({ state: 'scheduled', definitionHash: detail.definitionHash });
}

describe('the election setup check', () => {
  it('runs once per version of the election, and every user sees the check of the frozen definition', async () => {
    const draft = await seedElection(api, { voters: [], state: 'draft' });
    expect(await state(draft)).toEqual({ enabled: true, check: null });
    expect((await api.call('GET', publicUrl(draft))).status).toBe(404); // drafts are not public

    const queued = await api.call('POST', checksUrl(draft), ea);
    expect(queued.status).toBe(202);
    expect(queued.body).toMatchObject({ electionId: draft.electionId, status: 'queued', requestedBy: ea.accountId, changedSince: [] });
    expect((await api.call('POST', checksUrl(draft), auditor)).status).toBe(409); // already being checked

    expect(await runWorker()).toEqual({ status: 200, body: { checked: 1, failed: 0 } });
    const done = await latest(draft, auditor);
    expect(done).toMatchObject({ checkId: queued.body.checkId, status: 'done', checker: 'stub', model: null, error: null, changedSince: [] });
    expect(done.findings.map((f) => [f.contestId, f.topic, f.bylawsLines])).toEqual([
      ['plank', 'pass-threshold', [2]],
      ['plank', 'quorum', [3]],
    ]);
    expect(done.quotedLines).toEqual([
      { line: 2, text: 'Article II. Amendments need two-thirds of the votes cast.' },
      { line: 3, text: 'Article III. A quorum is one tenth of the members.' },
    ]);
    expect(done.basis).toMatchObject({ bylaws: { version: '2026.1' } });
    expect(done.summary).toMatch(/not an AI review/);
    expect(await runWorker()).toEqual({ status: 200, body: { checked: 0, failed: 0 } });

    // Once: nothing has changed, so there is nothing new to check.
    const again = await api.call('POST', checksUrl(draft), ea);
    expect(again.status).toBe(409);
    expect(again.body.detail).toMatch(/already checked/);

    // An edit makes the check out of date, and allows another.
    expect((await api.call('PATCH', `/v1/admin/elections/${draft.electionId}`, ea, { description: 'Changed.' })).status).toBe(200);
    expect((await latest(draft)).changedSince).toEqual(['election']);
    const second = await api.call('POST', checksUrl(draft), auditor);
    expect(second.status).toBe(202);
    await runWorker();
    expect(await latest(draft)).toMatchObject({ checkId: second.body.checkId, status: 'done', changedSince: [] });
    expect((await api.call('GET', `${checksUrl(draft)}/${queued.body.checkId}`, ea)).body.changedSince).toEqual(['election']);

    // Scheduled: anyone, signed in or not, sees the check of the frozen definition, without who asked or what it cost.
    await schedule(draft);
    for (const viewer of [undefined, member]) {
      const shown = await api.call('GET', publicUrl(draft), viewer);
      expect(shown.status).toBe(200);
      const check = shown.body as PublicElectionCheck;
      expect(check).toMatchObject({ checkId: second.body.checkId, checker: 'stub', findings: done.findings, quotedLines: done.quotedLines });
      expect(Object.keys(check).sort()).toEqual(['basis', 'checkId', 'checker', 'electionId', 'findings', 'finishedAt', 'model', 'quotedLines', 'summary']);
    }
  });

  it('says when the bylaws or an office changed since, and allows another check then', async () => {
    const office = await api.call('POST', '/v1/admin/positions', ea, { positionId: 'chair', title: 'Chair', seats: 1, termMonths: 24, reason: 'bylaws art. 4' });
    expect(office.status).toBe(201);
    const draft = await seedElection(api, { voters: [], state: 'draft', chairPositionId: 'chair' });
    expect((await api.call('POST', checksUrl(draft), ea)).status).toBe(202);
    await runWorker();
    expect((await latest(draft)).changedSince).toEqual([]);

    await api.firebase.db.collection(Collections.positions).doc('chair').update({ termMonths: 12 });
    expect((await latest(draft)).changedSince).toEqual(['offices']);
    const amended = `${BYLAWS}\nArticle IV. The Chair serves one year.`;
    expect((await api.call('POST', '/v1/admin/bylaws', membershipAdmin, { version: '2026.2', title: 'USTP Bylaws', text: amended, amends: '2026.1' })).status).toBe(201);
    expect((await latest(draft)).changedSince).toEqual(['bylaws', 'offices']);

    expect((await api.call('POST', checksUrl(draft), ea)).status).toBe(202);
    await runWorker();
    expect(await latest(draft)).toMatchObject({ status: 'done', changedSince: [], basis: { bylaws: { version: '2026.2' } } });
  });

  it('never shows voters a check of an earlier draft', async () => {
    const draft = await seedElection(api, { voters: [], state: 'draft' });
    expect((await api.call('POST', checksUrl(draft), ea)).status).toBe(202);
    await runWorker();
    expect((await api.call('PATCH', `/v1/admin/elections/${draft.electionId}`, ea, { description: 'Changed after the check.' })).status).toBe(200);
    await schedule(draft);
    expect((await api.call('GET', publicUrl(draft))).status).toBe(404);

    // Scheduled elections can still be checked, once, until voting closes.
    expect((await api.call('POST', checksUrl(draft), ea)).status).toBe(202);
    await runWorker();
    expect((await api.call('GET', publicUrl(draft))).status).toBe(200);
  });

  it('is for Election Admins and Auditors, until voting closes, and needs published bylaws', async () => {
    const draft = await seedElection(api, { voters: [], state: 'draft' });
    expect((await api.call('POST', checksUrl(draft), member)).status).toBe(403);
    expect((await api.call('GET', checksUrl(draft), member)).status).toBe(403);
    expect((await api.call('GET', `${checksUrl(draft)}/not-an-id`, ea)).status).toBe(404);

    const closed = await seedElection(api, { voters: [], state: 'closed' });
    expect(await api.call('POST', checksUrl(closed), ea)).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/until voting closes/) } });
    expect((await api.call('POST', '/v1/admin/elections/nope/bylaws-checks', ea)).status).toBe(404);
    expect((await api.call('GET', '/v1/admin/elections/nope/bylaws-checks', ea)).status).toBe(404);
    expect((await api.call('GET', '/v1/public/elections/nope/bylaws-check')).status).toBe(404);

    await api.firebase.db.collection(Collections.bylawsVersions).doc('2026.1').delete();
    expect(await api.call('POST', checksUrl(draft), ea)).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/no bylaws have been published/) } });
  });

  it('fails a check the worker cannot run, which can then be asked for again', async () => {
    const draft = await seedElection(api, { voters: [], state: 'draft' });
    expect((await api.call('POST', checksUrl(draft), ea)).status).toBe(202);
    const broken = new ElectionCheckRunner(api.firebase, api.app.get(ElectionCheckMaterials), null);
    expect(await broken.runQueued()).toEqual({ checked: 0, failed: 1 });
    expect(await latest(draft)).toMatchObject({ status: 'failed', error: 'the election setup check is not set up on the worker' });
    expect((await api.call('POST', checksUrl(draft), ea)).status).toBe(202);
  });

  it('goes when its election is deleted', async () => {
    const draft = await seedElection(api, { voters: [], state: 'draft' });
    expect((await api.call('POST', checksUrl(draft), ea)).status).toBe(202);
    await runWorker();
    expect((await api.call('POST', `/v1/admin/elections/${draft.electionId}/cancel`, ea, { reason: 'set up by mistake' })).body).toMatchObject({ cancelled: true });
    expect((await api.call('POST', `/v1/admin/elections/${draft.electionId}/delete`, ea, { reason: 'set up by mistake' })).status).toBe(204);
    const left = await api.firebase.db.collection(Collections.electionChecks).where('electionId', '==', draft.electionId).get();
    expect(left.docs.map((d) => (d.data() as ElectionCheckRecord).checkId)).toEqual([]);
  });

  it('shows draft advisories when a contest does not fill all of its office’s seats', async () => {
    expect((await api.call('POST', '/v1/admin/positions', ea, { positionId: 'chair', title: 'Chair', seats: 2, termMonths: 24, reason: 'bylaws art. 4' })).status).toBe(201);
    const draft = await seedElection(api, { voters: [], state: 'draft', chairPositionId: 'chair' });
    const detail = (await api.call('GET', `/v1/admin/elections/${draft.electionId}`, ea)).body as ElectionDetail;
    expect(detail.advisories).toEqual([
      '“Chair” is ranked choice, which elects one person, but the office Chair has 2 seats. That is right when filling one seat; otherwise use a choose-candidates contest.',
    ]);
    await schedule(draft);
    expect(((await api.call('GET', `/v1/admin/elections/${draft.electionId}`, ea)).body as ElectionDetail).advisories).toEqual([]);
  });
});
