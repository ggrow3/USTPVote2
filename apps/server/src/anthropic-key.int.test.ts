import { ANTHROPIC_KEY_SECRET, Collections, type AnthropicKeyStatus } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicKey } from './claude-checks/anthropic-key.js';
import { ANTHROPIC_KEY_TESTER, type AnthropicKeyTester } from './claude-checks/key-tester.js';
import { SECRET_STORE, type SecretStore } from './infra/secret-store.js';
import { seedElection } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

// The checks as a real project has them, so they wait for a key; the emulators still keep it in their stand-in store.
let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  process.env.BYLAWS_CHECKER = 'claude';
  process.env.CONSISTENCY_CHECKER = 'claude';
  process.env.ELECTION_CHECKER = 'claude';
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]).finally(() => {
    delete process.env.BYLAWS_CHECKER;
    delete process.env.CONSISTENCY_CHECKER;
    delete process.env.ELECTION_CHECKER;
  });
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Account = User & { accountId: string };
let sa1: Account;
let sa2: Account;

beforeEach(async () => {
  await resetEmulators();
  api.app.get(AnthropicKey).invalidate();
  [sa1, sa2] = await api.systemAdmins();
});

// Made up, in the shape of Anthropic API keys; never real ones.
const KEY = `sk-ant-api03-${'k'.repeat(80)}-AAAA`;
const NEW_KEY = `sk-ant-api03-${'n'.repeat(80)}-BBBB`;

const route = '/v1/admin/anthropic-key';
const status = async (who: User = sa1) => (await api.call('GET', route, who)).body as AnthropicKeyStatus;
const ledger = async () => (await api.firebase.db.collection(Collections.auditEvents).orderBy('seq').get()).docs.map((d) => d.data());
const workerKey = () => worker.app.get(AnthropicKey).read();

/** An open election with one voter on its roll. */
async function ballot() {
  const voter = await api.member('voter@example.test');
  return { voter, election: await seedElection(api, { voters: [voter.accountId] }) };
}

/** Every document outside the stand-in secret store, as text: the key must be in none of them. */
async function everythingButTheSecret(): Promise<string> {
  const collections = await api.firebase.db.listCollections();
  const docs = await Promise.all(collections.filter((c) => c.id !== 'emulator_secrets').map((c) => c.get()));
  return JSON.stringify(docs.flatMap((snap) => snap.docs.map((d) => d.data())));
}

