import { describe, expect, it } from 'vitest';
import { buildWorld, ELECTION_ID } from '../../../packages/verify/src/testing/fixtures.js';
import { connect, report, serve, SITE, texts, withResults } from './testing/world.js';

const entryRequests = (paths: readonly string[]) => paths.filter((p) => p.startsWith('/v1/public/ledger/entries/')).length;

describe('the MCP tools', () => {
  it('offers seven tools, every one read-only, and says what the server is for', async () => {
    const { client } = await connect(serve(await buildWorld()).fetchFn);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'list_elections',
      'get_election_status',
      'get_turnout',
      'get_results',
      'get_audit_report',
      'list_courses',
      'get_course',
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    }
    expect(tools.find((t) => t.name === 'get_audit_report')!.inputSchema.required ?? []).toEqual([]);
    expect(tools.find((t) => t.name === 'get_results')!.inputSchema.required).toEqual(['election_id']);
    expect(client.getInstructions()).toContain(`published at ${SITE}`);
  });

  it('lists the elections the public ledger names, and reads the ledger only once', async () => {
    const { fetchFn, paths } = serve(await buildWorld());
    const { call } = await connect(fetchFn);
    expect(report(await call('list_elections'))).toEqual({
      site: SITE,
      elections: [
        {
          electionId: ELECTION_ID,
          title: 'Committee Elections',
          state: 'closed',
          rehearsal: false,
          opensAt: '2026-10-21T12:10:00.000Z',
          closesAt: '2026-10-21T12:25:00.000Z',
          rollSize: 6,
          ballotsSealed: 4,
          results: null,
        },
      ],
    });
    const scanned = entryRequests(paths);
    expect(scanned).toBeGreaterThan(5);
    await call('list_elections');
    expect(entryRequests(paths)).toBe(scanned); // signed entries, and private ones' 404s, are kept
  });

  it('marks a rehearsal', async () => {
    const { call } = await connect(serve(await buildWorld({ rehearsal: true })).fetchFn);
    expect(report(await call('list_elections')).elections[0]).toMatchObject({ rehearsal: true });
    expect(report(await call('get_election_status', { election_id: ELECTION_ID }))).toMatchObject({
      rehearsal: true,
      roll: { size: 6, voters: 'test voters only' },
    });
  });

  it('gives an election’s status, from its ID or a link to it', async () => {
    const { call } = await connect(serve(await buildWorld()).fetchFn);
    const status = report(await call('get_election_status', { election_id: `${SITE}/results/${ELECTION_ID.toUpperCase()}` }));
    expect(status).toMatchObject({
      electionId: ELECTION_ID,
      state: 'closed',
      stage: 'every ballot is sealed; the results are being counted',
      secrecy: 'secret ballot',
      votingWindow: { opensAt: '2026-10-21T12:10:00.000Z', closesAt: '2026-10-21T12:25:00.000Z' },
      timeline: { openedAt: '2026-10-21T12:10:00.000Z', sealedAt: '2026-10-21T12:26:00.000Z', certifiedAt: null },
      ballotsSealed: 4,
      results: null,
      links: {
        resultsPage: `${SITE}/results/${ELECTION_ID}`,
        importDataFormula: `=IMPORTDATA("${SITE}/v1/public/elections/${ELECTION_ID}/results.csv")`,
      },
    });
    expect(status.contests).toEqual([
      { number: 1, contestId: 'plank', title: 'Plank 12', kind: 'proposal (yes / no / abstain)', proposal: 'Plank 12', amendsBylaws: false },
      { number: 2, contestId: 'chair', title: 'Chair', kind: 'choose N candidates', seats: 1, maxSelections: 1, candidates: ['CA', 'CB', 'CC'] },
    ]);
  });

  describe('turnout', () => {
    it('is a lower bound while voting is open, and says why', async () => {
      const { call } = await connect(serve(await buildWorld({ closed: false })).fetchFn);
      const turnout = report(await call('get_turnout', { election_id: ELECTION_ID }));
      expect(turnout).toMatchObject({ state: 'open', rollSize: 6, ballots: 2, turnoutPercent: '33.3%', exact: false });
      expect(turnout.basis).toMatch(/^a lower bound: .* Up to 3 more \(2k - 1, k = 2\) wait in the encrypted pool/);
    });

    it('is exact once every ballot is sealed', async () => {
      const { call } = await connect(serve(await buildWorld()).fetchFn);
      expect(report(await call('get_turnout', { election_id: ELECTION_ID }))).toMatchObject({ ballots: 4, turnoutPercent: '66.7%', exact: true });
    });

    it('comes per contest from the counted results', async () => {
      const { world, results } = await withResults(await buildWorld());
      const { call } = await connect(serve(world, results).fetchFn);
      expect(report(await call('get_turnout', { election_id: ELECTION_ID }))).toMatchObject({
        ballots: 4,
        turnoutPercent: '66.7%',
        exact: true,
        basis: 'counted: the provisional results',
        contests: [
          { title: 'Plank 12', ballots: 4, invalid: 0, abstain: 1, quorum: null },
          { title: 'Chair', ballots: 4, invalid: 0, blank: 0 },
        ],
      });
    });
  });

  describe('results', () => {
    it('says when they are not published yet', async () => {
      const { call } = await connect(serve(await buildWorld()).fetchFn);
      expect(report(await call('get_results', { election_id: ELECTION_ID }))).toMatchObject({
        published: false,
        stage: 'every ballot is sealed; the results are being counted',
      });
      expect(report(await call('get_results', { election_id: ELECTION_ID, format: 'csv' }))).toMatchObject({ published: false });
    });

    it('gives the synopsis with exact percentages, and checks the signed results from public data', async () => {
      const { world, results } = await withResults(await buildWorld());
      const { call } = await connect(serve(world, results).fetchFn);
      const answer = report(await call('get_results', { election_id: ELECTION_ID }));
      expect(answer).toMatchObject({
        published: true,
        status: 'provisional',
        statusMeaning: expect.stringMatching(/^provisional: /),
        resultsHash: results.resultsHash,
        rehearsal: false,
        synopsis: { turnout: { count: 4, of: 6, percent: '66.7%' }, tally: { proposals: { total: 1, passed: 1 } } },
      });
      const [plank, chair] = answer.synopsis.contests;
      expect(plank).toMatchObject({
        outcome: 'passed',
        yes: { count: 2, of: 4, percent: '50.0%' },
        passRule: { rule: 'more than 50.0% of yes + no votes', yesShare: '66.7%' },
      });
      expect(chair.candidates.map((c: { name: string; elected: boolean }) => [c.name, c.elected])).toEqual([
        ['CA', true],
        ['CB', false],
        ['CC', false],
      ]);
      // Everything checks except the ledger entry, which this world never recorded: that step waits.
      expect(answer.verification.status).toBe('pending');
      expect(answer.verification.steps.filter((s: { ok: boolean | null }) => s.ok === false)).toEqual([]);
      expect(answer.verification.steps.find((s: { label: string }) => /^Re-tallied here/.test(s.label))).toMatchObject({ ok: true });
    });

    it('fails the check when the published bundle was altered', async () => {
      const { world, results } = await withResults(await buildWorld());
      const altered = structuredClone(results);
      (altered.bundle as { participationCount: number }).participationCount = 5;
      const { call } = await connect(serve(world, altered).fetchFn);
      expect(report(await call('get_results', { election_id: ELECTION_ID })).verification.status).toBe('failed');
    });

    it('gives the CSV as its own text block, ready for a spreadsheet', async () => {
      const { world, results } = await withResults(await buildWorld());
      const { call } = await connect(serve(world, results).fetchFn);
      const answer = await call('get_results', { election_id: ELECTION_ID, format: 'csv' });
      expect(report(answer)).toEqual({
        electionId: ELECTION_ID,
        title: 'Committee Elections',
        published: true,
        links: expect.objectContaining({ importDataFormula: `=IMPORTDATA("${SITE}/v1/public/elections/${ELECTION_ID}/results.csv")` }),
      });
      expect(texts(answer)[1]).toMatch(/^Election,Committee Elections,\r\nNotice,Unsigned copy for spreadsheets/);
    });
  });

  describe('audit reports', () => {
    it('verify an election end to end, the counts as JSON and the report as plain text', async () => {
      const { call } = await connect(serve(await buildWorld()).fetchFn);
      const answer = await call('get_audit_report', { election_id: ELECTION_ID });
      const audit = report(answer);
      expect(audit).toEqual({ verified: true, passed: expect.any(Number), failed: 0, pending: expect.any(Number) });
      expect(audit.passed).toBeGreaterThan(5);
      const text = texts(answer)[1]!;
      expect(text).toMatch(new RegExp(`^USTP Vote audit report: ${SITE}, election ${ELECTION_ID}, `));
      expect(text).toContain('Election: Committee Elections');
      expect(text).toMatch(/VERIFIED: \d+ passed, 0 failed, \d+ pending$/);
    });

    it('verify the whole ledger and every public entry without an election', async () => {
      const { call } = await connect(serve(await buildWorld()).fetchFn);
      const answer = await call('get_audit_report');
      expect(report(answer).verified).toBe(true);
      expect(texts(answer)[1]).toContain('Public ledger entries');
      expect(texts(answer)[1]).not.toContain('Election:');
    });

    it('fail when the api serves tampered sealed ballots', async () => {
      const world = await buildWorld();
      const sealedBlocks = structuredClone(world.sealedBlocks);
      (sealedBlocks[1]!.contests.chair![0]! as { selection: unknown }).selection = ['cb'];
      const { call } = await connect(serve({ ...world, sealedBlocks }).fetchFn);
      const answer = await call('get_audit_report', { election_id: ELECTION_ID });
      expect(report(answer)).toMatchObject({ verified: false, failed: 1 });
      expect(texts(answer)[1]).toContain('[FAIL] Sealed block contents recompute and match their summaries');
    });
  });

  describe('mistakes', () => {
    it('answer as tool errors the model can act on', async () => {
      const { call } = await connect(serve(await buildWorld()).fetchFn);
      const unknown = await call('get_election_status', { election_id: '019a0a10-0000-7000-8000-00000000ffff' });
      expect(unknown.isError).toBe(true);
      expect(texts(unknown)[0]).toMatch(/^no published election 019a0a10-0000-7000-8000-00000000ffff: drafts are not public/);
      const garbled = await call('get_turnout', { election_id: 'the spring election' });
      expect(garbled.isError).toBe(true);
      expect(texts(garbled)[0]).toMatch(/holds no election ID/);
    });

    it('say so when the api cannot be reached', async () => {
      const down: typeof fetch = () => Promise.reject(new Error('connect ECONNREFUSED'));
      const { call } = await connect(down);
      const answer = await call('list_elections');
      expect(answer.isError).toBe(true);
      expect(texts(answer)[0]).toMatch(/^the election api did not answer: cannot reach https:\/\/vote\.test\/v1\/public\/ledger\/blocks/);
    });
  });
});
