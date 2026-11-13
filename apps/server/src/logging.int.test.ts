import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedElection, seededBallot } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** The developer log (design §14, "Logging"), read as Cloud Logging would receive it. */
const written: string[] = [];
const lines = () => written.map((line) => JSON.parse(line) as Record<string, unknown>);

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  // Nest's Logger is one per process, set by the app created last: the quiet worker first, then the api whose log is read.
  worker = await TestWorker.start();
  api = await TestApi.start({ write: (line) => written.push(line) });
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let pat: Member;

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  pat = await api.member('pat@example.test');
  written.length = 0;
});

describe('the developer log', () => {
  it('has a line for the request and one for the action it took, tied together', async () => {
    const res = await api.call('POST', '/v1/admin/roles', sa1, { accountId: pat.accountId, role: 'auditor', change: 'grant', reason: 'staffing' });
    expect(res.status).toBe(201);
    const request = lines().find((line) => line.httpRequest);
    expect(request).toMatchObject({
      message: 'POST /v1/admin/roles 201',
      route: '/v1/admin/roles',
      accountId: sa1.accountId,
      roles: ['system_admin'],
    });
    expect(request?.action).toMatch(/Controller\.\w+$/);
    const action = lines().find((line) => line.event === 'role.granted');
    expect(action).toMatchObject({
      context: 'Ledger',
      actor: sa1.accountId,
      subject: pat.accountId,
      requestId: request?.requestId,
      action: request?.action,
    });
    expect(action?.seq).toEqual(expect.any(Number));
    // Never the payload (the reason), an email address or a token.
    const all = written.join('');
    for (const secret of ['staffing', 'example.test', sa1.token]) expect(all).not.toContain(secret);
  });

  it('logs a refused request with its status, and a search without what was searched for', async () => {
    expect((await api.call('GET', '/v1/admin/audit/events?after=0&q=pat%40example.test', pat)).status).toBe(403);
    expect(lines().find((line) => line.httpRequest)).toMatchObject({ message: 'GET /v1/admin/audit/events 403' });
    expect(written.join('')).not.toContain('pat%40');
  });

  it('never says who cast a ballot', async () => {
    const election = await seedElection(api, { voters: [pat.accountId, sa1.accountId] });
    expect((await worker.tick()).body).toMatchObject({ electionsOpened: 1 });
    const { definitionHash } = (await api.call('GET', `${election.url}/ballot`, pat)).body;
    written.length = 0;
    const cast = await api.call('POST', `${election.url}/ballots`, pat, { definitionHash, parts: seededBallot(election.electionId) });
    expect(cast.status).toBe(201);
    expect(lines().find((line) => line.httpRequest)).toMatchObject({ message: `POST ${election.url}/ballots 201`, action: 'VotingController.cast' });
    expect(written.join('')).not.toContain(pat.accountId);
    expect(written.join('')).not.toContain('accountId');
  });
});
