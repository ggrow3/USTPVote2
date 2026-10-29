import type { IEntryNestModule } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiModule } from './api/api.module.js';
import { createFastifyApp } from './common/create-app.js';
import { WorkerModule } from './worker/worker.module.js';

async function start(module: IEntryNestModule): Promise<NestFastifyApplication> {
  const app = await createFastifyApp(module, { quiet: true });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('api', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await start(ApiModule);
  });
  afterAll(() => app.close());

  it('answers health checks with the tally library version, uncached', async () => {
    for (const url of ['/healthz', '/v1/health']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      // Not a released image: no commit to report, so no header either.
      expect(res.json()).toEqual({ status: 'ok', tally: '0.1.0', commit: null });
      expect(res.headers['x-build-commit']).toBeUndefined();
    }
  });

  it('does not expose worker tasks', async () => {
    const res = await app.inject({ method: 'POST', url: '/tasks/tick' });
    expect(res.statusCode).toBe(404);
  });
});

describe('api in a released image', () => {
  const commit = '6743983abcdef0123456789abcdef0123456789a';
  let app: NestFastifyApplication;
  beforeAll(async () => {
    vi.stubEnv('BUILD_COMMIT', commit.toUpperCase());
    app = await start(ApiModule);
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('reports its commit in the health check and on every response, errors included', async () => {
    const health = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(health.json()).toEqual({ status: 'ok', tally: '0.1.0', commit });
    expect(health.headers['x-build-commit']).toBe(commit);
    const missing = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['x-build-commit']).toBe(commit);
  });
});

describe('worker', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await start(WorkerModule);
  });
  afterAll(() => app.close());

  // `tick` needs Firestore, so it is covered by the integration tests (ledger.int.test.ts, tally.int.test.ts).
  it('knows the design §13 tasks; those after tick come with email and certification', async () => {
    expect((await app.inject({ method: 'POST', url: '/tasks/email' })).statusCode).toBe(501);
    // Tallying is a step of the tick, not a task of its own.
    expect((await app.inject({ method: 'POST', url: '/tasks/tally' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/tasks/nope' })).statusCode).toBe(404);
  });
});
