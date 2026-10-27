import { newSalt, sha256Hex } from 'ustp-audit';
import { applyAmendments, proposalContentHash, splitLines, type AmendmentChange, type LedgerEntry } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/**
 * Adopting bylaws amendments (design §6.6), end to end: two amendments go to a real vote, one passes, the results are
 * certified with the amended text's hash, the amended bylaws are served, and that exact text is published as the next
 * version, once.
 */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let ma: Member;
let ea: Member;
let auditor: Member;
let voters: Member[];

const text = 'USTP Bylaws\nArticle I. Name.\nThe party is the USTP.\nArticle II. Membership.\nMembership is open to all.\n';
const lines = splitLines(text);
const base = { version: '2026.1', contentHash: sha256Hex(text) };
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' };
const admin = (electionId: string) => `/v1/admin/elections/${electionId}`;
const decide = (by: User, id: string) => api.call('POST', `/v1/admin/approvals/${id}/decision`, by, { decision: 'approve', reason: 'ok' });
const sleepUntil = async (iso: string) => {
  const wait = Date.parse(iso) - Date.now() + 250;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
};
const replace = (line: number, now: string) => ({
  v: 1,
  base,
  changes: [{ op: 'replace', from: line, to: line, expect: [lines[line - 1]!], lines: [now] }] as AmendmentChange[],
});
const publish = (body: object) => api.call('POST', '/v1/admin/bylaws', ma, { title: 'USTP Bylaws', ...body });
const ledger = async (type: string) =>
  (await api.firebase.db.collection('audit_events').where('type', '==', type).get()).docs.map((d) => d.data() as LedgerEntry);

/** A roll-call election on two amendments, voted, closed, tallied and certified: "Membership" passes, "Name" fails. */
async function certifiedElection(): Promise<string> {
  const proposal = async (title: string, amendment: unknown) =>
    (await api.call('POST', '/v1/admin/proposals', ea, { title, body: 'Reasons.', amendment })).body.snapshotId;
  const membership = await proposal('Membership', replace(5, 'Membership is open to every adult.'));
  const name = await proposal('Name', replace(3, 'The party is the TP.'));
  const opensAt = new Date(Date.now() + 4_000).toISOString();
  const closesAt = new Date(Date.now() + 9_000).toISOString();
  const { electionId } = (await api.call('POST', '/v1/admin/elections', ea, { title: 'Bylaws vote', secrecy: 'open', opensAt, closesAt })).body;
  for (const [title, snapshotId, id] of [['Membership', membership, 'members'], ['Name', name, 'name']] as const) {
    const added = await api.call('POST', `${admin(electionId)}/contests`, ea, { kind: 'proposal', title, proposalSnapshotId: snapshotId, passRule: MAJORITY });
    expect(added.status).toBe(201);
    void id;
  }
  const roll = await api.call('POST', `${admin(electionId)}/roll`, ea, { reason: 'roll' });
  expect((await decide(auditor, roll.body.approvalId)).body.status).toBe('executed');
  const schedule = await api.call('POST', `${admin(electionId)}/schedule`, ea, { reason: 'go' });
  expect((await decide(auditor, schedule.body.id)).body.status).toBe('executed');

  await sleepUntil(opensAt);
  await worker.tick();
  const contests = (await api.call('GET', admin(electionId), ea)).body.contests as { contestId: string; title: string }[];
  const idOf = (title: string) => contests.find((c) => c.title === title)!.contestId;
  for (const voter of voters) {
    const ballot = (await api.call('GET', `/v1/elections/${electionId}/ballot`, voter)).body;
    const parts = [
      { v: 1, electionId, contestId: idOf('Membership'), selection: 'yes', salt: newSalt() },
      { v: 1, electionId, contestId: idOf('Name'), selection: 'no', salt: newSalt() },
    ];
    expect((await api.call('POST', `/v1/elections/${electionId}/ballots`, voter, { definitionHash: ballot.definitionHash, parts })).status).toBe(201);
  }
  await sleepUntil(closesAt);
  for (let i = 0; i < 3 && !(await api.firebase.db.collection('results').doc(electionId).get()).exists; i++) await worker.tick();

  expect((await api.call('GET', `/v1/public/elections/${electionId}/amended-bylaws`)).status).toBe(409);
  const certify = await api.call('POST', `${admin(electionId)}/certify`, ea, { reason: 'counted' });
  expect((await decide(auditor, certify.body.id)).body.status).toBe('executed');
  return electionId;
}

beforeEach(async () => {
  await resetEmulators();
  const [sa1] = await api.systemAdmins();
  ma = await api.member('membership.admin@example.test');
  ea = await api.member('election.admin@example.test');
  auditor = await api.member('auditor@example.test');
  await api.grant(ma.accountId, 'membership_admin', sa1);
  await api.grant(ea.accountId, 'election_admin', sa1);
  await api.grant(auditor.accountId, 'auditor', sa1);
  voters = [];
  for (const n of [1, 2, 3]) {
    const v = await api.member(`v${n}@example.test`);
    await api.firebase.db.collection('members').doc(v.accountId).set({ accountId: v.accountId, status: 'active', legalName: `V${n}` });
    voters.push(v);
  }
  expect((await publish({ version: '2026.1', text, amends: null })).status).toBe(201);
});

