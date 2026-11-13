import { checkResults, TEST_VOTER_DELETION_REASON, type PersonaSummary, type ResultsRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeNow, minutes, seedElection, seededBallot } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  process.env.TESTING_MODE = 'true';
  api = await TestApi.start();
});
afterAll(async () => {
  await api.close();
  delete process.env.TESTING_MODE;
});

let sa1: User & { accountId: string };
let sa2: User & { accountId: string };
beforeEach(async () => {
  await resetEmulators();
  [sa1, sa2] = await api.systemAdmins();
});

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const as = (accountId: string) => ({ 'x-act-as': accountId });
const idOf = (personas: readonly PersonaSummary[], label: string) => personas.find((p) => p.label === label)!.accountId;

/** The admin personas, bylaws published by the Test Membership Admin, and `voters` voter personas. */
async function personasWithVoters(voters: number): Promise<PersonaSummary[]> {
  const admins = (await api.call('POST', '/v1/testing/personas', sa1, {})).body as PersonaSummary[];
  const bylaws = { version: '2026.1', title: 'USTP Bylaws', text: 'Article I. Name.\n' };
  expect((await api.call('POST', '/v1/admin/bylaws', sa1, bylaws, as(idOf(admins, 'Test Membership Admin')))).status).toBe(201);
  return (await api.call('POST', '/v1/testing/personas', sa1, { voters })).body;
}

