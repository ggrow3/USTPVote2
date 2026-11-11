import { Controller, Get, Logger, Module, Post, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NoActorLog } from './auth/decorators.js';
import type { RequestContext } from './auth/principal.js';
import { createFastifyApp } from './common/create-app.js';
import { parseTrace, requestLine } from './common/logging.js';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

describe('parseTrace', () => {
  it('reads the W3C header', () => {
    expect(parseTrace({ traceparent: `00-${TRACE}-00f067aa0ba902b7-01` }, 'p')).toEqual({
      trace: `projects/p/traces/${TRACE}`,
      spanId: '00f067aa0ba902b7',
    });
  });

  it("reads Google's header, whose span is decimal", () => {
    expect(parseTrace({ 'x-cloud-trace-context': `${TRACE}/255;o=1` }, 'p')).toEqual({
      trace: `projects/p/traces/${TRACE}`,
      spanId: '00000000000000ff',
    });
    expect(parseTrace({ 'x-cloud-trace-context': TRACE }, 'p')).toEqual({ trace: `projects/p/traces/${TRACE}` });
  });

  it('writes nothing for a missing or malformed header, or without a project', () => {
    expect(parseTrace({}, 'p')).toEqual({});
    expect(parseTrace({ traceparent: 'nonsense', 'x-cloud-trace-context': 'also/nonsense' }, 'p')).toEqual({});
    expect(parseTrace({ traceparent: `00-${'0'.repeat(32)}-00f067aa0ba902b7-01` }, 'p')).toEqual({});
    expect(parseTrace({ traceparent: `00-${TRACE}-00f067aa0ba902b7-01` }, undefined)).toEqual({});
  });
});

describe('requestLine', () => {
  const facts = { method: 'GET', url: '/v1/admin/members?q=ada%40example.org', route: '/v1/admin/members', status: 200, elapsedMs: 12.4 };

  it('drops the query string', () => {
    const line = requestLine(facts, undefined);
    expect(JSON.stringify(line)).not.toContain('ada');
    expect(line.fields.httpRequest).toEqual({ requestMethod: 'GET', requestUrl: '/v1/admin/members', status: 200, latency: '0.012s' });
    expect(line.message).toBe('GET /v1/admin/members 200');
    expect(line.level).toBe('info');
  });

  it('writes a path that carries a secret as its pattern', () => {
    const line = requestLine({ ...facts, url: '/v1/public/mail/s3cr3t/status', route: '/v1/public/mail/:token/status' }, undefined);
    expect(JSON.stringify(line)).not.toContain('s3cr3t');
  });

  it('keeps health checks for debugging, and marks a server error', () => {
    expect(requestLine({ ...facts, url: '/healthz', route: '/healthz' }, undefined).level).toBe('debug');
    expect(requestLine({ ...facts, status: 500 }, undefined).level).toBe('warn');
  });
});

const CALLER: RequestContext = {
  principal: { uid: 'u1', email: 'ada@example.org', emailVerified: true, name: 'Ada', provider: 'password', mfa: true, authTime: 0 },
  accountId: 'acct-1',
  roles: ['system_admin'],
  operator: null,
};

/** Stands in for the AuthGuard: every request is Ada's. */
class SignedIn implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<FastifyRequest>().ctx = CALLER;
    return true;
  }
}

@Controller('things')
class ThingsController {
  private readonly logger = new Logger('Things');

  @Get()
  list() {
    this.logger.log('listing');
    this.logger.log({ message: 'ledger role.granted', event: 'role.granted', seq: 7 });
    return [];
  }

  @Post('ballots')
  @NoActorLog()
  cast() {
    this.logger.log('casting');
    return {};
  }

  @Get('broken')
  broken() {
    throw new TypeError('boom');
  }
}

@Module({ controllers: [ThingsController], providers: [{ provide: APP_GUARD, useClass: SignedIn }] })
class ThingsModule {}

describe('the log of a request', () => {
  let app: NestFastifyApplication;
  const written: string[] = [];
  const lines = () => written.map((line) => JSON.parse(line) as Record<string, unknown>);
  const requestLines = () => lines().filter((line) => line.httpRequest);

  beforeAll(async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'p';
    app = await createFastifyApp(ThingsModule, { logStream: { write: (line) => written.push(line) } });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app.close();
    delete process.env.GOOGLE_CLOUD_PROJECT;
  });
  beforeEach(() => {
    written.length = 0;
  });

  it('is one line saying what, who and which handler, and ties every line of the request together', async () => {
    await app.inject({
      method: 'GET',
      url: '/things?q=ada%40example.org',
      headers: { traceparent: `00-${TRACE}-00f067aa0ba902b7-01`, authorization: 'Bearer secret-token', 'x-forwarded-for': '203.0.113.9' },
    });
    const [request, ...none] = requestLines();
    expect(none).toEqual([]);
    expect(request).toMatchObject({
      severity: 'INFO',
      message: 'GET /things 200',
      action: 'ThingsController.list',
      accountId: 'acct-1',
      roles: ['system_admin'],
      route: '/things',
      'logging.googleapis.com/trace': `projects/p/traces/${TRACE}`,
      'logging.googleapis.com/spanId': '00f067aa0ba902b7',
    });
    expect(request?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    const own = lines().filter((line) => line.context === 'Things');
    expect(own).toHaveLength(2);
    for (const line of own) {
      expect(line.requestId).toBe(request?.requestId);
      expect(line['logging.googleapis.com/trace']).toBe(`projects/p/traces/${TRACE}`);
    }
    expect(own[1]).toMatchObject({ message: 'ledger role.granted', event: 'role.granted', seq: 7 });
    // Nothing of the caller but the account: no address, email, token or search.
    const all = written.join('');
    for (const secret of ['secret-token', '203.0.113.9', 'ada', '127.0.0.1', 'remoteAddress']) expect(all).not.toContain(secret);
  });

  it('never says who cast a ballot', async () => {
    await app.inject({ method: 'POST', url: '/things/ballots' });
    expect(requestLines()).toHaveLength(1);
    expect(requestLines()[0]).toMatchObject({ action: 'ThingsController.cast', message: 'POST /things/ballots 201' });
    const all = written.join('');
    for (const actor of ['acct-1', 'accountId', 'system_admin', 'operator']) expect(all).not.toContain(actor);
  });

  it('writes an unexpected error once, as an entry Error Reporting groups, with the request around it', async () => {
    const res = await app.inject({ method: 'GET', url: '/things/broken', headers: { 'x-cloud-trace-context': `${TRACE}/1` } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('boom');
    const errors = lines().filter((line) => line.severity === 'ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      message: 'boom',
      context: 'ProblemDetails',
      action: 'ThingsController.broken',
      accountId: 'acct-1',
      '@type': 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
      'logging.googleapis.com/trace': `projects/p/traces/${TRACE}`,
    });
    expect(errors[0]?.stack_trace).toMatch(/^TypeError: boom\n\s+at /);
    expect(requestLines()[0]).toMatchObject({ severity: 'WARNING', message: 'GET /things/broken 500' });
  });

  it('logs a request no route answers, without an action', async () => {
    await app.inject({ method: 'GET', url: '/nope?x=1' });
    expect(requestLines()[0]).toMatchObject({ message: 'GET /nope 404' });
    expect(requestLines()[0]).not.toHaveProperty('action');
  });
});
