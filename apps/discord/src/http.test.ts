import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startHttp } from './http.js';
import { Site } from './site.js';
import { signedByDiscord } from './verify.js';

const ORIGIN = 'https://vote.example.org';

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  // The last 32 bytes of the DER form are the raw key, which is what Discord shows as hex.
  return { privateKey, hex: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex') };
}

const signature = (privateKey: KeyObject, timestamp: string, body: string) => sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');

/** The site's public api, as far as this service reads it; `calls` counts the reads of each path. */
function fakeSite(routes: Record<string, unknown>, calls: Record<string, number> = {}) {
  const fetcher = (async (input: string | URL | Request) => {
    const path = String(input).slice(ORIGIN.length);
    calls[path] = (calls[path] ?? 0) + 1;
    const found = routes[path];
    if (found === undefined) return new Response('not found', { status: 404 });
    if (found instanceof Promise) return new Response(JSON.stringify(await found));
    return new Response(JSON.stringify(found));
  }) as typeof fetch;
  return { fetcher, calls };
}

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

async function serve(site: Site) {
  server = await startHttp(site, { port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (privateKey: KeyObject, interaction: unknown, change: { body?: string; timestamp?: string } = {}) => {
    const body = JSON.stringify(interaction);
    const timestamp = '1790000000';
    return fetch(`${base}/interactions`, {
      method: 'POST',
      headers: { 'x-signature-ed25519': signature(privateKey, timestamp, body), 'x-signature-timestamp': change.timestamp ?? timestamp, 'content-type': 'application/json' },
      body: change.body ?? body,
    });
  };
  return { base, send };
}

describe('signedByDiscord', () => {
  it('takes a signature by the key over the timestamp and body, and nothing else', () => {
    const { privateKey, hex } = keyPair();
    const good = signature(privateKey, '1', '{}');
    expect(signedByDiscord(hex, good, '1', Buffer.from('{}'))).toBe(true);
    expect(signedByDiscord(hex, good, '2', Buffer.from('{}'))).toBe(false);
    expect(signedByDiscord(hex, good, '1', Buffer.from('{ }'))).toBe(false);
    expect(signedByDiscord(keyPair().hex, good, '1', Buffer.from('{}'))).toBe(false);
    expect(signedByDiscord(hex, undefined, '1', Buffer.from('{}'))).toBe(false);
    expect(signedByDiscord(hex, 'zz', '1', Buffer.from('{}'))).toBe(false);
    expect(signedByDiscord('not a key', good, '1', Buffer.from('{}'))).toBe(false);
  });
});

describe('the commands service', () => {
  it('answers /health, and nothing at other paths', async () => {
    const { base } = await serve(new Site(ORIGIN, fakeSite({}).fetcher));
    expect(await (await fetch(`${base}/health`)).text()).toBe('ok');
    expect((await fetch(`${base}/interactions`)).status).toBe(405);
    expect((await fetch(`${base}/other`)).status).toBe(404);
  });

  it("answers Discord's ping when it is signed, and 401 when it is not", async () => {
    const { privateKey, hex } = keyPair();
    const { send } = await serve(new Site(ORIGIN, fakeSite({ '/v1/public/discord/app': { publicKey: hex } }).fetcher));
    const pong = await send(privateKey, { type: 1 });
    expect(pong.status).toBe(200);
    expect(await pong.json()).toEqual({ type: 1 });
    expect((await send(keyPair().privateKey, { type: 1 })).status).toBe(401);
    expect((await send(privateKey, { type: 1 }, { body: '{"type":1,"x":1}' })).status).toBe(401);
    expect((await send(privateKey, { type: 1 }, { timestamp: '1790000001' })).status).toBe(401);
  });

  it('answers nothing while the site has no key', async () => {
    const { privateKey } = keyPair();
    const { send } = await serve(new Site(ORIGIN, fakeSite({ '/v1/public/discord/app': { publicKey: null } }).fetcher));
    expect((await send(privateKey, { type: 1 })).status).toBe(401);
  });

  it('answers a command privately, with a button to post it, from the site', async () => {
    const { privateKey, hex } = keyPair();
    const site = fakeSite({
      '/v1/public/discord/app': { publicKey: hex },
      '/v1/public/discord/votes': [{ electionId: 'e1', title: 'Platform vote', closesAt: '2026-12-01T00:00:00.000Z' }],
    });
    const { send } = await serve(new Site(ORIGIN, site.fetcher));
    const res = await send(privateKey, { type: 2, data: { name: 'vote' }, member: { user: { id: '1' } } });
    expect(res.status).toBe(200);
    const reply = (await res.json()) as { type: number; data: { flags: number; embeds: { title: string; description: string; url: string }[]; components: unknown[]; allowed_mentions: unknown } };
    expect(reply.type).toBe(4);
    expect(reply.data.flags).toBe(64);
    expect(reply.data.allowed_mentions).toEqual({ parse: [] });
    expect(reply.data.embeds[0]).toMatchObject({ title: 'One vote is open', url: `${ORIGIN}/ballot?utm_source=discord` });
    expect(reply.data.embeds[0]!.description).toContain('**Platform vote**');
    expect(reply.data.components).toEqual([{ type: 1, components: [{ type: 2, style: 2, label: 'Post in channel', custom_id: 'share:vote' }] }]);

    // A second run within the minute is answered from what was kept.
    await send(privateKey, { type: 2, data: { name: 'vote' } });
    expect(site.calls['/v1/public/discord/votes']).toBe(1);
    expect(site.calls['/v1/public/discord/app']).toBe(1);
  });

  it('posts in the channel when the button is pressed, without the button', async () => {
    const { privateKey, hex } = keyPair();
    const { send } = await serve(new Site(ORIGIN, fakeSite({ '/v1/public/discord/app': { publicKey: hex }, '/v1/news': [] }).fetcher));
    const reply = (await (await send(privateKey, { type: 3, data: { custom_id: 'share:news' } })).json()) as { type: number; data: Record<string, unknown> };
    expect(reply.type).toBe(4);
    expect(reply.data.flags).toBeUndefined();
    expect(reply.data.components).toBeUndefined();
    expect(reply.data.embeds).toMatchObject([{ title: 'No news yet' }]);
  });

  it('says so privately for a command or button it does not know, or when the site fails', async () => {
    const { privateKey, hex } = keyPair();
    const { send } = await serve(new Site(ORIGIN, fakeSite({ '/v1/public/discord/app': { publicKey: hex } }).fetcher));
    for (const interaction of [{ type: 2, data: { name: 'ask' } }, { type: 3, data: { custom_id: 'share:ask' } }, { type: 3, data: { custom_id: 'other' } }, { type: 9 }]) {
      const reply = (await (await send(privateKey, interaction)).json()) as { data: { content: string; flags: number } };
      expect(reply.data).toMatchObject({ content: 'This bot does not know that command. Try `/help`.', flags: 64 });
    }
    const failed = (await (await send(privateKey, { type: 2, data: { name: 'events' } })).json()) as { data: { content: string; flags: number } };
    expect(failed.data).toMatchObject({ content: 'The site could not be read just now. Try again in a minute.', flags: 64 });
  });

  it('asks the person to try again when the site is slow, and answers the next try from that read', async () => {
    const { privateKey, hex } = keyPair();
    let arrive: (value: unknown) => void = () => undefined;
    const slow = new Promise((resolve) => (arrive = resolve));
    const { send } = await serve(new Site(ORIGIN, fakeSite({ '/v1/public/discord/app': { publicKey: hex }, '/v1/public/bills': slow }).fetcher));
    const first = (await (await send(privateKey, { type: 2, data: { name: 'bills' } })).json()) as { data: { content: string } };
    expect(first.data.content).toBe('The site is waking up. Try again in a few seconds.');
    arrive([]);
    const second = (await (await send(privateKey, { type: 2, data: { name: 'bills' } })).json()) as { data: { embeds: { title: string }[] } };
    expect(second.data.embeds[0]!.title).toBe('No bills are listed right now');
  });

  it('asks for the key again after a failed check, but not on every one', async () => {
    const first = keyPair();
    const second = keyPair();
    const routes: Record<string, unknown> = { '/v1/public/discord/app': { publicKey: first.hex } };
    const site = fakeSite(routes);
    let clock = 1_000_000;
    const { send } = await serve(new Site(ORIGIN, site.fetcher, () => clock));
    expect((await send(first.privateKey, { type: 1 })).status).toBe(200);
    // The party made a new application: the site now gives its key.
    routes['/v1/public/discord/app'] = { publicKey: second.hex };
    expect((await send(second.privateKey, { type: 1 })).status).toBe(401);
    expect(site.calls['/v1/public/discord/app']).toBe(1);
    clock += 31_000;
    expect((await send(second.privateKey, { type: 1 })).status).toBe(200);
    expect(site.calls['/v1/public/discord/app']).toBe(2);
  });
});
