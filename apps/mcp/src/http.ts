import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ElectionReports } from './reports.js';
import { createServer } from './server.js';

/** A JSON-RPC request to these tools is a few hundred bytes. */
const MAX_BODY = 64 * 1024;

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

/** Browser-based MCP clients send these with their POSTs; no cookies, so a wildcard origin is safe. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-protocol-version',
};

export interface HttpOptions {
  readonly port: number;
  readonly host: string;
  /**
   * Host header names to answer (without port). Defaults to the loopback names when listening on loopback, which stops
   * a web page from reaching a local server through DNS rebinding; empty means any (behind Cloud Run's front end).
   */
  readonly allowedHosts?: readonly string[];
}

/**
 * MCP's Streamable HTTP transport at `/mcp`, stateless (design §3.4): every POST is answered on its own with a fresh
 * server, as JSON rather than an event stream, so any instance can answer any request and nothing is kept per client.
 * Remote clients such as Gemini Enterprise connect here; `/health` is for probes.
 */
export function startHttp(reports: ElectionReports, options: HttpOptions): Promise<Server> {
  const allowed = options.allowedHosts ?? (LOOPBACK.includes(options.host) || options.host === '::1' ? LOOPBACK : []);
  const server = createHttpServer((req, res) => {
    handle(reports, allowed, req, res).catch((e: unknown) => {
      console.error('ustp-mcp: request failed', e);
      if (!res.headersSent) reply(res, 500, 'internal error');
      else res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve(server));
  });
}

async function handle(reports: ElectionReports, allowed: readonly string[], req: IncomingMessage, res: ServerResponse) {
  const host = hostname(req.headers.host);
  if (allowed.length > 0 && !allowed.includes(host)) return reply(res, 403, 'host not allowed');
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path === '/health') return req.method === 'GET' ? reply(res, 200, 'ok') : reply(res, 405, 'method not allowed', 'GET');
  if (path !== '/mcp') return reply(res, 404, 'not found');
  // Any web page may call it, as it may fetch the public api: nothing here takes credentials or cookies.
  for (const [name, value] of Object.entries(CORS)) res.setHeader(name, value);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-methods': 'POST', 'access-control-max-age': '86400' });
    return res.end();
  }
  // Stateless: no session to stream server notifications to (GET) or to end (DELETE).
  if (req.method !== 'POST') return reply(res, 405, 'method not allowed', 'POST');

  const body = await readJson(req);
  if (body === TOO_LARGE) return reply(res, 413, 'request too large');
  if (body === MALFORMED) return reply(res, 400, 'request is not JSON');

  const server = createServer(reports);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

const TOO_LARGE = Symbol('too large');
const MALFORMED = Symbol('malformed');

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) return TOO_LARGE;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return MALFORMED;
  }
}

/** The Host header's name, without port; IPv6 literals keep their brackets. */
function hostname(header: string | undefined): string {
  if (!header) return '';
  return header.startsWith('[') ? header.slice(0, header.indexOf(']') + 1) : header.replace(/:\d+$/, '').toLowerCase();
}

function reply(res: ServerResponse, status: number, text: string, allow?: string) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...(allow && { allow }) });
  res.end(text);
}
