import { Collections, type ApiKeysStatus } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiKeys } from './api-keys/api-keys.js';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

// The deployment has its own Civic key, as dev does (Terraform's google-civic-api-key), and no FEC or Open States key.
let api: TestApi;
beforeAll(async () => {
  process.env.GOOGLE_CIVIC_API_KEY = 'deployment-civic';
  api = await TestApi.start().finally(() => delete process.env.GOOGLE_CIVIC_API_KEY);
});
afterAll(() => api.close());

type Account = User & { accountId: string };
let sa1: Account;
let sa2: Account;

const keys = () => api.app.get(ApiKeys);

beforeEach(async () => {
  await resetEmulators();
  for (const name of ['fec', 'openstates', 'civic'] as const) keys().invalidate(name);
  [sa1, sa2] = await api.systemAdmins();
});

// Made up, in each service's shape; never real keys.
const FEC = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789wxyz';
const NEW_FEC = 'ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210abcd';
const CIVIC = `AIzaSy${'x'.repeat(28)}_wxyz`;

const route = '/v1/admin/api-keys';
const status = async (who: User = sa1) => (await api.call('GET', route, who)).body as ApiKeysStatus;
const one = async (name: string) => (await status()).keys.find((k) => k.name === name)!;
const ledger = async () => (await api.firebase.db.collection(Collections.auditEvents).orderBy('seq').get()).docs.map((d) => d.data());

/** Every document outside the stand-in secret store, as text: no key may be in any of them. */
async function everythingButTheSecrets(): Promise<string> {
  const collections = await api.firebase.db.listCollections();
  const docs = await Promise.all(collections.filter((c) => c.id !== 'emulator_secrets').map((c) => c.get()));
  return JSON.stringify(docs.flatMap((snap) => snap.docs.map((d) => d.data())));
}

