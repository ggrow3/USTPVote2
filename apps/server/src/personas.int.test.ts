import type { PersonaSummary } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { minutes, seedElection, seededBallot } from './testing/elections.js';
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
      ['Test Course Admin', 'course_admin', ['course_admin'], null, sa1.accountId],
      ['Test Communications Admin', 'communications_admin', ['communications_admin'], null, sa1.accountId],
    ]);
    expect((await api.call('POST', '/v1/testing/personas', sa2, {})).body).toHaveLength(5);
    expect((await api.call('GET', '/v1/testing/personas', sa2)).body).toEqual(first.body);

    const grants = await api.firebase.db.collection('audit_events').where('type', '==', 'role.granted').get();
    const byPersonas = grants.docs.map((d) => d.data()).filter((e) => e.actor === sa1.accountId);
    expect(byPersonas.map((e) => e.payload)).toEqual([
      { role: 'membership_admin', reason: 'test persona' },
      { role: 'election_admin', reason: 'test persona' },
      { role: 'auditor', reason: 'test persona' },
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

  it('adds an admin persona for a role that had none when the others were made', async () => {
    const before = (await api.call('POST', '/v1/testing/personas', sa1, {})).body as PersonaSummary[];
    const course = before.find((p) => p.kind === 'course_admin')!;
    await api.firebase.db.collection('testing_personas').doc(course.accountId).delete();

    const after = (await api.call('POST', '/v1/testing/personas', sa1, {})).body as PersonaSummary[];
    expect(after.map((p) => p.kind)).toEqual(before.map((p) => p.kind));
    expect(after.find((p) => p.kind === 'course_admin')!.accountId).not.toBe(course.accountId);
    expect(after.filter((p) => p.kind !== 'course_admin')).toEqual(before.filter((p) => p.kind !== 'course_admin'));
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
    const acting = await off.call('GET', '/v1/me', sa1, undefined, as(idOf(personas, 'Test Auditor')));
    expect(acting).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/testing mode is off/) } });
    expect((await off.call('GET', '/v1/me', sa1)).body.testing).toEqual({ enabled: false, operator: null });
  });
});
