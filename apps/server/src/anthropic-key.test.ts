import { describe, expect, it } from 'vitest';
import { AnthropicKey } from './claude-checks/anthropic-key.js';
import { ClaudeKeyTester } from './claude-checks/key-tester.js';
import type { SecretStore, SecretVersion } from './infra/secret-store.js';

// Made up, in the shape of an Anthropic API key; never a real one.
const KEY = `sk-ant-api03-${'k'.repeat(80)}-AAAA`;

/** A `fetch` that answers the Models API with `status`, recording each request; `null` fails to connect. */
function fakeModels(status: number | null, seen: Request[] = []): typeof globalThis.fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(new Request(url, init));
    if (status === null) throw new TypeError('fetch failed');
    const body = status === 200 ? { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' } : { type: 'error', error: { type: 'x', message: 'from Anthropic' } };
    return Response.json(body, { status });
  }) as typeof globalThis.fetch;
}

const tester = (fetch: typeof globalThis.fetch) => new ClaudeKeyTester({ fetch, maxRetries: 0 });

describe('trying a key with Anthropic', () => {
  it('asks the Models API for each model the checks use, sending only the key', async () => {
    const seen: Request[] = [];
    expect(await tester(fakeModels(200, seen)).try(KEY, ['claude-opus-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'])).toEqual({ ok: true });
    expect(seen.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual(['GET /v1/models/claude-opus-5-5', 'GET /v1/models/claude-sonnet-5-5']);
    expect(seen[0]!.headers.get('x-api-key')).toBe(KEY);
    expect(seen[0]!.body).toBeNull();
  });

  it('says in words why it would not take one, never passing on what Anthropic said', async () => {
    const cases = [
      [401, 'rejected', /did not accept this key/],
      [403, 'rejected', /does not let it use the API/],
      [404, 'rejected', /does not offer claude-opus-5-5/],
      [429, 'unreachable', /could not be asked/],
      [529, 'unreachable', /could not be asked/],
      [null, 'unreachable', /nothing was saved/],
    ] as const;
    for (const [status, refusal, reason] of cases) {
      const trial = await tester(fakeModels(status)).try(KEY, ['claude-opus-5-5']);
      expect(trial).toEqual({ ok: false, refusal, reason: expect.stringMatching(reason) });
      expect(JSON.stringify(trial)).not.toContain('from Anthropic');
    }
  });
});

describe('the key the worker reads', () => {
  const store = (read: SecretStore['read'], latest: SecretVersion | null = null) =>
    ({ read, latest: async () => latest }) as unknown as SecretStore;

  it('is none when the secret has no live version, and any other failure is passed on', async () => {
    const failing = (code: number) => async () => Promise.reject(Object.assign(new Error(`grpc ${code}`), { code }));
    expect(await new AnthropicKey(store(failing(5))).read()).toBeNull();
    expect(await new AnthropicKey(store(failing(9))).read()).toBeNull();
    await expect(new AnthropicKey(store(failing(7))).read()).rejects.toThrow(/grpc 7/);
    expect(await new AnthropicKey(store(async () => KEY)).read()).toBe(KEY);
  });

  it('is not offered, rather than failing the page, while the api may not look at the secret', async () => {
    const denied = new AnthropicKey({ latest: async () => Promise.reject(Object.assign(new Error('denied'), { code: 7 })) } as unknown as SecretStore);
    expect(await denied.ready('claude')).toBe(false);
    await expect(denied.current({ fresh: true })).rejects.toThrow(/may not look at the anthropic-api-key secret yet: apply the Terraform/);
    const missing = new AnthropicKey({ latest: async () => Promise.reject(Object.assign(new Error('gone'), { code: 5 })) } as unknown as SecretStore);
    expect(await missing.current()).toBeNull();
  });

  it('lets the stand-in run without one, and Claude only with one', async () => {
    const version = { name: 'projects/p/secrets/anthropic-api-key/versions/3', createdAt: '2026-10-27T10:00:00.000Z' };
    const none = new AnthropicKey(store(async () => null));
    const some = new AnthropicKey(store(async () => KEY, version));
    expect([await none.ready('stub'), await none.ready('claude'), await none.ready('off')]).toEqual([true, false, false]);
    expect([await some.ready('claude'), await some.ready('off')]).toEqual([true, false]);
  });
});
