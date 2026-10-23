import type { BylawsCheckView } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

let admin: User & { accountId: string };
let member: User & { accountId: string };

const published = [
  'Article I. Name.',
  'The party opposes life extension research.', // a stand-in phrase, already published
  'Article II. Officers.',
].join('\n');

beforeEach(async () => {
  await resetEmulators();
  const [sa1] = await api.systemAdmins();
  admin = await api.member('membership.admin@example.test');
  member = await api.member('someone@example.test');
  await api.grant(admin.accountId, 'membership_admin', sa1);
  expect((await api.call('POST', '/v1/admin/bylaws', admin, { version: '2026.1', title: 'USTP Bylaws', text: published })).status).toBe(201);
});

async function runWorker() {
  const res = await worker.app.inject({ method: 'POST', url: '/tasks/bylaws-checks' });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

const check = async (id: string) => (await api.call('GET', `/v1/admin/bylaws/checks/${id}`, admin)).body as BylawsCheckView;

describe('bylaws check', () => {
  it('queues a check of the whole draft, which the worker runs (the stand-in, with the emulators)', async () => {
    const text = `${published}\nOfficers may amend these bylaws without a vote of the members.`;
    const queued = await api.call('POST', '/v1/admin/bylaws/checks', admin, { title: 'USTP Bylaws', text, amends: '2026.1', scope: 'draft' });
    expect(queued.status).toBe(202);
    expect(queued.body).toMatchObject({ status: 'queued', scope: 'draft', lineCount: 4, focusLines: null, requestedBy: admin.accountId });
    expect(queued.body).not.toHaveProperty('text');

    expect(await runWorker()).toEqual({ status: 200, body: { checked: 1, failed: 0 } });
    const done = await check(queued.body.checkId);
    expect(done).toMatchObject({ status: 'done', checker: 'stub', model: null, error: null });
    expect(done.findings.map((f) => [f.lines, f.source])).toEqual([
      [[2], 'transhumanist-principles'],
      [[4], 'ustp-constitution'],
    ]);
    expect(done.references.map((r) => r.id)).toEqual(['us-constitution', 'ustp-constitution', 'transhumanist-bill-of-rights']);
    expect(done.startedAt! <= done.finishedAt!).toBe(true);
    expect(await runWorker()).toEqual({ status: 200, body: { checked: 0, failed: 0 } });
  });

  it('checks only the lines changed since the version the draft amends', async () => {
    const text = `${published}\nOfficers may amend these bylaws without a vote of the members.\nArticle III. Meetings.`;
    const queued = await api.call('POST', '/v1/admin/bylaws/checks', admin, { title: 'USTP Bylaws', text, amends: '2026.1', scope: 'changes' });
    expect(queued.body).toMatchObject({ status: 'queued', focusLines: [4, 5] });
    await runWorker();
    expect((await check(queued.body.checkId)).findings.map((f) => f.lines)).toEqual([[4]]); // line 2 was already published
  });

  it('refuses checks it cannot do, one at a time per admin, and only for Membership Admins', async () => {
    const body = { title: 'USTP Bylaws', text: published, scope: 'changes' };
    expect(await api.call('POST', '/v1/admin/bylaws/checks', admin, { ...body, amends: null })).toMatchObject({
      status: 400,
      body: { detail: expect.stringMatching(/first version has no changes/) },
    });
    expect(await api.call('POST', '/v1/admin/bylaws/checks', admin, { ...body, amends: '2026.1' })).toMatchObject({
      status: 400,
      body: { detail: expect.stringMatching(/nothing has changed since version 2026.1/) },
    });
    expect((await api.call('POST', '/v1/admin/bylaws/checks', admin, { ...body, amends: '1999' })).status).toBe(404);
    expect((await api.call('POST', '/v1/admin/bylaws/checks', admin, { ...body, scope: 'everything' })).status).toBe(400);
    expect((await api.call('POST', '/v1/admin/bylaws/checks', member, { ...body, scope: 'draft' })).status).toBe(403);

    const first = await api.call('POST', '/v1/admin/bylaws/checks', admin, { ...body, scope: 'draft' });
    expect(first.status).toBe(202);
    expect(await api.call('POST', '/v1/admin/bylaws/checks', admin, { ...body, scope: 'draft' })).toMatchObject({
      status: 409,
      body: { detail: expect.stringMatching(/previous check has not finished/) },
    });
    expect((await api.call('GET', `/v1/admin/bylaws/checks/${first.body.checkId}`, member)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/bylaws/checks/not-an-id', admin)).status).toBe(404);

    await runWorker();
    expect((await api.call('POST', '/v1/admin/bylaws/checks', admin, { ...body, scope: 'draft' })).status).toBe(202);
  });
});
