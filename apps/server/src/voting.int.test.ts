import { newSalt, type BallotPart } from 'ustp-audit';
import {
  buildDefinition,
  commitmentsOf,
  definitionHash,
  proposalContentHash,
  rollMerkleRoot,
  sortRoll,
  uuidv7,
  type CandidateRecord,
  type ContestRecord,
  type ElectionRecord,
  type ElectionState,
  type PoolEntryRecord,
  type ProposalSnapshotRecord,
  type RollSnapshotRecord,
  type Secrecy,
} from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BALLOT_POOL_KEYS, decryptBallot, type BallotPoolKeys } from './infra/ballot-pool.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let voter: Member;
let outsider: Member;

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' as const }, base: 'yes_no' as const };

/**
 * Writes an election as scheduling would leave it (frozen definition hash, approved roll), in any state. Scheduling
 * itself is covered in scheduling.int.test.ts; this lets tests choose the voting window freely.
 */
async function seedElection(opts: { secrecy?: Secrecy; state?: ElectionState; opensAt?: string; closesAt?: string }) {
  const db = api.firebase.db;
  const electionId = uuidv7();
  const now = new Date().toISOString();
  const body = 'The party supports the right to repair.';
  const proposal: ProposalSnapshotRecord = {
    snapshotId: `p-${electionId}`,
    title: 'Plank 12',
    body,
    source: null,
    contentHash: proposalContentHash('Plank 12', body),
    capturedAt: now,
    capturedBy: 'seed',
  };
  const contests: ContestRecord[] = [
    { contestId: 'plank', order: 1, title: 'Plank 12', description: '', spec: { kind: 'proposal', id: 'plank', passRule: MAJORITY }, proposalSnapshotId: proposal.snapshotId },
    { contestId: 'chair', order: 2, title: 'Chair', description: '', spec: { kind: 'irv', id: 'chair', candidates: ['alex', 'blair'] }, proposalSnapshotId: null },
  ];
  const candidates: CandidateRecord[] = [
    { candidateId: 'alex', contestId: 'chair', name: 'Alex Rivera', statement: null, accountId: null },
    { candidateId: 'blair', contestId: 'chair', name: 'Blair Chen', statement: null, accountId: null },
  ];
  const accountIds = sortRoll([voter.accountId]);
  const roll: RollSnapshotRecord = {
    snapshotId: `r-${electionId}`,
    electionId,
    criteria: { status: 'active' },
    asOf: now,
    accountIds,
    count: accountIds.length,
    merkleRoot: rollMerkleRoot(electionId, accountIds),
    status: 'approved',
    requestedBy: 'seed',
    requestedAt: now,
    approvalId: 'seed',
    decidedBy: 'seed',
    decidedAt: now,
    signature: null,
  };
  const unhashed: ElectionRecord = {
    electionId,
    title: 'Officers',
    description: '',
    secrecy: opts.secrecy ?? 'secret',
    opensAt: opts.opensAt ?? minutes(-1),
    closesAt: opts.closesAt ?? minutes(60),
    kAnonymity: 2,
    state: opts.state ?? 'scheduled',
    createdBy: 'seed',
    createdAt: now,
    updatedAt: now,
    definitionHash: null,
    rollSnapshotId: roll.snapshotId,
    tieBreakSeedCommitment: '0'.repeat(64),
    tieBreakSeedRef: null,
    scheduledAt: now,
    cancelledAt: null,
    poolKeyVersion: null,
    openedAt: null,
    closedAt: null,
  };
  const election = { ...unhashed, definitionHash: definitionHash(buildDefinition(unhashed, contests, candidates, [proposal])) };
  const ref = db.collection('elections').doc(electionId);
  await Promise.all([
    db.collection('proposal_snapshots').doc(proposal.snapshotId).set(proposal),
    db.collection('eligibility_snapshots').doc(roll.snapshotId).set(roll),
    ref.set(election),
    ...contests.map((c) => ref.collection('contests').doc(c.contestId).set(c)),
    ...candidates.map((k) => ref.collection('candidates').doc(k.candidateId).set(k)),
  ]);
  return { electionId, url: `/v1/elections/${electionId}`, ref };
}

