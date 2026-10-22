import { seedCommitment, tieBreakOrder } from 'ustp-audit';
import {
  buildResultsBundle,
  checkResults,
  resultsHash,
  type ElectionRecord,
  type PublicElection,
  type ResultsEvidence,
  type ResultsRecord,
  type SealedBlockRecord,
} from 'ustp-domain';
import type { IrvResult, ProposalResult } from 'ustp-tally';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeNow, ledgerTypes, seedElection, seededBallot, type SeededElection } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';
import { Tallier } from './worker/tallier.js';

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let voters: Member[];

beforeEach(async () => {
  await resetEmulators();
  voters = [];
  for (let i = 0; i < 5; i++) voters.push(await api.member(`v${i}@example.test`));
});

async function openElection(opts: Partial<Parameters<typeof seedElection>[1]> = {}): Promise<SeededElection> {
  const seeded = await seedElection(api, { voters: voters.map((v) => v.accountId), kAnonymity: 2, ...opts });
  expect((await worker.tick()).body).toMatchObject({ electionsOpened: 1 });
  return seeded;
}

/** Each voter casts `plank` (yes, no, yes, ...) and the given chair ranking. */
async function cast(election: SeededElection, who: readonly Member[], chair: (i: number) => string[] = () => ['blair', 'alex']) {
  const { definitionHash } = (await api.call('GET', `${election.url}/ballot`, who[0])).body;
  for (const [i, voter] of who.entries()) {
    const parts = seededBallot(election.electionId, i % 2 ? 'no' : 'yes', chair(i));
    expect((await api.call('POST', `${election.url}/ballots`, voter, { definitionHash, parts })).status).toBe(201);
  }
}

const close = (election: SeededElection) => closeNow(api, election);
const publicUrl = (election: SeededElection) => `/v1/public/elections/${election.electionId}`;
const resultsOf = async (election: SeededElection) => (await api.call('GET', `${publicUrl(election)}/results`)).body as ResultsRecord;

/** What the results page fetches, from the public endpoints only. */
async function evidence(election: SeededElection): Promise<ResultsEvidence> {
  const get = async (url: string) => (await api.call('GET', url)).body;
  const results = await resultsOf(election);
  const entry = await api.call('GET', `/v1/public/ledger/entries/${results.ledgerSeq}`);
  const anchor = await api.call('GET', '/v1/public/anchors/latest');
  return {
    election: await get(publicUrl(election)),
    results,
    blocks: await get(`${publicUrl(election)}/sealed-blocks`),
    keys: await get('/v1/public/ledger/keys'),
    ledger: entry.status === 200 ? entry.body : null,
    anchor: anchor.status === 200 ? anchor.body : null,
  };
}

