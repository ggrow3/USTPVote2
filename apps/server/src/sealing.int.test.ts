import { ballotPartCommitment, type BallotPart } from 'ustp-audit';
import {
  checkReceiptPart,
  sealedBlockProblems,
  type ElectionRecord,
  type PartCheck,
  type SealedBlockRecord,
} from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeNow, ledgerTypes, seedElection, seededBallot, type SeededElection } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

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

/** Casts a ballot for each voter and returns their parts, as their receipts would hold them. */
async function castFor(who: readonly Member[], election: SeededElection): Promise<BallotPart[][]> {
  const { definitionHash } = (await api.call('GET', `${election.url}/ballot`, who[0])).body;
  const ballots: BallotPart[][] = [];
  for (const [i, voter] of who.entries()) {
    const parts = seededBallot(election.electionId, i % 2 ? 'no' : 'yes');
    expect((await api.call('POST', `${election.url}/ballots`, voter, { definitionHash, parts })).status).toBe(201);
    ballots.push(parts);
  }
  return ballots;
}

const close = (election: SeededElection) => closeNow(api, election);
const publicUrl = (election: SeededElection) => `/v1/public/elections/${election.electionId}`;
const poolSize = async (election: SeededElection) => (await election.ref.collection('ballot_pool').get()).size;

/** The /verify page's check, against the public endpoints only. */
async function checkPart(electionId: string, part: BallotPart): Promise<PartCheck> {
  const commitment = ballotPartCommitment(part);
  const orNull = async (url: string) => {
    const res = await api.call('GET', url);
    return res.status === 200 ? res.body : null;
  };
  const proof = await orNull(`/v1/public/elections/${electionId}/proofs/${commitment}`);
  return checkReceiptPart({
    part,
    commitment,
    proof,
    ledger: proof ? await orNull(`/v1/public/ledger/entries/${proof.ledgerSeq}`) : null,
    keys: (await api.call('GET', '/v1/public/ledger/keys')).body,
    anchor: await orNull('/v1/public/anchors/latest'),
  });
}

describe('sealing secret ballots', () => {
  it('seals all but k while open, the rest at close, and records every block in the ledger', async () => {
    const election = await openElection();
    const early = await castFor(voters.slice(0, 3), election);
    expect((await worker.tick()).body).toMatchObject({ ballotsSealed: 0 }); // 3 < 2k: nothing could hide among k others

    const late = await castFor(voters.slice(3), election);
    expect((await worker.tick()).body).toMatchObject({ ballotsSealed: 3 }); // 5 - k
    expect(await poolSize(election)).toBe(2);

    const record = (await api.call('GET', publicUrl(election))).body;
    expect(record).toMatchObject({ ballotsSealed: 3, sealedBlocks: [{ index: 1, ballotCount: 3 }], election: { sealedAt: null } });
    expect((await api.call('GET', `${publicUrl(election)}/sealed-blocks`)).status).toBe(409); // no running tally

    const all = [...early, ...late];
    const statuses = await Promise.all(all.flat().map(async (p) => (await checkPart(election.electionId, p)).status));
    expect(statuses.filter((s) => s === 'verified')).toHaveLength(6); // 3 sealed ballots × 2 parts
    expect(statuses.filter((s) => s === 'pending')).toHaveLength(4); // 2 ballots still in the pool

    await close(election);
    expect((await worker.tick()).body).toMatchObject({ electionsClosed: 1, ballotsSealed: 2 });
    expect(await poolSize(election)).toBe(0);
    expect(((await election.ref.get()).data() as ElectionRecord).sealedAt).toEqual(expect.any(String));
    expect(await ledgerTypes(api, election.electionId)).toEqual([
      'election.opened',
      'ballots.sealed',
      'election.closed',
      'ballots.sealed',
      'election.sealed',
      'results.computed',
    ]);

    const blocks = (await api.call('GET', `${publicUrl(election)}/sealed-blocks`)).body as SealedBlockRecord[];
    expect(blocks.map((b) => b.ballotCount)).toEqual([3, 2]);
    expect(sealedBlockProblems(blocks)).toEqual([]);
    const published = blocks.flatMap((b) => b.commitments).sort();
    expect(published).toEqual(all.flat().map(ballotPartCommitment).sort()); // exactly the ballots cast, nothing else
    expect(JSON.stringify(blocks)).not.toContain(voters[0]!.accountId);

    for (const part of all.flat()) expect((await checkPart(election.electionId, part)).status).toBe('verified');
  });

  it('refuses a receipt whose selection was changed', async () => {
    const election = await openElection();
    const [ballot] = await castFor(voters, election);
    await close(election);
    await worker.tick();
    const forged = { ...ballot![0]!, selection: 'no' };
    const check = await checkReceiptPart({ part: forged, commitment: ballotPartCommitment(ballot![0]!), proof: null, ledger: null, keys: [], anchor: null });
    expect(check.status).toBe('failed');
  });

  it('marks an election nobody voted in as sealed, with no blocks', async () => {
    const election = await openElection();
    await close(election);
    await worker.tick();
    expect(((await election.ref.get()).data() as ElectionRecord).sealedAt).toEqual(expect.any(String));
    expect((await api.call('GET', `${publicUrl(election)}/sealed-blocks`)).body).toEqual([]);
    expect(await ledgerTypes(api, election.electionId)).toEqual([
      'election.opened',
      'election.closed',
      'election.sealed',
      'results.computed',
    ]);
  });
});

describe('sealing roll-call ballots', () => {
  it('seals them only at close, with each voter, ordered by account', async () => {
    const election = await openElection({ secrecy: 'open' });
    await castFor(voters.slice(0, 3), election);
    expect((await worker.tick()).body).toMatchObject({ ballotsSealed: 0 });

    await close(election);
    expect((await worker.tick()).body).toMatchObject({ ballotsSealed: 3 });
    const [block] = (await api.call('GET', `${publicUrl(election)}/sealed-blocks`)).body as SealedBlockRecord[];
    const accounts = block!.contests.plank!.map((p) => p.accountId);
    expect(accounts).toEqual(voters.slice(0, 3).map((v) => v.accountId).sort());
    expect(sealedBlockProblems([block!])).toEqual([]);
    expect(((await election.ref.get()).data() as ElectionRecord).sealedAt).toEqual(expect.any(String));
  });
});

describe('the published record', () => {
  it('hides drafts and rejects malformed commitments', async () => {
    const draft = await seedElection(api, { voters: [], state: 'draft' });
    expect((await api.call('GET', publicUrl(draft))).status).toBe(404);
    const election = await openElection();
    expect((await api.call('GET', `${publicUrl(election)}/proofs/not-a-commitment`)).status).toBe(400);
    expect((await api.call('GET', `${publicUrl(election)}/proofs/${'a'.repeat(64)}`)).status).toBe(404);
  });
});
