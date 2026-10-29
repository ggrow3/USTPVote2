import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** This page's build, and a newer one; update.ts reads its own from VITE_BUILD_COMMIT. */
const PAGE = 'aaaaaaa';
const NEW = 'bbbbbbb';

function response(status: number, commit: string | null): Response {
  return new Response(null, { status, headers: commit ? { 'x-build-commit': commit } : {} });
}

/** Hosting's version.json and the api's health check, as fetch answers them. */
function serve(served: string, api: string) {
  const fetch = vi.fn(async (path: string) => Response.json({ commit: path === '/version.json' ? served : api }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** A fresh copy of update.ts (its state and throttle) in a page built from `commit`. */
async function load(commit: string | null = PAGE) {
  vi.resetModules();
  vi.stubEnv('VITE_BUILD_COMMIT', commit ?? '');
  return import('./update.js');
}

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
  });
});

/** Later, which puts focus back on the page's heading (none here). Not stubbed for long: Vue's DOM runtime reads it. */
function later(mod: typeof import('./update.js')) {
  const page = globalThis as { document?: unknown; HTMLElement?: unknown };
  page.document = { querySelector: () => null };
  page.HTMLElement = class {};
  try {
    mod.dismissUpdate();
  } finally {
    delete page.document;
    delete page.HTMLElement;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('update', () => {
  it('asks for a reload when the api refuses a request from another build', async () => {
    const { refusedAfterUpdate, update } = await load();
    expect(refusedAfterUpdate(response(400, PAGE))).toBe(false);
    expect(refusedAfterUpdate(response(403, NEW))).toBe(false);
    expect(update.banner).toBeNull();
    expect(refusedAfterUpdate(response(409, NEW))).toBe(true);
    expect(update.banner).toEqual({ reason: 'refused', commit: NEW });
  });

  it('checks Hosting and the api when a response comes from another build, and offers the new version', async () => {
    const fetch = serve(NEW, NEW);
    const { noteApiResponse, update } = await load();
    noteApiResponse(response(200, PAGE));
    expect(fetch).not.toHaveBeenCalled();
    noteApiResponse(response(200, NEW));
    await vi.waitFor(() => expect(update.banner).toEqual({ reason: 'web-changed', commit: NEW }));
    expect(fetch.mock.calls.map(([path]) => path).sort()).toEqual(['/v1/health', '/version.json']);
  });

  it('shows nothing mid-release, while Hosting still serves this page', async () => {
    const fetch = serve(PAGE, NEW);
    const { noteApiResponse, update } = await load();
    noteApiResponse(response(200, NEW));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(update.banner).toBeNull();
  });

  it('keeps a version put off with Later hidden, in this tab', async () => {
    serve(NEW, NEW);
    let mod = await load();
    mod.newWorkerTookOver();
    await vi.waitFor(() => expect(mod.update.banner).not.toBeNull());
    later(mod);
    expect(mod.update.banner).toBeNull();
    // After a reload that brought nothing new, the same version is still put off.
    mod = await load();
    mod.newWorkerTookOver();
    await new Promise((r) => setTimeout(r, 10));
    expect(mod.update.banner).toBeNull();
  });

  it('never checks from a build without a commit, but still offers a reload when a new service worker takes over', async () => {
    const fetch = serve(NEW, NEW);
    const { newWorkerTookOver, noteApiResponse, refusedAfterUpdate, update } = await load(null);
    noteApiResponse(response(200, NEW));
    expect(refusedAfterUpdate(response(400, NEW))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    newWorkerTookOver();
    expect(update.banner).toEqual({ reason: 'web-changed', commit: '' });
  });
});
