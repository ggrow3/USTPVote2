import { Collections, racePath, racePlaces } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedElection } from './testing/elections.js';
import { resetEmulators, TestApi } from './testing/emulator.js';

/** A request as Firebase Hosting forwards it from the site at `host`. */
const get = (api: TestApi, url: string, host = 'vote.example.org') =>
  api.app.inject({ method: 'GET', url, headers: { 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });

describe('outside production', () => {
  let api: TestApi;
  beforeAll(async () => {
    api = await TestApi.start();
  });
  afterAll(() => api.close());
  beforeEach(() => resetEmulators());

  it('robots.txt turns every search engine away', async () => {
    const res = await get(api, '/robots.txt');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(res.body).toMatch(/^User-agent: \*\nDisallow: \/$/m);
  });

  it('no api response is a page for search results', async () => {
    for (const url of ['/robots.txt', '/v1/health', '/v1/hub', '/v1/nothing']) {
      expect((await get(api, url)).headers['x-robots-tag'], url).toBe('noindex');
    }
  });

  it('the sitemap lists the public pages, each bylaws version and each certified result, but no rehearsal', async () => {
    const db = api.firebase.db;
    await db.collection(Collections.bylawsVersions).doc('2026.1').set({
      version: '2026.1',
      title: 'Bylaws',
      contentHash: 'a'.repeat(64),
      publishedAt: '2026-10-01T12:00:00.000Z',
      publishedBy: 'someone',
      amends: null,
      changeNote: '',
    });
    const certified = await seedElection(api, { voters: [], state: 'certified' });
    await certified.ref.update({ certifiedAt: '2026-10-20T18:00:00.000Z' });
    const rehearsal = await seedElection(api, { voters: [], state: 'certified', rehearsal: true });
    const closed = await seedElection(api, { voters: [], state: 'closed' });

    const res = await get(api, '/sitemap.xml');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/xml; charset=utf-8');
    const urls = [...res.body.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)].map((m) => [m[1], m[2]]);
    // Then every race page (design §5.17); no person's yet, since no race's records have been read.
    expect(urls.slice(13)).toEqual(racePlaces().map((p) => [`https://vote.example.org${racePath(p)}`, undefined]));
    expect(urls.slice(0, 13)).toEqual([
      ['https://vote.example.org/', undefined],
      ['https://vote.example.org/vote', undefined],
      ['https://vote.example.org/register', undefined],
      ['https://vote.example.org/courses', undefined],
      ['https://vote.example.org/course/transhumanism', undefined],
      ['https://vote.example.org/bylaws', '2026-10-01T12:00:00.000Z'],
      ['https://vote.example.org/offices', undefined],
      ['https://vote.example.org/verify', undefined],
      ['https://vote.example.org/events', undefined],
      ['https://vote.example.org/partners', undefined],
      ['https://vote.example.org/races', undefined],
      ['https://vote.example.org/bylaws/2026.1', '2026-10-01T12:00:00.000Z'],
      [`https://vote.example.org/results/${certified.electionId}`, '2026-10-20T18:00:00.000Z'],
    ]);
    expect(res.body).not.toContain(rehearsal.electionId);
    expect(res.body).not.toContain(closed.electionId);
  });
});

describe('in production', () => {
  let api: TestApi;
  beforeAll(async () => {
    process.env.DEPLOYMENT_ENVIRONMENT = 'prod';
    process.env.WEB_ORIGIN = 'https://vote.example.org';
    api = await TestApi.start();
  });
  afterAll(async () => {
    delete process.env.DEPLOYMENT_ENVIRONMENT;
    delete process.env.WEB_ORIGIN;
    await api.close();
  });

  it('robots.txt opens the site at its own address and points at the sitemap', async () => {
    const res = await get(api, '/robots.txt');
    expect(res.body).toContain('User-agent: *\nDisallow: /mcp\nDisallow: /__/\n');
    expect(res.body).toContain('Sitemap: https://vote.example.org/sitemap.xml');
  });

  it('robots.txt keeps the same site at its other addresses closed', async () => {
    const res = await get(api, '/robots.txt', 'ustpvote2-prod.firebaseapp.com');
    expect(res.body).toMatch(/^Disallow: \/$/m);
    expect(res.body).not.toContain('Sitemap');
  });
});
