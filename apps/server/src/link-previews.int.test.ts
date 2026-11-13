import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { Collections, nextFederalElectionYear, type CandidacyContent } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RacesService } from './candidacies/races.service.js';
import { PAGE_HEADERS } from './link-previews/link-previews.controller.js';
import { seedElection } from './testing/elections.js';
import { resetEmulators, TestApi } from './testing/emulator.js';

/** The web app's index.html as Hosting serves it, with an ETag, answering 304 to a matching If-None-Match. */
const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="The site's description." />
    <meta property="og:site_name" content="USTP Vote" />
    <meta property="og:title" content="USTP Vote · U.S. Transhumanist Party" />
    <meta property="og:image" content="https://site.example/icons/share-card.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="module" crossorigin src="/assets/index-abc123.js"></script>
    <title>USTP Vote</title>
  </head>
  <body><div id="app"></div></body>
</html>
`;

class IndexServer {
  requests: { ifNoneMatch: string | undefined }[] = [];
  down = false;
  private constructor(private readonly server: Server) {}

  static async start(): Promise<IndexServer> {
    let self: IndexServer;
    const server = createServer((req, res) => {
      self.requests.push({ ifNoneMatch: req.headers['if-none-match'] });
      if (self.down || req.url !== '/index.html') {
        res.writeHead(self.down ? 503 : 404).end();
      } else if (req.headers['if-none-match'] === '"v1"') {
        res.writeHead(304).end();
      } else {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', etag: '"v1"' }).end(INDEX);
      }
    });
    self = new IndexServer(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return self;
  }

  get origin(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

/** A request as Firebase Hosting forwards it from the site at `host`. */
const get = (api: TestApi, url: string, host = 'vote.example.org') =>
  api.app.inject({ method: 'GET', url, headers: { 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });

const meta = (html: string, key: string) => html.match(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`))?.[1];

async function seedNews(api: TestApi, slug: string, status: 'published' | 'draft' | 'withdrawn') {
  await api.firebase.db.collection(Collections.newsPosts).doc(`post-${slug}`).set({
    postId: `post-${slug}`,
    slug,
    status,
    kind: 'press_release',
    title: 'Party backs longevity research',
    summary: 'The party asks Congress to fund research into ageing.',
    body: 'Text.',
    dateline: 'Washington, D.C.',
    hashtags: [],
    video: null,
    version: 1,
    createdAt: '2026-11-01T12:00:00.000Z',
    createdBy: 'admin',
    updatedAt: '2026-11-01T12:00:00.000Z',
    updatedBy: 'admin',
    publishedAt: status === 'draft' ? null : '2026-11-01T12:00:00.000Z',
    publishedBy: status === 'draft' ? null : 'admin',
    editedAt: null,
    withdrawnAt: status === 'withdrawn' ? '2026-11-02T12:00:00.000Z' : null,
    withdrawnBy: status === 'withdrawn' ? 'admin' : null,
  });
}

async function seedCandidacy(api: TestApi, candidacyId: string, open: boolean) {
  const db = api.firebase.db;
  const content: CandidacyContent = {
    office: 'us_house',
    officeTitle: 'U.S. Representative',
    district: { kind: 'congressional', geoid: '0612', state: 'CA', name: 'Congressional District 12', point: null, vintage: null },
    electionDate: '2026-11-03',
    election: 'general',
    ballotLabel: null,
    platform: 'Fund longevity research.',
    website: null,
  };
  await db.collection(Collections.members).doc(`acct-${candidacyId}`).set({ accountId: `acct-${candidacyId}`, status: 'active', legalName: 'Ada Brooks', preferredName: null });
  await db.collection(Collections.candidacies).doc(candidacyId).set({
    candidacyId,
    accountId: `acct-${candidacyId}`,
    status: open ? 'open' : 'withdrawn',
    published: content,
    publishedAt: '2026-10-01T12:00:00.000Z',
    publishedBy: 'admin',
    proposed: null,
    proposedAt: null,
    declined: null,
    public: open,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  });
}