/** A scheduled election whose opening time has passed, opened by a worker tick. */
async function openElection(secrecy: Secrecy = 'secret') {
  const seeded = await seedElection({ secrecy });
  expect((await worker.tick()).body).toMatchObject({ electionsOpened: 1 });
  return seeded;
}

function ballot(electionId: string): BallotPart[] {
  return [
    { v: 1, electionId, contestId: 'plank', selection: 'yes', salt: newSalt() },
    { v: 1, electionId, contestId: 'chair', selection: ['blair', 'alex'], salt: newSalt() },
  ];
}

const cast = async (who: User, url: string, parts: BallotPart[], hash?: string) =>
  api.call('POST', `${url}/ballots`, who, {
    definitionHash: hash ?? (await api.call('GET', `${url}/ballot`, voter)).body.definitionHash,
    parts,
  });

async function ledgerTypes(electionId: string) {
  const snap = await api.firebase.db.collection('audit_events').where('subject', '==', electionId).orderBy('seq').get();
  return snap.docs.map((d) => d.data().type);
}

beforeEach(async () => {
  await resetEmulators();
  voter = await api.member('voter@example.test');
  outsider = await api.member('outsider@example.test');
});

describe('election clock', () => {
  it('prepares the pool key, then opens and closes the election on time', async () => {
    const due = await seedElection({});
    const later = await seedElection({ opensAt: minutes(60 * 24), closesAt: minutes(60 * 48) });
    expect((await worker.tick()).body).toMatchObject({ poolKeysCreated: 2, electionsOpened: 1, electionsClosed: 0 });

    const opened = (await due.ref.get()).data() as ElectionRecord;
    expect(opened).toMatchObject({ state: 'open', openedAt: expect.any(String), poolKeyVersion: expect.stringMatching(/^emulator\//) });
    expect((await later.ref.get()).data()).toMatchObject({ state: 'scheduled', poolKeyVersion: expect.any(String) });
    expect(await ledgerTypes(due.electionId)).toEqual(['election.opened']);

    await due.ref.update({ closesAt: minutes(-1) });
    expect((await worker.tick()).body).toMatchObject({ poolKeysCreated: 0, electionsOpened: 0, electionsClosed: 1 });
    expect((await due.ref.get()).data()).toMatchObject({ state: 'closed', closedAt: expect.any(String) });
    expect(await ledgerTypes(due.electionId)).toEqual(['election.opened', 'election.closed']);
  });

  it('opens roll-call elections without a pool key', async () => {
    const { ref } = await seedElection({ secrecy: 'open' });
    expect((await worker.tick()).body).toMatchObject({ poolKeysCreated: 0, electionsOpened: 1 });
    expect((await ref.get()).data()).toMatchObject({ state: 'open', poolKeyVersion: null });
  });

  it('will not open an election whose stored definition changed after scheduling', async () => {
    const { ref } = await seedElection({ secrecy: 'open' });
    await ref.collection('contests').doc('chair').update({ title: 'Chair (edited)' });
    expect((await worker.tick()).status).toBe(500);
    expect((await ref.get()).data()).toMatchObject({ state: 'scheduled' });
  });
});

describe('casting', () => {
  it('shows elections only to voters on their roll', async () => {
    const { electionId, url } = await openElection();
    expect((await api.call('GET', '/v1/elections', voter)).body).toEqual([
      expect.objectContaining({ electionId, state: 'open', secrecy: 'secret', castAt: null }),
    ]);
    expect((await api.call('GET', '/v1/elections', outsider)).body).toEqual([]);

    const view = (await api.call('GET', `${url}/ballot`, voter)).body;
    expect(view.definition.contests.map((c: { contestId: string }) => c.contestId)).toEqual(['plank', 'chair']);
    expect(view.proposals[0]).toMatchObject({ title: 'Plank 12', body: 'The party supports the right to repair.' });
    expect((await api.call('GET', `${url}/ballot`, outsider)).status).toBe(403);
  });

  it('stores a secret ballot encrypted, with nothing but the fact of voting next to the voter', async () => {
    const { electionId, url, ref } = await openElection();
    const parts = ballot(electionId);
    const res = await cast(voter, url, parts);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ electionId, castAt: expect.any(String), commitments: commitmentsOf(parts) });

    const participation = await ref.collection('participation').doc(voter.accountId).get();
    expect(participation.data()).toEqual({ accountId: voter.accountId, castAt: res.body.castAt });
    const pool = await ref.collection('ballot_pool').get();
    expect(pool.size).toBe(1);
    const entry = pool.docs[0]!.data() as PoolEntryRecord;
    expect(Object.keys(entry).sort()).toEqual(['ciphertext', 'iv', 'keyVersion', 'tag', 'v', 'wrappedKey']);
    expect(JSON.stringify(entry)).not.toContain(voter.accountId);

    const keys = worker.app.get<BallotPoolKeys>(BALLOT_POOL_KEYS);
    expect(JSON.parse((await decryptBallot(keys, electionId, entry)).toString())).toEqual(parts);

    expect(await cast(voter, url, ballot(electionId))).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/already voted/) } });
    expect((await api.call('GET', `${url}/participation/me`, voter)).body).toEqual({ castAt: res.body.castAt });
    expect((await api.call('GET', '/v1/elections', voter)).body[0].castAt).toBe(res.body.castAt);
    expect((await ref.collection('ballot_pool').get()).size).toBe(1);
  });

  it('refuses voters off the roll, stale ballots and invalid selections, recording nothing', async () => {
    const { electionId, url, ref } = await openElection();
    expect((await cast(outsider, url, ballot(electionId))).status).toBe(403);
    expect((await cast(voter, url, ballot(electionId), 'f'.repeat(64))).status).toBe(409);

    const [plank, chair] = ballot(electionId);
    const invalid = await cast(voter, url, [{ ...plank!, selection: 'maybe' }, chair!]);
    expect(invalid).toMatchObject({ status: 400, body: { detail: expect.stringMatching(/Plank 12/) } });
    expect((await cast(voter, url, [{ ...chair!, contestId: 'treasurer' }])).status).toBe(400);
    expect((await cast(voter, url, [plank!, { ...plank!, salt: newSalt() }])).status).toBe(400);
    expect((await cast(voter, url, [])).status).toBe(400);
    expect((await cast(voter, url, [{ ...plank!, electionId: 'other' }])).status).toBe(400);

    expect((await ref.collection('participation').get()).size).toBe(0);
    expect((await ref.collection('ballot_pool').get()).size).toBe(0);
  });

  it('accepts ballots only while the election is open', async () => {
    const scheduled = await seedElection({ opensAt: minutes(60), closesAt: minutes(120) });
    expect((await api.call('GET', `${scheduled.url}/ballot`, voter)).status).toBe(200);
    expect(await cast(voter, scheduled.url, ballot(scheduled.electionId))).toMatchObject({
      status: 409,
      body: { detail: 'voting has not opened yet' },
    });

    const closed = await seedElection({ state: 'closed', opensAt: minutes(-120), closesAt: minutes(-60) });
    expect((await cast(voter, closed.url, ballot(closed.electionId))).status).toBe(409);

    const draft = await seedElection({ state: 'draft' });
    expect((await api.call('GET', `${draft.url}/ballot`, voter)).status).toBe(404);
  });

  it('records roll-call ballots with the voter and keeps no pool', async () => {
    const { electionId, url, ref } = await openElection('open');
    const parts = ballot(electionId);
    expect((await cast(voter, url, parts)).status).toBe(201);
    expect((await ref.collection('participation').doc(voter.accountId).get()).data()).toMatchObject({ parts });
    expect((await ref.collection('ballot_pool').get()).size).toBe(0);
  });
  // The revocation check on casting is unit-tested (auth.test.ts): the Auth emulator checks revocation on every
  // verification, so here it would pass whether or not the route asked for it.
});