describe('the public-records services’ keys (design §5.6)', () => {
  it('are for System Admins alone', async () => {
    const officer = await api.member('officer@example.test');
    await api.grant(officer.accountId, 'communications_admin', sa1);
    const member = await api.member('member@example.test');
    for (const who of [officer, member]) {
      expect((await api.call('GET', route, who)).status).toBe(403);
      expect((await api.call('PUT', `${route}/fec`, who, { key: FEC })).status).toBe(403);
      expect((await api.call('DELETE', `${route}/fec`, who)).status).toBe(403);
    }
    expect((await api.call('PUT', `${route}/fec`, undefined, { key: FEC })).status).toBe(401);
  });

  it('start as the deployment has them: its Civic key, and none for the FEC (its demo key) or Open States', async () => {
    expect(await status()).toEqual({
      keys: [
        { name: 'fec', source: 'none', addedAt: null, addedBy: null, hint: null, deploymentKey: false, unavailable: null },
        { name: 'openstates', source: 'none', addedAt: null, addedBy: null, hint: null, deploymentKey: false, unavailable: null },
        { name: 'civic', source: 'deployment', addedAt: null, addedBy: null, hint: null, deploymentKey: true, unavailable: null },
        { name: 'congress', source: 'none', addedAt: null, addedBy: null, hint: null, deploymentKey: false, unavailable: null },
      ],
      tried: false,
    });
    expect(await keys().contactKeys()).toEqual({ fec: 'DEMO_KEY', openStates: null, civic: 'deployment-civic' });
  });

  it('are added by a System Admin, kept only in their secret, ledgered without them, and used at once', async () => {
    const res = await api.call('PUT', `${route}/fec`, sa1, { key: `  ${FEC}\n` });
    expect(res.status).toBe(200);
    expect((res.body as ApiKeysStatus).keys[0]).toMatchObject({ name: 'fec', source: 'app', hint: 'wxyz', addedBy: { accountId: sa1.accountId } });
    expect(JSON.stringify(res.body)).not.toContain(FEC.slice(0, 20));
    expect(await keys().contactKeys()).toMatchObject({ fec: FEC });
    expect(await everythingButTheSecrets()).not.toContain(FEC.slice(0, 20));
    expect((await ledger()).at(-1)).toMatchObject({ type: 'api_key.changed', actor: sa1.accountId, subject: null, payload: { key: 'fec', change: 'added' } });

    // One added here comes before the deployment's.
    await api.call('PUT', `${route}/civic`, sa1, { key: CIVIC });
    expect(await one('civic')).toMatchObject({ source: 'app', deploymentKey: true, hint: 'wxyz' });
    expect(await keys().contactKeys()).toMatchObject({ civic: CIVIC });
  });

  it('are replaced by adding another, and removing one goes back to the deployment’s key', async () => {
    await api.call('PUT', `${route}/fec`, sa1, { key: FEC });
    await api.call('PUT', `${route}/fec`, sa2, { key: NEW_FEC });
    expect(await one('fec')).toMatchObject({ source: 'app', hint: 'abcd', addedBy: { accountId: sa2.accountId } });
    expect(await keys().contactKeys()).toMatchObject({ fec: NEW_FEC });

    const removed = await api.call('DELETE', `${route}/fec`, sa1);
    expect(removed.status).toBe(200);
    expect(await one('fec')).toEqual({ name: 'fec', source: 'none', addedAt: null, addedBy: null, hint: null, deploymentKey: false, unavailable: null });
    expect(await keys().contactKeys()).toMatchObject({ fec: 'DEMO_KEY' });
    expect((await ledger()).at(-1)).toMatchObject({ type: 'api_key.changed', payload: { key: 'fec', change: 'removed' } });

    await api.call('PUT', `${route}/civic`, sa1, { key: CIVIC });
    await api.call('DELETE', `${route}/civic`, sa1);
    expect(await one('civic')).toMatchObject({ source: 'deployment' });
    expect(await keys().contactKeys()).toMatchObject({ civic: 'deployment-civic' });
    expect((await api.call('DELETE', `${route}/civic`, sa1)).status).toBe(404);
  });

  it('refuse a paste that is not that service’s key, or a service there is no key for, keeping nothing', async () => {
    const wrong = await api.call('PUT', `${route}/openstates`, sa1, { key: FEC });
    expect(wrong).toMatchObject({ status: 400, body: { detail: expect.stringMatching(/Open States keys look like/) } });
    expect(JSON.stringify(wrong.body)).not.toContain(FEC);
    expect((await api.call('PUT', `${route}/anthropic`, sa1, { key: FEC })).status).toBe(404);
    expect((await api.call('PUT', `${route}/fec`, sa1, { key: FEC, extra: 1 })).status).toBe(400);
    expect((await status()).keys.every((k) => k.source !== 'app')).toBe(true);
    expect((await ledger()).filter((e) => e.type === 'api_key.changed')).toEqual([]);
  });

  it('give the Bills page its own key, else the FEC key in use, else the demo key (design §5.14)', async () => {
    expect(await keys().billsKey()).toEqual({ key: 'DEMO_KEY', source: 'demo' });
    await api.call('PUT', `${route}/fec`, sa1, { key: FEC });
    expect(await keys().billsKey()).toEqual({ key: FEC, source: 'fec' });
    expect((await api.call('PUT', `${route}/congress`, sa1, { key: 'DEMO_KEY' })).status).toBe(400);
    expect((await api.call('PUT', `${route}/congress`, sa1, { key: NEW_FEC })).status).toBe(200);
    expect(await keys().billsKey()).toEqual({ key: NEW_FEC, source: 'congress' });
    expect(await one('congress')).toMatchObject({ source: 'app', deploymentKey: false, hint: 'abcd' });
    await api.call('DELETE', `${route}/congress`, sa1);
    expect(await keys().billsKey()).toEqual({ key: FEC, source: 'fec' });
  });
});
