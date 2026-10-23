import {
  addMonths,
  checkResults,
  type ElectionRecord,
  type PositionsView,
  type PositionTermRecord,
  type ResultsEvidence,
  type ResultsRecord,
} from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalsService } from './administration/approvals.service.js';
import { BALLOT_POOL_KEYS, type BallotPoolKeys } from './infra/ballot-pool.js';
import { closeNow, ledgerTypes, minutes, seedElection, seededBallot, type SeededElection } from './testing/elections.js';
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
  await api.grant(ea.accountId, 'election_admin', sa1);
  await api.grant(auditor.accountId, 'auditor', sa1);
  voters = [];
  for (let i = 0; i < 4; i++) voters.push(await api.member(`v${i}@example.test`));
});

const decide = (by: User, id: string, decision: 'approve' | 'reject' = 'approve') =>
  api.call('POST', `/v1/admin/approvals/${id}/decision`, by, { decision, reason: 'checked' });

/** Defines an office as the Election Admin; it takes effect at once. */
async function defineOffice(positionId: string, termMonths = 24) {
  const res = await api.call('POST', '/v1/admin/positions', ea, { positionId, title: 'Chair', seats: 1, termMonths, reason: 'bylaws art. 4' });
  expect(res.status).toBe(201);
}

/** A seeded secret election with every voter's ballot cast (Blair wins the chair), closed, sealed and tallied. */
async function talliedElection(opts: Partial<Parameters<typeof seedElection>[1]> = {}): Promise<SeededElection> {
  const election = await seedElection(api, { voters: voters.map((v) => v.accountId), kAnonymity: 2, ...opts });
  expect((await worker.tick()).body).toMatchObject({ electionsOpened: 1 });
  const { definitionHash } = (await api.call('GET', `${election.url}/ballot`, voters[0])).body;
  for (const voter of voters) {
    const parts = seededBallot(election.electionId);
    expect((await api.call('POST', `${election.url}/ballots`, voter, { definitionHash, parts })).status).toBe(201);
  }
  await closeNow(api, election);
  expect((await worker.tick()).body).toMatchObject({ resultsComputed: 1 });
  return election;
}

const certifyUrl = (e: SeededElection) => `/v1/admin/elections/${e.electionId}/certify`;
const publicUrl = (e: SeededElection) => `/v1/public/elections/${e.electionId}`;

