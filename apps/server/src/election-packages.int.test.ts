import { sha256Hex } from 'ustp-audit';
import { proposalContentHash, splitLines, type ElectionDetail, type ElectionPackage } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

/**
 * Election packages (design §6.7): a whole draft imported from one `ustp.election` file, in one transaction, under the
 * piecewise editor's rules, and any election exported as one.
 */

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let ma: Member;
let ea: Member;
let auditor: Member;
let ada: Member;

const bylaws = 'USTP Bylaws\nArticle I. Name.\nThe party is the USTP.\n';
const base = { version: '2026.1', contentHash: sha256Hex(bylaws) };
const amendment = {
  v: 1,
  base,
  changes: [{ op: 'replace', from: 3, to: 3, expect: [splitLines(bylaws)[2]], lines: ['The party is the US Transhumanist Party.'] }],
};
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' };

/** A hand-written file: a rehearsal-style window, names only, an office, a member standing, an amendment. */
const pkg = () => ({
  format: 'ustp.election',
  v: 1,
  title: 'Spring vote',
  secrecy: 'secret',
  window: { opensInSeconds: 3600, votingSeconds: 86_400 },
  contests: [
    { id: 'chair', kind: 'irv', title: 'Chair', positionId: 'chair', candidates: ['Grace', { id: 'ada', name: 'Ada', accountId: ada.accountId }] },
    { id: 'name', kind: 'proposal', title: 'Our name', passRule: MAJORITY, proposal: { body: 'Spell it out.', source: 'minutes', amendment } },
    { kind: 'proposal', title: 'Plank 12', passRule: MAJORITY, proposal: { title: 'Platform plank 12', body: 'Adopt it.' } },
  ],
});
const importPackage = (body: unknown, by: User = ea) => api.call('POST', '/v1/admin/elections/import', by, body);
const counts = async () => {
  const [elections, texts] = await Promise.all(['elections', 'proposal_snapshots'].map((c) => api.firebase.db.collection(c).count().get()));
  return { elections: elections!.data().count, texts: texts!.data().count };
};

beforeEach(async () => {
  await resetEmulators();
  const [sa1] = await api.systemAdmins();
  ma = await api.member('membership.admin@example.test');
  ea = await api.member('election.admin@example.test');
  auditor = await api.member('auditor@example.test');
  ada = await api.member('ada@example.test');
  await api.firebase.db.collection('members').doc(ada.accountId).set({ accountId: ada.accountId, status: 'active', legalName: 'Ada', state: 'CA' });
  await api.grant(ma.accountId, 'membership_admin', sa1);
  await api.grant(ea.accountId, 'election_admin', sa1);
  await api.grant(auditor.accountId, 'auditor', sa1);
  expect((await api.call('POST', '/v1/admin/bylaws', ma, { version: '2026.1', title: 'USTP Bylaws', text: bylaws, amends: null })).status).toBe(201);
  expect((await api.call('POST', '/v1/admin/positions', ea, { positionId: 'chair', title: 'Chair', seats: 1, termMonths: 24, reason: 'art. 4' })).status).toBe(201);
});

