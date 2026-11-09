import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { PREVIEW_PAGES, type ContestSynopsis, type LinkPreview } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { resultBars } from '../elections/results-preview.js';
import { PAGE_HEADERS } from './link-previews.controller.js';
import { cardVersion, LinkPreviewService, orNone, type LinkPreviewSource } from './link-previews.js';

const firebase = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../firebase.json'), 'utf8')) as {
  hosting: { rewrites: { source: string; run?: { serviceId: string }; destination?: string }[]; headers: { source: string; headers: { key: string; value: string }[] }[] };
};

const source = (page: (typeof PREVIEW_PAGES)[number], preview: (params: Record<string, string>) => Promise<LinkPreview | null>): LinkPreviewSource => ({
  page,
  preview,
});
const PREVIEW: LinkPreview = { title: 'T', description: 'D', card: { kicker: 'K', title: 'T' } };
const allSources = (page: (typeof PREVIEW_PAGES)[number], preview: (params: Record<string, string>) => Promise<LinkPreview | null>) =>
  PREVIEW_PAGES.map((p) => (p === page ? source(p, preview) : source(p, async () => null)));

describe('Firebase Hosting', () => {
  it('sends every preview page to the api, before the catch-all', () => {
    const rewrites = firebase.hosting.rewrites;
    const catchAll = rewrites.findIndex((r) => r.source === '**');
    for (const page of PREVIEW_PAGES) {
      const glob = page.replace(/:[A-Za-z]+/g, '*');
      const at = rewrites.findIndex((r) => r.source === glob);
      expect(at, glob).toBeGreaterThanOrEqual(0);
      expect(at, glob).toBeLessThan(catchAll);
      expect(rewrites[at]!.run?.serviceId, glob).toBe('api');
    }
  });

  it("gives the api's pages the headers Hosting gives every page", () => {
    const all = firebase.hosting.headers.find((h) => h.source === '**')!;
    expect(Object.fromEntries(all.headers.map((h) => [h.key, h.value]))).toEqual(PAGE_HEADERS);
  });
});

describe('LinkPreviewService', () => {
  it('needs one source for each preview page', () => {
    expect(() => new LinkPreviewService(PREVIEW_PAGES.slice(1).map((p) => source(p, async () => null)))).toThrow(/no link preview source for \/news\/:slug/);
    expect(() => new LinkPreviewService([...allSources('/news/:slug', async () => null), source('/news/:slug', async () => null)])).toThrow(/two/);
  });

  it("asks the page's source with the path's parameters, and holds the answer to the limits", async () => {
    const asked: Record<string, string>[] = [];
    const service = new LinkPreviewService(
      allSources('/news/:slug', async (params) => {
        asked.push(params);
        return { ...PREVIEW, title: 'x'.repeat(500) };
      }),
    );
    const found = await service.find('/news/hello%20there');
    expect(asked).toEqual([{ slug: 'hello there' }]);
    expect(found?.match.page).toBe('/news/:slug');
    expect(found?.preview.title.length).toBeLessThanOrEqual(120);
    expect(found?.version).toBe(cardVersion(found!.preview.card));
  });

  it('finds nothing for other paths, or when the source has nothing or fails', async () => {
    const service = new LinkPreviewService(
      allSources('/news/:slug', async ({ slug }) => {
        if (slug === 'boom') throw new Error('Firestore unavailable');
        return null;
      }),
    );
    expect(await service.find('/offices')).toBeNull();
    expect(await service.find('/news/none')).toBeNull();
    expect(await service.find('/news/boom')).toBeNull();
  });
});

describe('orNone', () => {
  it("turns a 404 into nothing and lets other errors through", async () => {
    expect(await orNone(Promise.reject(new NotFoundException('no')))).toBeNull();
    await expect(orNone(Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await orNone(Promise.resolve(1))).toBe(1);
  });
});

describe('cardVersion', () => {
  it('changes with the card', () => {
    expect(cardVersion({ kicker: 'K', title: 'A' })).not.toBe(cardVersion({ kicker: 'K', title: 'B' }));
    expect(cardVersion({ kicker: 'K', title: 'A' })).toMatch(/^[\w-]{12}$/);
  });
});

describe('resultBars', () => {
  const head = { number: 1, contestId: 'c', ballots: 8, invalid: 0 };
  const proposal: ContestSynopsis = {
    ...head,
    kind: 'proposal',
    title: 'Adopt the platform',
    yes: { part: 6, whole: 8 },
    no: { part: 2, whole: 8 },
    abstain: { part: 0, whole: 8 },
    passRule: { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' },
    yesShare: { part: 6, whole: 8 },
    quorum: null,
    outcome: 'passed',
  };
  const chair: ContestSynopsis = {
    ...head,
    kind: 'choose_n',
    title: 'Chair',
    seats: 1,
    candidates: [
      { candidateId: 'a', name: 'Ada', votes: { part: 5, whole: 8 }, elected: true, meetsFloor: true },
      { candidateId: 'b', name: 'Ben', votes: { part: 3, whole: 8 }, elected: false, meetsFloor: true },
    ],
    blank: { part: 0, whole: 8 },
    supportFloor: null,
    vacantSeats: 0,
  };
  const ranked: ContestSynopsis = { ...head, kind: 'irv', title: 'Secretary', blank: { part: 0, whole: 8 }, rounds: 2, winner: null };

  it('draws a lone candidate contest as its candidates', () => {
    expect(resultBars({ contests: [chair] })).toEqual([
      { label: 'Ada', value: '62.5%', share: 0.625, highlight: true },
      { label: 'Ben', value: '37.5%', share: 0.375, highlight: false },
    ]);
  });

  it('draws one bar per contest otherwise', () => {
    expect(resultBars({ contests: [proposal, chair, ranked] })).toEqual([
      { label: 'Adopt the platform', value: 'Passed · 75%', share: 0.75, highlight: true },
      { label: 'Chair: Ada', value: '62.5%', share: 0.625, highlight: true },
      { label: 'Secretary: no one elected', value: '–', share: 0, highlight: false },
    ]);
  });
});