describe('certification', () => {
  it('certifies the results with two people, creates the term of office and destroys the pool key', async () => {
    await defineOffice('chair', 24);
    const election = await talliedElection({ chairPositionId: 'chair' });
    const provisional = (await api.call('GET', `${publicUrl(election)}/results`)).body as ResultsRecord;

    const req = await api.call('POST', certifyUrl(election), ea, { reason: 'count reviewed' });
    expect(req).toMatchObject({ status: 201, body: { action: 'election.certify', payload: { resultsHash: provisional.resultsHash } } });
    expect((await decide(ea, req.body.id)).status).toBe(403); // not the requester, and not an Auditor
    expect((await decide(auditor, req.body.id)).body.status).toBe('executed');

    const results = (await api.call('GET', `${publicUrl(election)}/results`)).body as ResultsRecord;
    expect(results).toMatchObject({ status: 'certified', resultsHash: provisional.resultsHash, certifiedAt: expect.any(String) });
    expect(((await election.ref.get()).data() as ElectionRecord).state).toBe('certified');

    const { positions, terms } = (await api.call('GET', '/v1/public/positions')).body as PositionsView;
    expect(positions.map((p) => p.positionId)).toEqual(['chair']);
    expect(terms).toEqual([
      expect.objectContaining({
        positionId: 'chair',
        electionId: election.electionId,
        holderName: 'Blair Chen',
        status: 'active',
        resultsHash: results.resultsHash,
        endsAt: addMonths(results.certifiedAt!, 24),
      }),
    ]);

    // The pool key goes on the next tick; the record and the ledger say so.
    const { poolKeyVersion } = (await election.ref.get()).data() as ElectionRecord;
    expect((await worker.tick()).body).toMatchObject({ poolKeysDestroyed: 1 });
    expect(await worker.app.get<BallotPoolKeys>(BALLOT_POOL_KEYS).isReady(poolKeyVersion!)).toBe(false);
    expect(((await api.call('GET', publicUrl(election))).body).election.poolKeyDestroyedAt).toEqual(expect.any(String));
    const types = await ledgerTypes(api, election.electionId);
    expect(types.slice(types.indexOf('results.computed'))).toEqual([
      'results.computed',
      'approval.requested',
      'approval.decided',
      'results.certified',
      'election.pool_key_destroyed',
    ]);

    // Anyone can check the certified results through to the signed, anchored ledger.
    const get = async (url: string) => {
      const res = await api.call('GET', url);
      return res.status === 200 ? res.body : null;
    };
    const evidence: ResultsEvidence = {
      election: await get(publicUrl(election)),
      results,
      blocks: await get(`${publicUrl(election)}/sealed-blocks`),
      keys: await get('/v1/public/ledger/keys'),
      ledger: await get(`/v1/public/ledger/entries/${results.ledgerSeq}`),
      anchor: await get('/v1/public/anchors/latest'),
      certification: await get(`/v1/public/ledger/entries/${results.certifiedLedgerSeq}`),
    };
    const check = await checkResults(evidence);
    expect(check.steps.filter((s) => s.ok !== true)).toEqual([]);
    expect(check.steps.some((s) => s.label.startsWith('Certified by two people'))).toBe(true);

    expect((await api.call('POST', certifyUrl(election), ea, { reason: 'again' })).status).toBe(409);
  });

  it('refuses before the results exist, for a candidate, and when the results changed', async () => {
    const early = await seedElection(api, { voters: voters.map((v) => v.accountId), state: 'closed', opensAt: minutes(-60), closesAt: minutes(-1) });
    expect((await api.call('POST', certifyUrl(early), ea, { reason: 'too soon' })).status).toBe(409);

    const election = await talliedElection({ blairAccountId: auditor.accountId }); // the Auditor stands for chair
    const req = await api.call('POST', certifyUrl(election), ea, { reason: 'count reviewed' });
    expect((await decide(auditor, req.body.id)).body.detail).toMatch(/candidate/);

    await api.firebase.db.collection('results').doc(election.electionId).update({ resultsHash: 'f'.repeat(64) });
    const second = await api.member('auditor2@example.test');
    await api.grant(second.accountId, 'auditor', sa1);
    expect((await decide(second, req.body.id)).body.detail).toMatch(/no longer the ones/);
  });

  it('refuses an election whose office does not exist', async () => {
    const election = await talliedElection({ chairPositionId: 'treasurer' });
    expect((await api.call('POST', certifyUrl(election), ea, { reason: 'count reviewed' })).body.detail).toMatch(/treasurer.*does not exist/);
  });
});

