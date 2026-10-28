import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { buildWorld, ELECTION_ID } from '../../../packages/verify/src/testing/fixtures.js';
import { CachingPublicApi } from './cached-api.js';
import { startHttp, type HttpOptions } from './http.js';
import { ElectionReports } from './reports.js';
import { report, serve, SITE } from './testing/world.js';

let server: Server | null = null;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

async function start(options: Partial<HttpOptions> = {}) {
  const reports = new ElectionReports(new CachingPublicApi(SITE, serve(await buildWorld()).fetchFn));
  server = await startHttp(reports, { port: 0, host: '127.0.0.1', ...options });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('Streamable HTTP', () => {
  it('answers an MCP client at /mcp, statelessly', async () => {
    const base = await start();
    for (let i = 0; i < 2; i++) {
      // A new client each time: no session ties a request to an instance.
      const client = new Client({ name: 'test', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(5);
      const listed = report((await client.callTool({ name: 'list_elections', arguments: {} })) as CallToolResult);
      expect(listed.elections.map((e: { electionId: string }) => e.electionId)).toEqual([ELECTION_ID]);
      await client.close();
    }
  });

  it('serves a health check and refuses everything else', async () => {
    const base = await start();
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/nothing`)).status).toBe(404);
    const get = await fetch(`${base}/mcp`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    const post = (body: string) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    expect((await post('{not json')).status).toBe(400);
    expect((await post(JSON.stringify({ padding: 'x'.repeat(70_000) }))).status).toBe(413);
  });

  it('lets a web page call it (CORS), with no credentials involved', async () => {
    const base = await start();
    const preflight = await fetch(`${base}/mcp`, {
      method: 'OPTIONS',
      headers: { origin: 'https://inspector.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, mcp-protocol-version' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-methods')).toBe('POST');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('mcp-protocol-version');
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull();

    // The header survives the SDK writing its own response.
    const answer = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { origin: 'https://inspector.example', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'web', version: '1' } } }),
    });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('access-control-allow-origin')).toBe('*');
    expect(((await answer.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe('ustp-vote-reports');
  });

  it('on loopback, answers only loopback host names (DNS rebinding)', async () => {
    const base = await start();
    const port = new URL(base).port;
    const status = async (host: string) =>
      new Promise<number>((resolve, reject) => {
        // fetch() will not send a Host header of the caller's choosing; node:http will.
        import('node:http').then(({ request }) =>
          request({ host: '127.0.0.1', port, path: '/health', headers: { host } }, (res) => resolve(res.statusCode ?? 0)).on('error', reject).end(),
        );
      });
    expect(await status(`localhost:${port}`)).toBe(200);
    expect(await status(`evil.example:${port}`)).toBe(403);
  });

  it('answers only the configured host names when given them', async () => {
    const base = await start({ allowedHosts: ['mcp.vote.test'] });
    expect((await fetch(`${base}/health`)).status).toBe(403);
  });
});