describe('tallying', () => {
  it('counts a closed, sealed election into signed results anyone can re-check', async () => {
    const election = await openElection();
    await cast(election, voters);
    expect((await api.call('GET', `${publicUrl(election)}/results`)).status).toBe(404);
    expect((await api.call('GET', publicUrl(election))).body).toMatchObject({ results: null });

    await close(election);
    expect((await worker.tick()).body).toMatchObject({ electionsClosed: 1, ballotsSealed: 5, resultsComputed: 1 });

    const results = await resultsOf(election);
    const { bundle } = results;
    expect(results).toMatchObject({ electionId: election.electionId, status: 'provisional', resultsHash: resultsHash(bundle) });
    expect(bundle).toMatchObject({ participationCount: 5, tieBreakSeed: election.tieBreakSeed, roll: { count: 5 } });
    expect(seedCommitment(bundle.tieBreakSeed)).toBe(bundle.tieBreakSeedCommitment);
    const [plank, chair] = bundle.contests;
    expect(plank!.result as ProposalResult).toMatchObject({ counts: { yes: 3, no: 2, abstain: 0 }, outcome: 'passed' });
    expect(chair!.tieBreakOrder).toEqual(tieBreakOrder(election.tieBreakSeed, 'chair', ['alex', 'blair']));
    expect(chair!.result as IrvResult).toMatchObject({ winner: 'blair', rounds: [{ round: 1, elected: 'blair' }] });

    const record = (await api.call('GET', publicUrl(election))).body as PublicElection;
    expect(record.results).toEqual({
      status: 'provisional',
      resultsHash: results.resultsHash,
      computedAt: results.computedAt,
      ledgerSeq: results.ledgerSeq,
    });
    expect((await ledgerTypes(api, election.electionId)).at(-1)).toBe('results.computed');
    const entry = (await api.call('GET', `/v1/public/ledger/entries/${results.ledgerSeq}`)).body;
    expect(entry.entry.payload).toMatchObject({ resultsHash: results.resultsHash, tieBreakSeed: election.tieBreakSeed });

    // Re-tallied from the published blocks and the revealed seed alone: byte-for-byte the same bundle.
    const blocks = (await api.call('GET', `${publicUrl(election)}/sealed-blocks`)).body as SealedBlockRecord[];
    const rebuilt = buildResultsBundle({
      definition: record.definition,
      definitionHash: record.election.definitionHash!,
      roll: { snapshotId: record.roll!.snapshotId, merkleRoot: record.roll!.merkleRoot, count: record.roll!.count },
      tieBreakSeed: bundle.tieBreakSeed,
      tieBreakSeedCommitment: record.election.tieBreakSeedCommitment!,
      blocks,
    });
    expect(resultsHash(rebuilt)).toBe(results.resultsHash);

    const check = await checkResults(await evidence(election));
    expect(check.steps.filter((s) => s.ok !== true)).toEqual([]);
    expect(check.status).toBe('verified');
  });

  it('breaks ties with the order derived from the revealed seed', async () => {
    const election = await openElection();
    await cast(election, voters.slice(0, 2), (i) => [i ? 'blair' : 'alex']);
    await close(election);
    await worker.tick();

    const chair = (await resultsOf(election)).bundle.contests[1]!.result as IrvResult;
    const [favoured, last] = tieBreakOrder(election.tieBreakSeed, 'chair', ['alex', 'blair']);
    expect(chair.tieBreaks).toEqual([
      { reason: 'irv_elimination', tied: [favoured, last], resolvedBy: 'tie_break_order', excluded: [last], round: 1 },
    ]);
    expect(chair.winner).toBe(favoured);
  });

  it('counts roll-call elections the same way', async () => {
    const election = await openElection({ secrecy: 'open' });
    await cast(election, voters.slice(0, 3));
    await close(election);
    expect((await worker.tick()).body).toMatchObject({ ballotsSealed: 3, resultsComputed: 1 });
    const plank = (await resultsOf(election)).bundle.contests[0]!.result as ProposalResult;
    expect(plank.counts).toEqual({ yes: 2, no: 1, abstain: 0 });
    expect((await checkResults(await evidence(election))).status).toBe('verified');
  });

  it('refuses a seed that does not match its published commitment, and still tallies other elections', async () => {
    const bad = await seedElection(api, { voters: voters.map((v) => v.accountId), tieBreakSeedCommitment: seedCommitment('1'.repeat(64)) });
    const good = await seedElection(api, { voters: voters.map((v) => v.accountId) });
    await worker.tick();
    await Promise.all([close(bad), close(good)]);

    for (let attempt = 0; attempt < 2; attempt++) {
      const tick = await worker.tick();
      expect(tick.status).toBe(500); // fails loudly every time, so Cloud Scheduler records it
      expect(JSON.stringify(tick.body)).toContain('does not match the commitment published at scheduling');
    }
    expect(((await bad.ref.get()).data() as ElectionRecord).sealedAt).toEqual(expect.any(String));
    expect((await api.call('GET', `${publicUrl(bad)}/results`)).status).toBe(404);
    expect(await ledgerTypes(api, bad.electionId)).not.toContain('results.computed');
    expect((await api.call('GET', `${publicUrl(good)}/results`)).status).toBe(200);
  });

  it('does nothing on a second tick, and records one result when tallies overlap', async () => {
    const election = await openElection();
    await cast(election, voters.slice(0, 3));
    // The secret store hands back a wrong seed at first: refused, so the election stays untallied.
    const { tieBreakSeedRef } = (await election.ref.get()).data() as ElectionRecord;
    const secret = api.firebase.db.collection('emulator_secrets').doc(tieBreakSeedRef!);
    await secret.update({ value: '2'.repeat(64) });
    await close(election);
    expect((await worker.tick()).status).toBe(500);

    await secret.update({ value: election.tieBreakSeed });
    const tallier = worker.app.get(Tallier);
    const counts = await Promise.all([tallier.tallyAll(), tallier.tallyAll(), tallier.tallyAll()]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    const first = await resultsOf(election);

    expect((await worker.tick()).body).toMatchObject({ resultsComputed: 0 });
    expect(await resultsOf(election)).toEqual(first);
    expect((await ledgerTypes(api, election.electionId)).filter((t) => t === 'results.computed')).toHaveLength(1);
  });

  it('answers 404 for results of drafts and unknown elections', async () => {
    const draft = await seedElection(api, { voters: [], state: 'draft' });
    expect((await api.call('GET', `${publicUrl(draft)}/results`)).status).toBe(404);
    expect((await api.call('GET', '/v1/public/elections/nope/results')).status).toBe(404);
  });
});