describe('offices and terms', () => {
  const chair = { positionId: 'chair', title: 'Chair', description: '', seats: 1, termMonths: 24 };

  it('defines and changes an office at once, with no approval, ledgered publicly with the admin as actor', async () => {
    const res = await api.call('POST', '/v1/admin/positions', ea, { ...chair, reason: 'bylaws art. 4' });
    expect(res).toMatchObject({ status: 201, body: { ...chair, approvalId: null, definedAt: expect.any(String) } });
    expect((await api.call('GET', '/v1/public/positions')).body.positions).toEqual([res.body]);
    expect((await api.call('GET', '/v1/admin/approvals', auditor)).body).toEqual([]);

    const changed = await api.call('POST', '/v1/admin/positions', ea, { ...chair, title: 'Party Chair', termMonths: 36, reason: 'art. 4 amended' });
    expect(changed.body).toMatchObject({ title: 'Party Chair', termMonths: 36 });
    expect((await api.call('GET', '/v1/public/positions')).body.positions).toEqual([changed.body]);

    const entries = (await api.firebase.db.collection('audit_events').where('type', '==', 'position.defined').get()).docs;
    expect(entries.map((d) => d.data()).sort((x, y) => x.seq - y.seq)).toEqual([
      expect.objectContaining({ actor: ea.accountId, subject: 'chair', payload: { ...chair, reason: 'bylaws art. 4' } }),
      expect.objectContaining({ actor: ea.accountId, payload: expect.objectContaining({ title: 'Party Chair', reason: 'art. 4 amended' }) }),
    ]);
  });

  it('lets only Membership and Election Admins define offices', async () => {
    const ma = await api.member('membership.admin@example.test');
    await api.grant(ma.accountId, 'membership_admin', sa1);
    expect((await api.call('POST', '/v1/admin/positions', ma, { ...chair, reason: 'x' })).status).toBe(201);
    for (const who of [auditor, sa1, voters[0]!]) {
      expect((await api.call('POST', '/v1/admin/positions', who, { ...chair, title: 'Mine', reason: 'x' })).status).toBe(403);
    }
    expect((await api.call('GET', '/v1/public/positions')).body.positions[0].title).toBe('Chair');
  });

  it('still decides office definitions requested before offices were defined directly', async () => {
    const approvals = api.app.get(ApprovalsService);
    const old = await api.firebase.db.runTransaction((tx) =>
      approvals.createRequest(tx, {
        action: 'position.modify',
        subject: 'chair',
        payload: { change: 'define', position: chair },
        reason: 'made before the change',
        requestedBy: ea.accountId,
      }),
    );
    expect((await decide(auditor, old.id)).body.status).toBe('executed');
    expect((await api.call('GET', '/v1/public/positions')).body.positions).toEqual([
      { ...chair, approvalId: old.id, definedAt: expect.any(String) },
    ]);
  });

  it('links candidate contests only to offices that exist', async () => {
    await defineOffice('chair');
    const { electionId } = (
      await api.call('POST', '/v1/admin/elections', ea, { title: 'Officers', secrecy: 'secret', opensAt: minutes(60 * 24), closesAt: minutes(60 * 48) })
    ).body;
    const url = `/v1/admin/elections/${electionId}/contests`;
    expect((await api.call('POST', url, ea, { kind: 'irv', title: 'Chair', positionId: 'nope' })).status).toBe(400);
    expect((await api.call('POST', url, ea, { kind: 'irv', title: 'Chair', positionId: 'chair' })).body).toMatchObject({ positionId: 'chair' });
  });

  it('ends a term early only with two people', async () => {
    await defineOffice('chair');
    const term: PositionTermRecord = {
      termId: 't1',
      positionId: 'chair',
      electionId: 'e1',
      contestId: 'chair',
      candidateId: 'blair',
      holderName: 'Blair Chen',
      accountId: null,
      startsAt: minutes(-60),
      endsAt: minutes(60 * 24 * 365),
      resultsHash: '0'.repeat(64),
      status: 'active',
      endedAt: null,
      endReason: null,
    };
    await api.firebase.db.collection('position_terms').doc('t1').set(term);
    const req = await api.call('POST', '/v1/admin/positions/chair/terms/t1/end', ea, { reason: 'resigned' });
    expect(req.status).toBe(201);
    expect((await api.call('GET', '/v1/public/positions')).body.terms).toHaveLength(1);
    expect((await decide(auditor, req.body.id)).body.status).toBe('executed');
    expect((await api.call('GET', '/v1/public/positions')).body.terms).toEqual([]);
    const ended = (await api.call('GET', '/v1/admin/positions', auditor)).body.terms[0];
    expect(ended).toMatchObject({ status: 'ended', endReason: 'resigned', endedAt: expect.any(String) });
  });
});

describe('pool key destruction', () => {
  it('destroys the key of a cancelled election, whose ballots will never be counted', async () => {
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId) });
    await worker.tick(); // creates the key and opens the election
    const { poolKeyVersion } = (await election.ref.get()).data() as ElectionRecord;
    await election.ref.update({ state: 'cancelled', cancelledAt: new Date().toISOString() });
    expect((await worker.tick()).body).toMatchObject({ poolKeysDestroyed: 1 });
    expect(await worker.app.get<BallotPoolKeys>(BALLOT_POOL_KEYS).isReady(poolKeyVersion!)).toBe(false);
    expect((await worker.tick()).body).toMatchObject({ poolKeysDestroyed: 0 });
  });
});
