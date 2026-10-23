import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GravatarClient, GravatarError, gravatarHash, gravatarUrl } from './photos/gravatar.js';

describe('gravatarHash', () => {
  it("is Gravatar's documented SHA-256 of the trimmed, lowercased address", () => {
    // The worked example in docs.gravatar.com/rest/hash.
    expect(gravatarHash('MyEmailAddress@example.com ')).toBe('84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee');
    expect(gravatarHash('  myemailaddress@EXAMPLE.com')).toBe(gravatarHash('myemailaddress@example.com'));
  });

  it('asks for our largest size, a 404 when there is no picture, and G-rated pictures only', () => {
    const url = new URL(gravatarUrl('https://gravatar.com/avatar', 'MyEmailAddress@example.com'));
    expect(url.origin + url.pathname).toBe('https://gravatar.com/avatar/84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee');
    expect(Object.fromEntries(url.searchParams)).toEqual({ s: '1024', d: '404', r: 'g' });
    expect(url.href).not.toMatch(/example\.com/i);
  });
});

/** A stand-in for Gravatar; each test says how it answers. */
let server: Server;
let base: string;
let answer: (req: IncomingMessage, res: ServerResponse) => void;
const seen: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req.url ?? '');
    answer(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/avatar`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  seen.length = 0;
  server.closeAllConnections();
});

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

async function failure(client: GravatarClient): Promise<GravatarError> {
  const error = await client.fetch('robin@example.test').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(GravatarError);
  return error as GravatarError;
}

describe('GravatarClient', () => {
  it('returns the image bytes, asking by hash only', async () => {
    answer = (_req, res) => res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
    expect(await new GravatarClient(base).fetch(' Robin@Example.test')).toEqual(PNG);
    expect(seen).toEqual([`/avatar/${gravatarHash('robin@example.test')}?s=1024&d=404&r=g`]);
  });

  it('says when there is no picture', async () => {
    answer = (_req, res) => res.writeHead(404, { 'content-type': 'text/html' }).end('Not Found');
    expect(await failure(new GravatarClient(base))).toMatchObject({ kind: 'none' });
  });

  it('refuses redirects, errors and answers that are not images', async () => {
    answer = (_req, res) => res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
    expect(await failure(new GravatarClient(base))).toMatchObject({ kind: 'unavailable', message: 'Gravatar answered 302' });
    answer = (_req, res) => res.writeHead(500).end();
    expect(await failure(new GravatarClient(base))).toMatchObject({ kind: 'unavailable' });
    answer = (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html>');
    expect(await failure(new GravatarClient(base))).toMatchObject({ kind: 'not-image' });
  });

  it('stops at the size limit, whether or not the length is announced', async () => {
    answer = (_req, res) => res.writeHead(200, { 'content-type': 'image/png', 'content-length': '2000' }).end(Buffer.alloc(2000));
    expect(await failure(new GravatarClient(base, 5_000, 1_000))).toMatchObject({ kind: 'too-large' });
    answer = (_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' }); // chunked, no length
      for (let i = 0; i < 4; i++) res.write(Buffer.alloc(500));
      res.end();
    };
    expect(await failure(new GravatarClient(base, 5_000, 1_000))).toMatchObject({ kind: 'too-large' });
  });

  it('gives up after the timeout, while waiting for headers or for the body', async () => {
    answer = () => undefined; // never answers
    expect(await failure(new GravatarClient(base, 200))).toMatchObject({ kind: 'unavailable', message: 'Gravatar did not answer in time' });
    answer = (_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.write(PNG); // and never finishes
    };
    expect(await failure(new GravatarClient(base, 200))).toMatchObject({ kind: 'unavailable', message: 'Gravatar did not answer in time' });
  });

  it('says when Gravatar cannot be reached', async () => {
    const closed = new GravatarClient('http://127.0.0.1:9/avatar');
    expect(await failure(closed)).toMatchObject({ kind: 'unavailable', message: 'Gravatar could not be reached' });
  });
});