describe('election packages', () => {
  it('import a whole draft from one file, and export it so that it imports to the same definition', async () => {
    const before = Date.now();
    const res = await importPackage(pkg());
    expect(res.status).toBe(201);
    const detail = res.body as ElectionDetail;
    expect(detail.election).toMatchObject({ title: 'Spring vote', secrecy: 'secret', kAnonymity: 10, state: 'draft', createdBy: ea.accountId });
    expect(Date.parse(detail.election.opensAt) - before).toBeGreaterThanOrEqual(3_600_000);
    expect(Date.parse(detail.election.closesAt) - Date.parse(detail.election.opensAt)).toBe(86_400_000);
    expect(detail.contests.map((c) => [c.order, c.contestId, c.title, c.positionId])).toEqual([
      [1, 'chair', 'Chair', 'chair'],
      [2, 'name', 'Our name', null],
      [3, expect.stringMatching(/^[A-Za-z0-9]{20}$/), 'Plank 12', null],
    ]);
    expect(detail.contests[0]!.spec).toMatchObject({ kind: 'irv', candidates: [expect.any(String), 'ada'] });
    expect(detail.candidates.find((k) => k.candidateId === 'ada')).toMatchObject({ name: 'Ada', accountId: ada.accountId, contestId: 'chair' });
    expect(detail.proposals.map((p) => [p.title, p.source, p.contentHash]).sort()).toEqual(
      [
        ['Our name', 'minutes', proposalContentHash('Our name', 'Spell it out.', amendment as never)],
        ['Platform plank 12', null, proposalContentHash('Platform plank 12', 'Adopt it.')],
      ].sort(),
    );
    expect(detail.problems).toEqual([]);

    // Auditors read it as a file too; the file names where it came from.
    const exported = await api.call('GET', `/v1/admin/elections/${detail.election.electionId}/package`, auditor);
    expect(exported.status).toBe(200);
    const file = exported.body as ElectionPackage;
    expect(file).toMatchObject({
      format: 'ustp.election',
      window: { opensAt: detail.election.opensAt, closesAt: detail.election.closesAt },
      contests: [
        { id: 'chair', candidates: [{ name: 'Grace' }, { id: 'ada', name: 'Ada', accountId: ada.accountId }] },
        { id: 'name', proposal: { title: 'Our name', source: 'minutes', amendment } },
        { title: 'Plank 12', proposal: { title: 'Platform plank 12', body: 'Adopt it.' } },
      ],
      exportedFrom: { electionId: detail.election.electionId, definitionHash: detail.definitionHash },
    });

    // Importing the export reuses the captured texts, keeps every ID, and differs only in the election's own ID.
    const textsBefore = (await counts()).texts;
    const again = (await importPackage(file)).body as ElectionDetail;
    expect((await counts()).texts).toBe(textsBefore);
    expect(again.contests).toEqual(detail.contests);
    expect(again.candidates).toEqual(detail.candidates.map((k) => ({ ...k })));
    expect(again.proposals.map((p) => p.snapshotId).sort()).toEqual(detail.proposals.map((p) => p.snapshotId).sort());
    expect(again.election.electionId).not.toBe(detail.election.electionId);
  });

  it('writes nothing when any part is refused', async () => {
    const empty = await counts();
    const withContest = (i: number, change: object) => {
      const p = pkg();
      p.contests[i] = { ...p.contests[i], ...change } as never;
      return p;
    };

    // Candidates are linked only to Active members' accounts, as in the editor.
    for (const accountId of ['0190f2a3-0000-7000-8000-000000000000', auditor.accountId]) {
      expect(await importPackage(withContest(0, { candidates: ['Grace', { name: 'Nobody', accountId }] }))).toMatchObject({
        status: 400,
        body: { detail: `account ${accountId} is not an Active member` },
      });
    }
    expect((await importPackage(withContest(0, { positionId: 'treasurer' }))).body.detail).toBe('there is no office treasurer');
    expect((await importPackage(withContest(1, { proposal: { snapshotId: 'gone' } }))).body.detail).toBe('there is no proposal text gone');
    expect(await importPackage(withContest(0, { candidates: [{ name: 'Me', accountId: ea.accountId }] }))).toMatchObject({
      status: 403,
      body: { detail: 'you cannot add yourself as a candidate in an election you administer' },
    });
    const stale = { ...amendment, base: { version: '2025.1', contentHash: base.contentHash } };
    expect(await importPackage(withContest(1, { proposal: { body: 'Spell it out.', amendment: stale } }))).toMatchObject({
      status: 409,
      body: { detail: 'the proposals amend bylaws version 2025.1, but version 2026.1 is current; write them again against it' },
    });
    expect(await importPackage(pkg(), auditor)).toMatchObject({ status: 403 });
    expect(await counts()).toEqual(empty);
  });

  it('lists schema problems by path, and imports a past window as a problem to fix', async () => {
    const bad = { ...pkg(), window: { opensAt: '2026-01-01T00:00:00Z' }, contests: [{ kind: 'irv', title: '', candidates: [] }] };
    const refused = await importPackage(bad);
    expect(refused.status).toBe(400);
    expect(refused.body.errors).toEqual(
      expect.arrayContaining([
        { path: 'window.closesAt', message: 'give closesAt with opensAt' },
        { path: 'contests.0.title', message: 'enter a title' },
      ]),
    );

    const past = { ...pkg(), window: { opensAt: '2026-01-01T00:00:00Z', closesAt: '2026-01-02T00:00:00Z' } };
    const imported = await importPackage(past);
    expect(imported.status).toBe(201);
    expect(imported.body.problems).toContain('voting must open in the future');
  });
});