describe('test personas', () => {
  it('creates one persona per admin role, once, ledgered with the System Admin as actor', async () => {
    const first = await api.call('POST', '/v1/testing/personas', sa1, {});
    expect(first.status).toBe(201);
    expect(first.body.map((p: PersonaSummary) => [p.label, p.kind, p.roles, p.memberStatus, p.createdBy])).toEqual([
      ['Test Membership Admin', 'membership_admin', ['membership_admin'], null, sa1.accountId],
      ['Test Election Admin', 'election_admin', ['election_admin'], null, sa1.accountId],
      ['Test Auditor', 'auditor', ['auditor'], null, sa1.accountId],
      ['Test Site Admin', 'site_admin', ['site_admin'], null, sa1.accountId],
      ['Test Course Admin', 'course_admin', ['course_admin'], null, sa1.accountId],
      ['Test Communications Admin', 'communications_admin', ['communications_admin'], null, sa1.accountId],
    ]);
    expect((await api.call('POST', '/v1/testing/personas', sa2, {})).body).toHaveLength(6);
    expect((await api.call('GET', '/v1/testing/personas', sa2)).body).toEqual(first.body);

    const grants = await api.firebase.db.collection('audit_events').where('type', '==', 'role.granted').get();
    const byPersonas = grants.docs.map((d) => d.data()).filter((e) => e.actor === sa1.accountId);
    expect(byPersonas.map((e) => e.payload)).toEqual([
      { role: 'membership_admin', reason: 'test persona' },
      { role: 'election_admin', reason: 'test persona' },
      { role: 'auditor', reason: 'test persona' },
      { role: 'site_admin', reason: 'test persona' },
      { role: 'course_admin', reason: 'test persona' },
      { role: 'communications_admin', reason: 'test persona' },
    ]);
  });

  it('lets the Course and Communications Admin personas use their own tools and nothing else', async () => {
    const personas = (await api.call('POST', '/v1/testing/personas', sa1, {})).body as PersonaSummary[];
    const course = as(idOf(personas, 'Test Course Admin'));
    const comms = as(idOf(personas, 'Test Communications Admin'));
    expect((await api.call('GET', '/v1/admin/courses/transhumanism', sa1, undefined, course)).status).toBe(200);
    expect((await api.call('GET', '/v1/admin/communications/news', sa1, undefined, comms)).status).toBe(200);
    expect((await api.call('GET', '/v1/admin/communications/news', sa1, undefined, course)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/courses/transhumanism', sa1, undefined, comms)).status).toBe(403);
  });

  it.each(['course_admin', 'site_admin'] as const)('adds the %s persona to a deployment whose other personas were made before it', async (kind) => {
    const before = (await api.call('POST', '/v1/testing/personas', sa1, {})).body as PersonaSummary[];
    const added = before.find((p) => p.kind === kind)!;
    // As a deployment whose personas were made before this kind existed: no persona record, account or role for it.
    const db = api.firebase.db;
    await Promise.all([
      db.collection('testing_personas').doc(added.accountId).delete(),
      db.collection('accounts').doc(added.accountId).delete(),
      db.collection('role_assignments').doc(`${added.accountId}_${kind}`).delete(),
    ]);
    const older = (await api.call('GET', '/v1/testing/personas', sa1)).body as PersonaSummary[];
    expect(older.map((p) => p.kind)).not.toContain(kind);

    const after = (await api.call('POST', '/v1/testing/personas', sa1, {})).body as PersonaSummary[];
    expect(after.map((p) => p.kind)).toEqual(before.map((p) => p.kind));
    const made = after.find((p) => p.kind === kind)!;
    expect(made).toMatchObject({ roles: [kind], createdBy: sa1.accountId });
    expect(made.accountId).not.toBe(added.accountId);
    expect(after.filter((p) => p.kind !== kind)).toEqual(older);
  });

  it("lets a System Admin act as the Test Site Admin, with a Site Admin's tools and nothing more", async () => {
    const personas = (await api.call('POST', '/v1/testing/personas', sa1, {})).body as PersonaSummary[];
    const siteAdmin = as(idOf(personas, 'Test Site Admin'));
    const call = (method: 'GET' | 'POST', path: string, body?: unknown) => api.call(method, path, sa1, body, siteAdmin);

    expect((await call('GET', '/v1/me')).body).toMatchObject({
      account: { displayName: 'Test Site Admin', primaryEmail: null },
      roles: ['site_admin'],
      testing: { enabled: true, operator: sa1.accountId },
    });
    // A Site Admin's tools.
    for (const path of ['/v1/admin/accounts', '/v1/admin/navigation', '/v1/admin/security/sign-ins']) {
      expect((await call('GET', path)).status, path).toBe(200);
    }
    // Nothing more: no testing tools, sign-in settings or API keys, no account or test voter deleted.
    for (const path of ['/v1/testing/personas', '/v1/admin/sign-in-methods', '/v1/admin/api-keys']) {
      expect((await call('GET', path)).status, path).toBe(403);
    }
    expect((await call('POST', '/v1/testing/personas', { voters: 1 })).status).toBe(403);
    expect((await call('POST', '/v1/testing/demo-elections', {})).status).toBe(403);
    const pat = await api.member('pat@example.test');
    expect(await call('POST', `/v1/admin/accounts/${pat.accountId}/delete`, { reason: 'test' })).toMatchObject({
      status: 403,
      body: { detail: 'requires role system_admin' },
    });
    expect((await api.firebase.db.collection('accounts').doc(pat.accountId).get()).exists).toBe(true);
  });

  it('changes the roles of test personas only while acting as the Test Site Admin, ledgered under the persona', async () => {
    const personas = (await api.call('POST', '/v1/testing/personas', sa1, {})).body as PersonaSummary[];
    const siteAdminId = idOf(personas, 'Test Site Admin');
    const course = idOf(personas, 'Test Course Admin');
    const change = (accountId: string, role: string, change: 'grant' | 'revoke' = 'grant') =>
      api.call('POST', '/v1/admin/roles', sa1, { accountId, role, change, reason: 'rehearsal' }, as(siteAdminId));
    const rolesOf = async (accountId: string) =>
      ((await api.call('GET', '/v1/testing/personas', sa1)).body as PersonaSummary[]).find((p) => p.accountId === accountId)?.roles;

    // On another persona: at once, ledgered with the persona as actor, as a real Site Admin's change would be.
    expect(await change(course, 'communications_admin')).toMatchObject({ status: 201, body: { roles: ['communications_admin', 'course_admin'] } });
    const granted = await api.firebase.db.collection('audit_events').where('type', '==', 'role.granted').where('subject', '==', course).get();
    expect(granted.docs.map((d) => [d.data().actor, d.data().payload])).toContainEqual([
      siteAdminId,
      { role: 'communications_admin', reason: 'rehearsal' },
    ]);
    // The same rules as for anyone: at most two roles, never System Admin, never its own account.
    expect(await change(course, 'membership_admin')).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/at most 2 roles/) } });
    expect(await change(course, 'system_admin')).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/only by a system_admin/) } });
    expect((await change(siteAdminId, 'course_admin')).status).toBe(403);
    expect((await change(course, 'communications_admin', 'revoke')).status).toBe(201);
    expect(await rolesOf(course)).toEqual(['course_admin']);

    // Never on a real account, a System Admin's or anyone else's, nor an ID that is no account.
    const pat = await api.member('pat@example.test');
    for (const accountId of [pat.accountId, sa2.accountId, '01a00000-0000-7000-8000-000000000000']) {
      expect(await change(accountId, 'course_admin'), accountId).toMatchObject({
        status: 403,
        body: { detail: expect.stringMatching(/test personas only/) },
      });
    }
    expect((await change(sa2.accountId, 'system_admin', 'revoke')).status).toBe(403);
    expect((await api.call('GET', '/v1/me', pat)).body.roles).toEqual([]);
    expect((await api.call('GET', '/v1/me', sa2)).body.roles).toEqual(['system_admin']);
    // The System Admin, as themselves, still changes real accounts' roles under their own name.
    const real = { accountId: pat.accountId, role: 'course_admin', change: 'grant', reason: 'real' };
    expect((await api.call('POST', '/v1/admin/roles', sa1, real)).status).toBe(201);
  });

  it('adds numbered voters as Active members once bylaws are published', async () => {
    const early = await api.call('POST', '/v1/testing/personas', sa1, { voters: 2 });
    expect(early).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/publish bylaws/) } });

    const personas = await personasWithVoters(2);
    expect(personas.filter((p) => p.kind === 'voter').map((p) => [p.label, p.number, p.roles, p.memberStatus])).toEqual([
      ['Test Voter 1', 1, [], 'active'],
      ['Test Voter 2', 2, [], 'active'],
    ]);
    const more = (await api.call('POST', '/v1/testing/personas', sa1, { voters: 1 })).body as PersonaSummary[];
    expect(more.at(-1)).toMatchObject({ label: 'Test Voter 3', number: 3 });
    expect((await api.call('POST', '/v1/testing/personas', sa1, { voters: 48 })).status).toBe(400);

    const me = (await api.call('GET', '/v1/me', sa1, undefined, as(idOf(personas, 'Test Voter 1')))).body;
    expect(me).toMatchObject({
      account: { displayName: 'Test Voter 1', primaryEmail: null },
      identities: [],
      member: { status: 'active', legalName: 'Test Voter 1', bylawsVersion: '2026.1' },
      roles: [],
      testing: { enabled: true, operator: sa1.accountId },
    });
    expect((await api.call('GET', '/v1/me', sa1)).body.testing).toEqual({ enabled: true, operator: null });
  });

  it('keeps the two-person rule between personas: the Test Election Admin requests the roll, the Test Auditor approves', async () => {
    const personas = await personasWithVoters(2);
    const ea = as(idOf(personas, 'Test Election Admin'));
    const auditor = as(idOf(personas, 'Test Auditor'));
    const created = await api.call('POST', '/v1/admin/elections', sa1, { title: 'Rehearsal', secrecy: 'secret', opensAt: inDays(1), closesAt: inDays(2) }, ea);
    expect(created.status).toBe(201);
    const url = `/v1/admin/elections/${created.body.electionId}`;
    const roll = await api.call('POST', `${url}/roll`, sa1, { reason: 'rehearsal roll' }, ea);
    expect(roll.body).toMatchObject({ status: 'pending', count: 2 });

    const decide = (headers: Record<string, string>) =>
      api.call('POST', `/v1/admin/approvals/${roll.body.approvalId}/decision`, sa1, { decision: 'approve', reason: 'ok' }, headers);
    expect((await decide(ea)).status).toBe(403);
    expect((await decide(auditor)).body.status).toBe('executed');
    const approved = await api.firebase.db.collection('audit_events').where('type', '==', 'roll.approved').get();
    expect(approved.docs[0]!.data().actor).toBe(idOf(personas, 'Test Auditor'));
  });

  it('votes as test voters, once each, on an election whose roll holds them', async () => {
    const personas = await personasWithVoters(2);
    const [v1, v2] = [idOf(personas, 'Test Voter 1'), idOf(personas, 'Test Voter 2')];
    const worker = await TestWorker.start();
    try {
      const { electionId, url } = await seedElection(api, { voters: [v1, v2], opensAt: minutes(-1), closesAt: minutes(60) });
      expect((await worker.tick()).body).toMatchObject({ electionsOpened: 1 });
      const castAs = async (persona: string) => {
        const { definitionHash } = (await api.call('GET', `${url}/ballot`, sa1, undefined, as(persona))).body;
        return api.call('POST', `${url}/ballots`, sa1, { definitionHash, parts: seededBallot(electionId) }, as(persona));
      };
      expect((await castAs(v1)).status).toBe(201);
      expect(await castAs(v1)).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/already voted/) } });
      expect((await castAs(v2)).status).toBe(201);
      expect((await api.call('GET', `${url}/ballot`, sa1)).status).toBe(403);
    } finally {
      await worker.close();
    }
  });

  it('is only for System Admins, only as personas, and never for logins or the persona routes themselves', async () => {
    const personas = await personasWithVoters(1);
    const voter = idOf(personas, 'Test Voter 1');
    const pat = await api.member('pat@example.test');

    expect((await api.call('GET', '/v1/me', pat, undefined, as(voter))).body.detail).toMatch(/only System Admins/);
    expect((await api.call('GET', '/v1/me', sa1, undefined, as(sa2.accountId))).body.detail).toMatch(/not a test persona/);
    expect((await api.call('GET', '/v1/me', sa1, undefined, { 'x-act-as': 'nobody' })).status).toBe(400);
    expect((await api.call('DELETE', `/v1/me/identities/${sa1.uid}`, sa1, undefined, as(voter))).body.detail).toMatch(/stop acting/);
    const asAuditor = as(idOf(personas, 'Test Auditor'));
    expect((await api.call('POST', '/v1/testing/personas', sa1, { voters: 1 }, asAuditor)).status).toBe(403);
    expect((await api.call('GET', '/v1/testing/personas', pat)).status).toBe(403);
  });
});

