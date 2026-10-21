import type { IEntryNestModule } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  it('answers health checks with the tally library version', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', tally: '0.1.0' });
  });

  it('does not expose worker tasks', async () => {
    const res = await app.inject({ method: 'POST', url: '/tasks/tick' });
    expect(res.statusCode).toBe(404);
  });
});

describe('worker', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await start(WorkerModule);
  });
  afterAll(() => app.close());

  // `tick` needs Firestore, so it is covered by the integration tests (ledger.int.test.ts).
  it('knows the design §13 tasks; those after tick come with tallying and email', async () => {
    expect((await app.inject({ method: 'POST', url: '/tasks/tally' })).statusCode).toBe(501);
    expect((await app.inject({ method: 'POST', url: '/tasks/nope' })).statusCode).toBe(404);
  });
});