describe('the Anthropic API key (design §5.6)', () => {
  it('is for System Admins alone', async () => {
    const officer = await api.member('officer@example.test');
    await api.grant(officer.accountId, 'election_admin', sa1);
    const member = await api.member('member@example.test');
    for (const who of [officer, member]) {
      expect((await api.call('GET', route, who)).status).toBe(403);
      expect((await api.call('PUT', route, who, { key: KEY })).status).toBe(403);
      expect((await api.call('DELETE', route, who)).status).toBe(403);
    }
    expect((await api.call('PUT', route, undefined, { key: KEY })).status).toBe(401);
    expect((await status()).set).toBe(false);
  });

  it('starts unset, and until one is added no check can be asked for', async () => {
    expect(await status()).toEqual({
      set: false,
      addedAt: null,
      addedBy: null,
      hint: null,
      checks: { bylaws: 'claude', consistency: 'claude', election: 'claude' },
      tried: false,
    });
    const { voter, election } = await ballot();
    expect((await api.call('GET', `${election.url}/consistency-check`, voter)).body).toMatchObject({ enabled: false, check: null });
    const asked = await api.call('POST', `${election.url}/consistency-check`, voter);
    expect(asked).toMatchObject({ status: 503, body: { detail: expect.stringMatching(/no Anthropic API key has been added .*Admin › API keys/) } });

    const admin = await api.member('membership@example.test');
    await api.grant(admin.accountId, 'membership_admin', sa1);
    const bylaws = await api.call('POST', '/v1/admin/bylaws/checks', admin, { title: 'Bylaws', text: 'A\nB', scope: 'draft' });
    expect(bylaws).toMatchObject({ status: 503, body: { detail: expect.stringMatching(/no Anthropic API key has been added/) } });

    const officer = await api.member('officer@example.test');
    await api.grant(officer.accountId, 'election_admin', sa1);
    const setup = `/v1/admin/elections/${election.electionId}/bylaws-checks`;
    expect((await api.call('GET', setup, officer)).body).toEqual({ enabled: false, check: null });
    expect(await api.call('POST', setup, officer)).toMatchObject({
      status: 503,
      body: { detail: expect.stringMatching(/election setup check cannot run yet: no Anthropic API key has been added/) },
    });
    expect(await workerKey()).toBeNull();
  });

  it('is added by a System Admin, kept only in the secret, ledgered without it, and read by the worker alone', async () => {
    const res = await api.call('PUT', route, sa1, { key: `  ${KEY}\n` });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ set: true, hint: 'AAAA', addedBy: { accountId: sa1.accountId } });
    expect(Date.parse((res.body as AnthropicKeyStatus).addedAt!)).toBeGreaterThan(Date.now() - 60_000);
    expect(JSON.stringify(res.body)).not.toContain(KEY.slice(0, 40));

    expect(await workerKey()).toBe(KEY);
    expect(await everythingButTheSecret()).not.toContain(KEY.slice(0, 40));
    expect((await ledger()).at(-1)).toMatchObject({ type: 'anthropic_key.changed', actor: sa1.accountId, subject: null, payload: { change: 'added' } });

    // Now the consistency check can be asked for (the worker would run it with this key).
    const { voter, election } = await ballot();
    expect((await api.call('GET', `${election.url}/consistency-check`, voter)).body.enabled).toBe(true);
  });

  it('is replaced by adding another, which the worker uses from its next run; older versions are destroyed', async () => {
    await api.call('PUT', route, sa1, { key: KEY });
    const replaced = await api.call('PUT', route, sa2, { key: NEW_KEY });
    expect(replaced.body).toMatchObject({ set: true, hint: 'BBBB', addedBy: { accountId: sa2.accountId } });
    expect(await workerKey()).toBe(NEW_KEY);
    expect((await ledger()).filter((e) => e.type === 'anthropic_key.changed').map((e) => [e.actor, e.payload.change])).toEqual([
      [sa1.accountId, 'added'],
      [sa2.accountId, 'added'],
    ]);
  });

  it('is removed, so no check can run until one is added again', async () => {
    await api.call('PUT', route, sa1, { key: KEY });
    const removed = await api.call('DELETE', route, sa2);
    expect(removed).toMatchObject({ status: 200, body: { set: false, hint: null, addedBy: null } });
    expect(await workerKey()).toBeNull();
    expect((await ledger()).at(-1)).toMatchObject({ type: 'anthropic_key.changed', actor: sa2.accountId, payload: { change: 'removed' } });
    expect((await api.call('DELETE', route, sa1)).status).toBe(404);

    const { voter, election } = await ballot();
    expect((await api.call('POST', `${election.url}/consistency-check`, voter)).status).toBe(503);
  });

  it('refuses a paste that is not an API key before trying it, without repeating it', async () => {
    const tester = api.app.get<AnthropicKeyTester>(ANTHROPIC_KEY_TESTER);
    const tried = vi.spyOn(tester, 'try');
    try {
      for (const key of [`sk-ant-admin01-${'a'.repeat(80)}`, `sk-proj-${'p'.repeat(80)}`, `${KEY.slice(0, 30)} ${KEY.slice(30)}`, 'x'.repeat(501)]) {
        const res = await api.call('PUT', route, sa1, { key });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).not.toContain(key.slice(0, 30));
      }
      expect(tried).not.toHaveBeenCalled();
    } finally {
      tried.mockRestore();
    }
    expect((await status()).set).toBe(false);
    expect((await ledger()).some((e) => e.type === 'anthropic_key.changed')).toBe(false);
  });

  it('keeps nothing Anthropic refuses or could not be asked about', async () => {
    const tester = api.app.get<AnthropicKeyTester>(ANTHROPIC_KEY_TESTER);
    const tried = vi
      .spyOn(tester, 'try')
      .mockResolvedValueOnce({ ok: false, refusal: 'rejected', reason: 'Anthropic did not accept this key' })
      .mockResolvedValueOnce({ ok: false, refusal: 'unreachable', reason: 'Anthropic could not be asked about this key just now' });
    try {
      expect(await api.call('PUT', route, sa1, { key: KEY })).toMatchObject({ status: 422, body: { detail: 'Anthropic did not accept this key' } });
      expect((await api.call('PUT', route, sa1, { key: KEY })).status).toBe(502);
      expect(tried).toHaveBeenCalledWith(KEY, ['claude-opus-5-5', 'claude-opus-5-5', 'claude-opus-5-5']);
    } finally {
      tried.mockRestore();
    }
    expect((await status()).set).toBe(false);
    expect(await workerKey()).toBeNull();
    expect((await ledger()).some((e) => e.type === 'anthropic_key.changed')).toBe(false);
  });

  it('shows a key added outside the app as set, without who added it or its hint', async () => {
    await api.call('PUT', route, sa1, { key: KEY });
    await api.app.get<SecretStore>(SECRET_STORE).replace(ANTHROPIC_KEY_SECRET, NEW_KEY);
    expect(await status()).toMatchObject({ set: true, addedBy: null, hint: null });
    expect(await workerKey()).toBe(NEW_KEY);
  });
});