describe('deleting test voters (POST /v1/testing/personas/delete)', () => {
  const db = () => api.firebase.db;
  const remove = (voters: readonly string[], user: User = sa1, headers: Record<string, string> = {}) =>
    api.call('POST', '/v1/testing/personas/delete', user, { voters }, headers);
  const ledgerAfter = async (seq: number) =>
    (await db().collection('audit_events').where('seq', '>', seq).orderBy('seq').get()).docs.map((d) => d.data());
  const ledgerSeq = async () => (await db().collection('ledger_head').doc('main').get()).data()!.seq as number;

  it('deletes a test voter with its membership and persona, ledgered as account.deleted, and leaves the others', async () => {
    const personas = await personasWithVoters(3);
    const [v1, v2, v3] = ['Test Voter 1', 'Test Voter 2', 'Test Voter 3'].map((label) => idOf(personas, label));
    await db().collection('page_visits').doc('visit').set({ accountId: v2, page: 'ballot' });
    const seq = await ledgerSeq();

    const res = await remove([v2!]);
    expect(res.status).toBe(200);
    expect((res.body as PersonaSummary[]).filter((p) => p.kind === 'voter').map((p) => p.label)).toEqual(['Test Voter 1', 'Test Voter 3']);
    for (const c of ['accounts', 'members', 'testing_personas']) expect((await db().collection(c).doc(v2!).get()).exists, c).toBe(false);
    for (const c of ['member_status_history', 'page_visits']) {
      expect((await db().collection(c).where('accountId', '==', v2).get()).size, c).toBe(0);
    }
    expect((await db().collection('members').doc(v1!).get()).exists).toBe(true);
    expect((await ledgerAfter(seq)).map((e) => [e.type, e.actor, e.subject, e.payload])).toEqual([
      ['account.deleted', sa1.accountId, v2, { email: null, uid: null, reason: TEST_VOTER_DELETION_REASON }],
    ]);
    // Its admission stays in the ledger, and the chain still verifies: the deletion only appended to it.
    const admitted = await db().collection('audit_events').where('type', '==', 'member.status_changed').where('subject', '==', v2).get();
    expect(admitted.size).toBe(1);
    const auditor = as(idOf(personas, 'Test Auditor'));
    expect((await api.call('GET', '/v1/admin/audit/verify', sa1, undefined, auditor)).body).toMatchObject({ ok: true });

    // A voter added later takes the number after the highest remaining one, as a new account.
    expect((await remove([v3!])).status).toBe(200);
    const added = (await api.call('POST', '/v1/testing/personas', sa1, { voters: 1 })).body as PersonaSummary[];
    const voters = added.filter((p) => p.kind === 'voter');
    expect(voters.map((p) => [p.label, p.number])).toEqual([
      ['Test Voter 1', 1],
      ['Test Voter 2', 2],
    ]);
    expect(voters[1]!.accountId).not.toBe(v2);
  });

  it('deletes test voters an election holds, and its roll, ballots and results stay as they were and still verify', async () => {
    const personas = await personasWithVoters(2);
    const [v1, v2] = [idOf(personas, 'Test Voter 1'), idOf(personas, 'Test Voter 2')];
    const worker = await TestWorker.start();
    try {
      const election = await seedElection(api, { voters: [v1, v2], rehearsal: true, opensAt: minutes(-1), closesAt: minutes(60) });
      const { electionId, url } = election;
      expect((await worker.tick()).body).toMatchObject({ electionsOpened: 1 });
      const { definitionHash } = (await api.call('GET', `${url}/ballot`, sa1, undefined, as(v1))).body;
      const cast = await api.call('POST', `${url}/ballots`, sa1, { definitionHash, parts: seededBallot(electionId) }, as(v1));
      expect(cast.status).toBe(201);
      const roll = db().collection('eligibility_snapshots').doc(`r-${electionId}`);
      const rollBefore = (await roll.get()).data()!;

      const res = await remove([v1, v2]);
      expect(res.status).toBe(200);
      expect((res.body as PersonaSummary[]).filter((p) => p.kind === 'voter')).toEqual([]);

      expect((await roll.get()).data()).toEqual(rollBefore);
      expect((await election.ref.collection('participation').doc(v1).get()).exists).toBe(true);
      const view = await api.call('GET', `/v1/admin/elections/${electionId}/roll`, sa1, undefined, as(idOf(personas, 'Test Auditor')));
      expect(view.body.entries.map((e: { legalName: string }) => e.legalName)).toEqual(['(no member record)', '(no member record)']);
      expect((await api.call('GET', `${url}/ballot`, sa1, undefined, as(v2))).body.detail).toMatch(/not a test persona/);

      await closeNow(api, election);
      expect((await worker.tick()).body).toMatchObject({ electionsClosed: 1, ballotsSealed: 1, resultsComputed: 1 });
      const publicUrl = `/v1/public/elections/${electionId}`;
      const results = (await api.call('GET', `${publicUrl}/results`)).body as ResultsRecord;
      expect(results.bundle).toMatchObject({ participationCount: 1, roll: { count: 2, merkleRoot: rollBefore.merkleRoot } });
      const entry = await api.call('GET', `/v1/public/ledger/entries/${results.ledgerSeq}`);
      const check = await checkResults({
        election: (await api.call('GET', publicUrl)).body,
        results,
        blocks: (await api.call('GET', `${publicUrl}/sealed-blocks`)).body,
        keys: (await api.call('GET', '/v1/public/ledger/keys')).body,
        ledger: entry.status === 200 ? entry.body : null,
        anchor: null,
      });
      expect(check.steps.filter((s) => s.ok === false)).toEqual([]);
    } finally {
      await worker.close();
    }
  });

  it('checks every ID first: only test voters, never the admin personas or anyone else', async () => {
    const personas = await personasWithVoters(1);
    const voter = idOf(personas, 'Test Voter 1');
    const auditor = idOf(personas, 'Test Auditor');
    const pat = await api.member('pat@example.test');

    for (const other of [auditor, pat.accountId, '01a00000-0000-7000-8000-000000000000']) {
      expect(await remove([voter, other])).toMatchObject({ status: 404, body: { detail: `not a test voter: ${other}` } });
    }
    for (const voters of [[], [voter, voter], ['nobody']]) expect((await remove(voters)).status, JSON.stringify(voters)).toBe(400);
    expect((await remove([voter], pat)).status).toBe(403);
    // A Site Admin deletes no test voter, and cannot act as a persona that might (design §10.1).
    await api.grant(pat.accountId, 'site_admin', sa1);
    expect(await remove([voter], pat)).toMatchObject({ status: 403, body: { detail: 'requires role system_admin' } });
    expect(await remove([voter], pat, as(auditor))).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/only System Admins/) } });
    expect((await remove([voter], sa1, as(auditor))).status).toBe(403);
    for (const id of [voter, auditor, pat.accountId]) expect((await db().collection('accounts').doc(id).get()).exists).toBe(true);
    expect((await db().collection('testing_personas').doc(voter).get()).exists).toBe(true);
  });
});

describe('with testing mode off', () => {
  let off: TestApi;
  beforeAll(async () => {
    delete process.env.TESTING_MODE;
    off = await TestApi.start();
  });
  afterAll(async () => {
    await off.close();
    process.env.TESTING_MODE = 'true';
  });

  it('has no persona routes and refuses to act as anyone', async () => {
    const personas = (await api.call('POST', '/v1/testing/personas', sa1, {})).body as PersonaSummary[];
    expect((await off.call('GET', '/v1/testing/personas', sa1)).status).toBe(404);
    const voters = [idOf(personas, 'Test Auditor')];
    expect((await off.call('POST', '/v1/testing/personas/delete', sa1, { voters })).status).toBe(404);
    const acting = await off.call('GET', '/v1/me', sa1, undefined, as(idOf(personas, 'Test Auditor')));
    expect(acting).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/testing mode is off/) } });
    expect((await off.call('GET', '/v1/me', sa1)).body.testing).toEqual({ enabled: false, operator: null });
  });
});