describe('adopting bylaws amendments', () => {
  it('certifies the passed amendments with their hash, serves the amended bylaws and publishes them once', async () => {
    const electionId = await certifiedElection();
    const amended = text.replace('open to all', 'open to every adult');

    const [certified] = await ledger('results.certified');
    expect(certified!.payload.bylaws).toEqual({ base, contentHash: sha256Hex(amended) });

    const view = (await api.call('GET', `/v1/public/elections/${electionId}/amended-bylaws`)).body;
    expect(view).toMatchObject({
      electionId,
      base: { version: '2026.1', contentHash: base.contentHash },
      contests: [
        { title: 'Membership', outcome: 'passed', proposal: { title: 'Membership', amendment: replace(5, 'Membership is open to every adult.') } },
        { title: 'Name', outcome: 'failed', proposal: null },
      ],
      text: amended,
      contentHash: sha256Hex(amended),
      changed: true,
      baseIsCurrent: true,
      adoptedAs: null,
    });

    const adopt = { version: '2026.2', amends: '2026.1', changeNote: 'Adopted in the bylaws vote.', adoptedIn: { electionId } };
    expect(await publish({ ...adopt, text: `${amended}Extra.\n` })).toMatchObject({
      status: 409,
      body: { detail: 'the text is not exactly what the election adopted; take it from the amended bylaws' },
    });
    const published = await publish({ ...adopt, text: amended });
    expect(published.body).toMatchObject({ version: '2026.2', contentHash: sha256Hex(amended), adoptedIn: { electionId, resultsHash: view.resultsHash } });
    expect((await ledger('bylaws.published')).at(-1)!.payload).toMatchObject({ version: '2026.2', adoptedIn: { electionId, resultsHash: view.resultsHash } });
    expect((await api.call('GET', `/v1/public/elections/${electionId}/amended-bylaws`)).body).toMatchObject({ adoptedAs: '2026.2', baseIsCurrent: false });
    expect((await publish({ ...adopt, version: '2026.3', amends: '2026.2', text: amended })).body.detail).toBe(
      "the election's amendments were already published as version 2026.2",
    );

    // What anyone can check from public data (the verify CLI does the same): the passed amendment is the text the frozen
    // definition commits to, and applying it to the base gives the served text and the ledgered hash.
    const record = (await api.call('GET', `/v1/public/elections/${electionId}`)).body;
    const passed = view.contests[0].proposal;
    const frozen = record.definition.contests.find((c: { contestId: string }) => c.contestId === view.contests[0].contestId).proposal;
    expect(proposalContentHash(passed.title, passed.body, passed.amendment)).toBe(frozen.contentHash);
    expect(frozen.amendsBylaws).toEqual(base);
    const baseRecord = (await api.call('GET', '/v1/bylaws/2026.1')).body;
    expect(applyAmendments(baseRecord, [{ id: 'Membership', amendment: passed.amendment }])).toEqual({ ok: true, text: view.text });
    expect(sha256Hex(view.text)).toBe((certified!.payload.bylaws as { contentHash: string }).contentHash);
  });

  it('serves nothing for an election that amends no bylaws, and adopts nothing from one', async () => {
    const plain = (await api.call('POST', '/v1/admin/proposals', ea, { title: 'Plank 12', body: 'Adopt it.' })).body;
    const opensAt = new Date(Date.now() + 86_400_000).toISOString();
    const { electionId } = (
      await api.call('POST', '/v1/admin/elections', ea, { title: 'Platform', secrecy: 'open', opensAt, closesAt: new Date(Date.parse(opensAt) + 3_600_000).toISOString() })
    ).body;
    await api.call('POST', `${admin(electionId)}/contests`, ea, { kind: 'proposal', title: 'Plank 12', proposalSnapshotId: plain.snapshotId, passRule: MAJORITY });
    const roll = await api.call('POST', `${admin(electionId)}/roll`, ea, { reason: 'roll' });
    await decide(auditor, roll.body.approvalId);
    const schedule = await api.call('POST', `${admin(electionId)}/schedule`, ea, { reason: 'go' });
    await decide(auditor, schedule.body.id);
    expect(await api.call('GET', `/v1/public/elections/${electionId}/amended-bylaws`)).toMatchObject({
      status: 404,
      body: { detail: 'this election amends no bylaws' },
    });
    expect((await publish({ version: '2026.2', amends: '2026.1', text, adoptedIn: { electionId } })).body.detail).toMatch(/only a certified election/);
  });
});
