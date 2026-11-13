import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { answer, type Interaction } from './interactions.js';
import type { Site } from './site.js';
import { signedByDiscord } from './verify.js';

/** An interaction is a few kilobytes. */
const MAX_BODY = 64 * 1024;
/** Discord waits three seconds from sending; this leaves time for the answer to travel back. */
const ANSWER_MS = 2_200;
/** After a failed check the key is asked for again at most this often, so forged requests cannot make it ask each time. */
const KEY_RECHECK_MS = 30_000;

export interface HttpOptions {
  readonly port: number;
  readonly host: string;
}

/**
 * The bot's commands service (design §10.18): `POST /interactions` is where Discord sends each slash command and
 * button press, signed; `GET /health` is for probes. A request that Discord did not sign is answered 401 and nothing
 * else, which is also what Discord checks before it accepts the address.
 */
export function startHttp(site: Site, options: HttpOptions): Promise<Server> {
  const server = createServer((req, res) => {
    handle(site, req, res).catch((e: unknown) => {
      console.error('ustp-discord: request failed', e);
      if (!res.headersSent) text(res, 500, 'internal error');
      else res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve(server));
  });
}

async function handle(site: Site, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const started = Date.now();
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path === '/health') return req.method === 'GET' ? text(res, 200, 'ok') : text(res, 405, 'method not allowed', 'GET');
  if (path !== '/interactions') return text(res, 404, 'not found');
  if (req.method !== 'POST') return text(res, 405, 'method not allowed', 'POST');

  const body = await read(req);
  if (!body) return text(res, 413, 'request too large');
  const signature = header(req, 'x-signature-ed25519');
  const timestamp = header(req, 'x-signature-timestamp');
  let key = await site.publicKey();
  let signed = !!key && signedByDiscord(key, signature, timestamp, body);
  if (!signed && site.keyAge() > KEY_RECHECK_MS) {
    key = await site.publicKey(true);
    signed = !!key && signedByDiscord(key, signature, timestamp, body);
  }
  if (!signed) return text(res, 401, 'invalid request signature');

  let interaction: unknown;
  try {
    interaction = JSON.parse(body.toString('utf8'));
  } catch {
    return text(res, 400, 'request is not JSON');
  }
  if (typeof interaction !== 'object' || interaction === null) return text(res, 400, 'request is not an interaction');
  const reply = await answer(interaction as Interaction, site, started + ANSWER_MS);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(reply));
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** The body exactly as it arrived (the signature covers its bytes); null when it is too large. */
async function read(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function text(res: ServerResponse, status: number, message: string, allow?: string) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...(allow && { allow }) });
  res.end(message);
}