describe('link previews outside production', () => {
  let index: IndexServer;
  let api: TestApi;
  beforeAll(async () => {
    index = await IndexServer.start();
    process.env.WEB_ORIGIN = index.origin;
    api = await TestApi.start();
  });
  afterAll(async () => {
    delete process.env.WEB_ORIGIN;
    await api.close();
    await index.close();
  });
  beforeEach(() => resetEmulators());

  it("serves a published post's page with its own title, description and card, the rest of index.html as built", async () => {
    await seedNews(api, 'longevity', 'published');
    const res = await get(api, '/news/longevity');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-robots-tag']).toBe('noindex');
    for (const [name, value] of Object.entries(PAGE_HEADERS)) expect(res.headers[name.toLowerCase()], name).toBe(value);
    const html = res.body;
    expect(html).toContain('<title>Party backs longevity research · USTP Vote</title>');
    expect(meta(html, 'description')).toBe('The party asks Congress to fund research into ageing.');
    expect(meta(html, 'og:title')).toBe('Party backs longevity research');
    expect(meta(html, 'og:type')).toBe('article');
    expect(meta(html, 'og:url')).toBe(`${index.origin}/news/longevity`);
    expect(meta(html, 'og:image')).toMatch(new RegExp(`^${index.origin}/v1/public/link-cards\\?path=%2Fnews%2Flongevity&amp;v=[\\w-]{12}$`));
    expect(meta(html, 'og:image:alt')).toBe('News · Press release: Party backs longevity research');
    expect(html).not.toContain("The site's description.");
    expect(html).not.toContain('share-card.png');
    expect(html).toContain('<script type="module" crossorigin src="/assets/index-abc123.js"></script>');
  });

  it('draws the card the page names, a PNG anyone may fetch', async () => {
    await seedNews(api, 'longevity', 'published');
    const image = meta((await get(api, '/news/longevity')).body, 'og:image')!.replace(index.origin, '').replace('&amp;', '&');
    const res = await get(api, image);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('public, max-age=3600, s-maxage=86400');
    const { width, height, format } = await sharp(res.rawPayload).metadata();
    expect({ width, height, format }).toEqual({ width: 1200, height: 630, format: 'png' });
  });

  it("serves index.html as built for a page with nothing public, and has no card for it", async () => {
    await seedNews(api, 'draft', 'draft');
    await seedNews(api, 'gone', 'withdrawn');
    for (const path of ['/news/draft', '/news/gone', '/news/nothing', '/candidates/declare']) {
      const res = await get(api, path);
      expect(res.statusCode, path).toBe(200);
      expect(res.body, path).toBe(INDEX);
      expect((await get(api, `/v1/public/link-cards?path=${encodeURIComponent(path)}`)).statusCode, path).toBe(404);
    }
  });

  it('has no card for a path that is no preview page', async () => {
    for (const path of ['/', '/news', '/offices', '/candidates/a%2Fb', '/v1/hub', 'news/x']) {
      expect((await get(api, `/v1/public/link-cards?path=${encodeURIComponent(path)}`)).statusCode, path).toBe(404);
    }
    expect((await get(api, '/v1/public/link-cards')).statusCode).toBe(404);
  });

  it("previews a member's public candidacy, and not a withdrawn one", async () => {
    await seedCandidacy(api, 'cand-open', true);
    await seedCandidacy(api, 'cand-gone', false);
    const html = (await get(api, '/candidates/cand-open')).body;
    expect(html).toContain('<title>Ada Brooks · Candidates · USTP Vote</title>');
    expect(meta(html, 'og:type')).toBe('profile');
    expect(meta(html, 'description')).toBe(
      "Ada Brooks, the U.S. Transhumanist Party&#39;s candidate for U.S. Representative, Congressional District 12, California: general election on Nov 3, 2026. Fund longevity research.",
    );
    expect(meta(html, 'og:image:alt')).toBe('Candidate · U.S. Representative: Ada Brooks');
    expect((await get(api, '/candidates/cand-gone')).body).toBe(INDEX);
  });

  it('previews a race page at once, from the records it holds, never waiting for them; a person’s once their race is read', async () => {
    const year = nextFederalElectionYear(new Date().toISOString().slice(0, 10));
    api.app.get(RacesService).forget();
    // Nothing read yet: the page and its card say what the race is, and nobody is asked; a person's page has none.
    const first = (await get(api, '/races/ca/1')).body;
    expect(first).toContain(`<title>${year} candidates in CA-1 · USTP Vote</title>`);
    expect(meta(first, 'og:image:alt')).toBe(`U.S. House · ${year}: ${year} candidates in CA-1`);
    expect(meta(first, 'description')).not.toMatch(/listed so far/);
    expect((await api.firebase.db.collection(Collections.raceRecords).get()).size).toBe(0);
    expect((await get(api, '/people/H060100')).body).toBe(INDEX);
    // Once the page has been read, its preview names who holds the seat and how many run.
    await get(api, '/v1/public/races/ca/1');
    const html = (await get(api, '/races/ca/1')).body;
    expect(meta(html, 'description')).toMatch(/who holds the seat now: Hal House \(Democrat\)\. 2 candidates listed so far\./);
    expect(meta(html, 'og:url')).toBe(`${index.origin}/races/ca/1`);
    const state = (await get(api, '/races/ca')).body;
    expect(state).toContain(`<title>${year} candidates in California · USTP Vote</title>`);
    const person = (await get(api, '/people/H060100')).body;
    expect(person).toContain('<title>Hal House · U.S. Representative · USTP Vote</title>');
    expect(meta(person, 'og:type')).toBe('profile');
    const card = meta(person, 'og:image')!.replace(index.origin, '').replace('&amp;', '&');
    expect((await get(api, card)).headers['content-type']).toBe('image/png');
    // An address that is no race page has no preview.
    for (const path of ['/races/ca/53', '/races/CA', '/people/nobody']) expect((await get(api, path)).body, path).toBe(INDEX);
  });

  it('previews a published course', async () => {
    const html = (await get(api, '/course/transhumanism')).body;
    expect(meta(html, 'og:image:alt')).toMatch(/^Free course: /);
    expect(meta(html, 'og:url')).toBe(`${index.origin}/course/transhumanism`);
  });

  it("previews an election's results page before it is counted, a rehearsal saying so", async () => {
    const open = await seedElection(api, { voters: [], state: 'open' });
    const rehearsal = await seedElection(api, { voters: [], state: 'open', rehearsal: true });
    const html = (await get(api, `/results/${open.electionId}`)).body;
    expect(meta(html, 'og:image:alt')).toMatch(/^Election · Voting is open: /);
    expect(meta(html, 'description')).toContain('voting is open');
    expect(meta((await get(api, `/results/${rehearsal.electionId}`)).body, 'og:image:alt')).toMatch(/^Rehearsal · Election · Voting is open: /);
  });

  it('asks Hosting for index.html again on each page with the ETag held, and keeps serving it when Hosting is down', async () => {
    await seedNews(api, 'longevity', 'published');
    index.requests = [];
    await get(api, '/news/longevity');
    await get(api, '/news/longevity');
    expect(index.requests.length).toBe(2);
    expect(index.requests.every((r) => r.ifNoneMatch === '"v1"')).toBe(true);
    index.down = true;
    try {
      const res = await get(api, '/news/longevity');
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('/assets/index-abc123.js');
    } finally {
      index.down = false;
    }
  });
});

describe('link previews in production', () => {
  let index: IndexServer;
  let api: TestApi;
  beforeAll(async () => {
    index = await IndexServer.start();
    process.env.DEPLOYMENT_ENVIRONMENT = 'prod';
    process.env.WEB_ORIGIN = index.origin;
    api = await TestApi.start();
  });
  afterAll(async () => {
    delete process.env.DEPLOYMENT_ENVIRONMENT;
    delete process.env.WEB_ORIGIN;
    await api.close();
    await index.close();
  });
  beforeEach(() => resetEmulators());

  const host = () => index.origin.replace('http://', '');
  const getHere = (url: string) => api.app.inject({ method: 'GET', url, headers: { 'x-forwarded-host': host(), 'x-forwarded-proto': 'http' } });

  it('lets search engines list a preview page at the site’s own address, and not at another', async () => {
    await seedNews(api, 'longevity', 'published');
    expect((await getHere('/news/longevity')).headers['x-robots-tag']).toBeUndefined();
    expect((await getHere('/news/nothing')).headers['x-robots-tag']).toBeUndefined();
    expect((await get(api, '/news/longevity', 'ustpvote2-prod.firebaseapp.com')).headers['x-robots-tag']).toBe('noindex');
  });
});
