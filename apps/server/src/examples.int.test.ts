import { newSalt } from 'ustp-audit';
import {
  ACT_AS_HEADER,
  ballotViewProblems,
  commitmentsOf,
  expectedResultProblems,
  planTestBallots,
  voterPersonaLabel,
  type AmendedBylawsView,
  type BallotView,
  type ElectionDetail,
  type PersonaSummary,
  type ResultsRecord,
} from 'ustp-domain';
import { PublicApi, verify } from 'ustp-verify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetEmulators, TestApi, TestWorker } from './testing/emulator.js';
import { exampleBylaws, exampleElection, examplesManifest, exampleVotes } from './testing/examples.js';

/**
 * Every example votes file (examples/, design §6.7, §10.4) run end to end as a rehearsal: the example imported by the
 * Test Election Admin with a short window, a rehearsal roll and scheduling approved by the Test Auditor, the planned
 * ballots cast as the test voters with the browser's checks, the election closed, sealed and counted, the results
 * compared with the file's expectations, certified, any amended bylaws adopted, and the whole record then checked by
 * `ustp-verify` from public data, as anyone could.
 */

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
afterEach(() => {
  vi.useRealTimers();
});

/** The api and worker go by `Date`; moving it on is how a rehearsal reaches its opening and closing times. */
function travelTo(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(Date.parse(iso) + 1000);
}

/** `ustp-verify`'s fetch, answered by the api in this process. */
const inProcess: typeof fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const res = await api.app.inject({ method: 'GET', url: `${url.pathname}${url.search}`, headers: { accept: 'application/json' } });
  return new Response(res.body, { status: res.statusCode, headers: { 'content-type': String(res.headers['content-type'] ?? '') } });
};

const runs = examplesManifest.elections.flatMap((e) => (e.votes ?? []).map((v) => ({ election: e.file, votes: v.file })));

describe('the examples, end to end', () => {
  it.each(runs)(
    '$votes in $election',
    async ({ election, votes }) => {
      await resetEmulators();
      const [sa1] = await api.systemAdmins();
      const file = exampleVotes(votes);
      const voters = Math.max(file.random?.voters ?? 0, ...file.ballots.map((b) => b.voter));
      let personas = (await api.call('POST', '/v1/testing/personas', sa1, {})).body as PersonaSummary[];
      const as = (label: string) => ({ [ACT_AS_HEADER]: personas.find((p) => p.label === label)!.accountId });
      const call = (label: string, method: 'GET' | 'POST', url: string, body?: unknown) => api.call(method, url, sa1, body, as(label));
      const approve = async (id: string) =>
        expect((await call('Test Auditor', 'POST', `/v1/admin/approvals/${id}/decision`, { decision: 'approve', reason: 'rehearsal' })).body.status).toBe('executed');

      // The base bylaws and the offices, then the test voters, who join on those bylaws.
      const bylaws = exampleBylaws();
      const published = await call('Test Membership Admin', 'POST', '/v1/admin/bylaws', { version: bylaws.version, title: bylaws.title, text: bylaws.text });
      expect(published.status).toBe(201);
      for (const office of examplesManifest.offices) {
        expect((await call('Test Election Admin', 'POST', '/v1/admin/positions', { ...office, reason: 'rehearsal' })).status).toBe(201);
      }
      personas = (await api.call('POST', '/v1/testing/personas', sa1, { voters })).body;

      // Imported to open in a minute and vote for two, approved through the rehearsal roll and scheduling.
      const pkg = { ...exampleElection(election), window: { opensInSeconds: 60, votingSeconds: 120 } };
      const imported = await call('Test Election Admin', 'POST', '/v1/admin/elections/import', pkg);
      expect(imported.status).toBe(201);
      const detail = imported.body as ElectionDetail;
      expect(detail.problems).toEqual([]);
      const { electionId, opensAt, closesAt } = detail.election;
      const url = `/v1/admin/elections/${electionId}`;
      const roll = await call('Test Election Admin', 'POST', `${url}/roll`, { reason: 'rehearsal', voters: 'test_voters' });
      expect(roll.body.count).toBe(voters);
      await approve(roll.body.approvalId);
      await approve((await call('Test Election Admin', 'POST', `${url}/schedule`, { reason: 'rehearsal' })).body.id);
      await worker.tick();

      travelTo(opensAt);
      await worker.tick();
      const ballot = `/v1/elections/${electionId}/ballot`;
      const view = (await call(voterPersonaLabel(1), 'GET', ballot)).body as BallotView;
      expect(view.election.state).toBe('open');
      expect(ballotViewProblems(view)).toEqual([]);

      // Each test voter checks the ballot as the browser does, casts the planned choices and checks the commitments.
      const plan = planTestBallots(file, view.definition);
      if (!plan.ok) throw new Error(plan.problems.join('\n'));
      for (const { voter, selections } of plan.ballots) {
        const mine = (await call(voterPersonaLabel(voter), 'GET', ballot)).body as BallotView;
        expect(mine.definitionHash).toBe(view.definitionHash);
        const parts = selections.map((s) => ({ v: 1 as const, electionId, ...s, salt: newSalt() }));
        const cast = await call(voterPersonaLabel(voter), 'POST', `/v1/elections/${electionId}/ballots`, { definitionHash: mine.definitionHash, parts });
        expect(cast.status).toBe(201);
        expect(cast.body.commitments).toEqual(commitmentsOf(parts));
      }

      // Closed, sealed and counted; the results are what the file expects.
      travelTo(closesAt);
      const resultsUrl = `/v1/public/elections/${electionId}/results`;
      for (let i = 0; i < 4 && (await api.call('GET', resultsUrl)).status !== 200; i++) await worker.tick();
      const results = (await api.call('GET', resultsUrl)).body as ResultsRecord;
      expect(results.bundle.participationCount).toBe(plan.ballots.length);
      expect(expectedResultProblems(file.expect, view.definition, results.bundle)).toEqual([]);

      await approve((await call('Test Election Admin', 'POST', `${url}/certify`, { reason: 'rehearsal' })).body.id);

      // Amended bylaws: the text the passed amendments give, adopted once.
      if (file.expectBylawsSha256) {
        const amended = (await api.call('GET', `/v1/public/elections/${electionId}/amended-bylaws`)).body as AmendedBylawsView;
        expect(amended.contentHash).toBe(file.expectBylawsSha256);
        const adopt = { version: '2026.2', title: bylaws.title, text: amended.text, amends: bylaws.version, adoptedIn: { electionId } };
        expect((await call('Test Membership Admin', 'POST', '/v1/admin/bylaws', adopt)).status).toBe(201);
        expect((await call('Test Membership Admin', 'POST', '/v1/admin/bylaws', { ...adopt, version: '2026.3', amends: '2026.2' })).status).toBe(409);
      }

      // The worker seals the last entries into a signed block; then anyone can check the record from public data.
      await worker.tick();
      const sections = await verify(new PublicApi('http://api.test', inProcess), { electionId });
      const findings = sections.flatMap((s) => s.findings.map((f) => ({ section: s.title, ...f })));
      expect(findings.filter((f) => f.status === 'fail')).toEqual([]);
      expect(findings.filter((f) => f.status === 'pending')).toEqual([]);
      const titles = sections.map((s) => s.title);
      expect(titles).toEqual(expect.arrayContaining(['Ledger', `Election: ${detail.election.title}`, 'Results']));
      expect(titles.includes('Bylaws amendments')).toBe(!!file.expectBylawsSha256);
    },
    120_000,
  );
});
