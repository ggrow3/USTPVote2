import { resultsCsv, type PublicElection, type ResultsRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeNow, seedElection, seededBallot, type SeededElection } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let sa2: Member;
let ea: Member;
let auditor: Member;
let voters: Member[];

beforeEach(async () => {
  await resetEmulators();
  [sa1, sa2] = await api.systemAdmins();
  ea = await api.member('election.admin@example.test');
  auditor = await api.member('auditor@example.test');
  await api.grant(ea.accountId, 'election_admin', sa1, sa2);
  await api.grant(auditor.accountId, 'auditor', sa1, sa2);
  voters = [];
  for (let i = 0; i < 3; i++) voters.push(await api.member(`v${i}@example.test`));
});

const publicUrl = (e: SeededElection) => `/v1/public/elections/${e.electionId}`;

/** The CSV as Google Sheets fetches it through Firebase Hosting at vote.example.org: no credentials. */
async function csv(url: string, headers: Record<string, string> = { 'x-forwarded-host': 'vote.example.org', 'x-forwarded-proto': 'https' }) {
  const res = await api.app.inject({ method: 'GET', url: `${url}/results.csv`, headers });
  return { status: res.statusCode, text: res.body, headers: res.headers };
}

/** Lines without the empty cells that pad every row to the same width. */
const linesOf = (text: string) => text.split('\r\n').map((line) => line.replace(/,+$/, ''));

async function published(election: SeededElection) {
  const results = (await api.call('GET', `${publicUrl(election)}/results`)).body as ResultsRecord;
  const record = (await api.call('GET', publicUrl(election))).body as PublicElection;
  return { results, definition: record.definition };
}

describe('results CSV', () => {
  it('is published with the results, is made from the signed bundle, and shows certification', async () => {
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId), kAnonymity: 2 });
    expect((await worker.tick()).body).toMatchObject({ electionsOpened: 1 });
    expect((await csv(publicUrl(election))).status).toBe(404);

    const { definitionHash } = (await api.call('GET', `${election.url}/ballot`, voters[0])).body;
    for (const [i, voter] of voters.entries()) {
      const parts = seededBallot(election.electionId, i === 2 ? 'no' : 'yes', i === 2 ? ['alex'] : ['blair', 'alex']);
      expect((await api.call('POST', `${election.url}/ballots`, voter, { definitionHash, parts })).status).toBe(201);
    }
    await closeNow(api, election);
    expect((await csv(publicUrl(election))).status).toBe(404); // closed, not yet sealed and counted
    expect((await worker.tick()).body).toMatchObject({ resultsComputed: 1 });

    const res = await csv(publicUrl(election));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="results-${election.electionId}.csv"`);
    const { results, definition } = await published(election);
    expect(res.text).toBe(resultsCsv({ results, definition, origin: 'https://vote.example.org' }));
    const lines = linesOf(res.text);
    expect(lines.slice(0, 9)).toEqual([
      `Election,${definition.title}`,
      expect.stringMatching(/^Notice,Unsigned copy for spreadsheets\. The authoritative record is the signed results bundle/),
      'Status,Provisional (not yet certified)',
      'Certified at',
      `Counted at,${results.computedAt}`,
      `Results hash,${results.resultsHash}`,
      `Results page,https://vote.example.org/results/${election.electionId}`,
      `Signed bundle,https://vote.example.org/v1/public/elections/${election.electionId}/results`,
      `Election ID,${election.electionId}`,
    ]);
    expect(lines).toEqual(expect.arrayContaining(['Yes,2', 'No,1', 'Outcome,Passed', 'Round result,Blair Chen elected', 'Elected,Blair Chen']));
    // Nothing about who voted: no account or email appears.
    for (const v of voters) expect(res.text).not.toContain(v.accountId);
    expect(res.text).not.toContain('example.test');

    // Without Hosting's forwarding headers, links use the host the api was reached at.
    expect(linesOf((await csv(publicUrl(election), {})).text)).toContain(`Results page,http://localhost/results/${election.electionId}`);

    const req = await api.call('POST', `/v1/admin/elections/${election.electionId}/certify`, ea, { reason: 'count reviewed' });
    expect(req.status).toBe(201);
    const decision = await api.call('POST', `/v1/admin/approvals/${req.body.id}/decision`, auditor, { decision: 'approve', reason: 'checked' });
    expect(decision.body.status).toBe('executed');

    const certified = await csv(publicUrl(election));
    const after = await published(election);
    expect(after.results.status).toBe('certified');
    expect(certified.text).toBe(resultsCsv({ ...after, origin: 'https://vote.example.org' }));
    expect(linesOf(certified.text).slice(2, 4)).toEqual(['Status,Certified', `Certified at,${after.results.certifiedAt}`]);
  });

  it('answers 404 for drafts, unknown elections and elections not yet counted', async () => {
    const draft = await seedElection(api, { voters: [], state: 'draft' });
    const scheduled = await seedElection(api, { voters: voters.map((v) => v.accountId) });
    for (const url of [publicUrl(draft), publicUrl(scheduled), '/v1/public/elections/nope']) {
      const res = await csv(url);
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
    }
  });
});
