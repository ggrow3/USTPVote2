import { describe, expect, it } from 'vitest';
import { ApiKeys } from './api-keys/api-keys.js';
import { PublicApiKeyTester } from './api-keys/key-tester.js';
import type { ServerConfig } from './config.js';
import type { SecretStore } from './infra/secret-store.js';

// Made up, in each service's shape; never real keys.
const FEC = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789wxyz';
const CIVIC = `AIzaSy${'x'.repeat(28)}_wxyz`;

/** A `fetch` that answers with `status` and `body`, recording each request; `null` fails to connect. */
function fakeService(status: number | null, body: unknown = {}, seen: Request[] = []): typeof globalThis.fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(new Request(url, init));
    if (status === null) throw new TypeError('fetch failed');
    return Response.json(body, { status });
  }) as typeof globalThis.fetch;
}

describe('trying a public-records key with its service', () => {
  it('asks each service one small question, with the key in a header and in no address', async () => {
    const seen: Request[] = [];
    const tester = new PublicApiKeyTester(fakeService(200, {}, seen));
    expect(await tester.try('fec', FEC)).toEqual({ ok: true });
    expect(await tester.try('openstates', '1b2c3d4e-5f60-4a1b-8c2d-0123456789ab')).toEqual({ ok: true });
    expect(await tester.try('civic', CIVIC)).toEqual({ ok: true });
    expect(seen.map((r) => new URL(r.url).host)).toEqual(['api.open.fec.gov', 'v3.openstates.org', 'www.googleapis.com']);
    expect(seen.map((r) => [r.headers.get('x-api-key'), r.headers.get('x-goog-api-key')])).toEqual([
      [FEC, null],
      ['1b2c3d4e-5f60-4a1b-8c2d-0123456789ab', null],
      [null, CIVIC],
    ]);
    expect(seen.some((r) => r.url.includes(FEC) || r.url.includes(CIVIC))).toBe(false);
  });

  it('says in words why it would not take one, never passing on what the service said', async () => {
    const keyRefused = { error: { message: 'API key not valid. Please pass a valid API key.' } };
    const cases = [
      ['fec', 403, {}, 'rejected', /api\.data\.gov did not accept this key/],
      ['openstates', 401, {}, 'rejected', /Open States did not accept this key/],
      ['civic', 400, keyRefused, 'rejected', /Google did not accept this key/],
      ['civic', 403, { error: { message: 'Civic Information API has not been used in project 1' } }, 'rejected', /turn that API on/],
      ['civic', 400, { error: { message: 'Invalid value' } }, 'unreachable', /could not be asked/],
      ['fec', 429, {}, 'unreachable', /could not be asked/],
      ['openstates', 500, {}, 'unreachable', /could not be asked/],
      ['fec', null, {}, 'unreachable', /nothing was saved/],
    ] as const;
    for (const [name, status, body, refusal, reason] of cases) {
      const trial = await new PublicApiKeyTester(fakeService(status, body)).try(name, 'k');
      expect(trial).toEqual({ ok: false, refusal, reason: expect.stringMatching(reason) });
      expect(JSON.stringify(trial)).not.toMatch(/API key not valid|project 1/);
    }
  });
});

describe('the key in use', () => {
  const config = (env: Partial<Pick<ServerConfig, 'fecApiKey' | 'openStatesApiKey' | 'civicApiKey'>> = {}) =>
    ({ fecApiKey: 'DEMO_KEY', openStatesApiKey: null, civicApiKey: null, ...env }) as ServerConfig;
  const failing = (code: number) => async () => Promise.reject(Object.assign(new Error(`grpc ${code}`), { code }));

  it('is the one added in the app, else the deployment’s, else none (the FEC’s shared DEMO_KEY)', async () => {
    const added: Record<string, string> = { 'app-civic-api-key': 'app-civic' };
    const store = { read: async (id: string) => added[id] ?? Promise.reject(Object.assign(new Error('none'), { code: 5 })) } as unknown as SecretStore;
    const keys = new ApiKeys(store, config({ civicApiKey: 'deployment-civic', openStatesApiKey: 'deployment-os' }));
    expect(await keys.contactKeys()).toEqual({ fec: 'DEMO_KEY', openStates: 'deployment-os', civic: 'app-civic' });
    expect(keys.deployment('fec')).toBeNull();
    expect(new ApiKeys(store, config({ fecApiKey: FEC })).deployment('fec')).toBe(FEC);
  });

  it('is asked of Secret Manager at most once a minute, and again at once after a change here', async () => {
    let reads = 0;
    let value = 'first';
    const keys = new ApiKeys({ read: async () => (reads++, value) } as unknown as SecretStore, config());
    expect(await keys.value('openstates')).toBe('first');
    value = 'second';
    expect(await keys.value('openstates')).toBe('first');
    expect(reads).toBe(1);
    keys.invalidate('openstates');
    expect(await keys.value('openstates')).toBe('second');
    expect(reads).toBe(2);
  });

  it('falls back to the deployment’s key when Secret Manager cannot be asked, rather than leaving the records out', async () => {
    for (const code of [5, 7, 9, 14]) {
      const keys = new ApiKeys({ read: failing(code) } as unknown as SecretStore, config({ civicApiKey: 'deployment-civic' }));
      expect(await keys.value('civic')).toBe('deployment-civic');
    }
  });

  it('tells the panel to apply the Terraform when the api may not look at the secret', async () => {
    const denied = new ApiKeys({ latest: failing(7) } as unknown as SecretStore, config());
    await expect(denied.version('fec')).rejects.toThrow(/may not look at the app-fec-api-key secret yet: apply the Terraform/);
    expect(await new ApiKeys({ latest: failing(5) } as unknown as SecretStore, config()).version('fec')).toBeNull();
  });
});
