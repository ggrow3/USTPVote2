/*
 * USTP Vote service worker (design §19, M5). Hand-written; the build (vite.config.ts) copies it to dist/sw.js and
 * fills in VERSION and SHELL. It only makes the app itself load offline:
 *
 * - SHELL is the build output (index.html, scripts, styles, fonts, icons, manifest), cached at install.
 * - Page loads go to the network first, so each deploy takes effect on the next load; the cached index.html is
 *   only a fallback when offline.
 * - Nothing else is cached, ever. /v1/** (ballots, receipts, admin data), Firebase's reserved /__/** paths and
 *   every other origin (Firebase Auth, App Check) are left entirely to the browser, and no response fetched at
 *   runtime is stored, so nothing authenticated can end up in the cache.
 */

const VERSION = '%VERSION%';
const SHELL = ['%SHELL%'];

const PREFIX = 'ustp-shell-';
const CACHE = PREFIX + VERSION;
const SHELL_PATHS = new Set(SHELL);
const INDEX = SHELL[0];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Revalidated with the server, so an index.html sitting in the HTTP cache from before the deploy is not stored.
      await cache.addAll(SHELL.map((path) => new Request(path, { cache: 'no-cache' })));
      // Take over at once: pages load index.html from the network anyway, and the app reloads a route whose
      // scripts a deploy has replaced (src/pwa.ts), so no tab is left on an old shell.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/v1' || url.pathname.startsWith('/v1/') || url.pathname.startsWith('/__/')) return;

  if (request.mode === 'navigate') event.respondWith(page(request));
  else if (SHELL_PATHS.has(url.pathname)) event.respondWith(shellFile(request));
});

// The cache holds exact build files keyed by URL, so `Vary` (e.g. Vary: Origin, which a module script's request
// does not match) must not cause a miss.
const MATCH = { cacheName: CACHE, ignoreSearch: true, ignoreVary: true };

async function page(request) {
  try {
    return await fetch(request, { cache: 'no-cache' });
  } catch {
    // Offline: the index.html this worker installed, which matches its cached scripts.
    return (await caches.match(INDEX, MATCH)) ?? Response.error();
  }
}

async function shellFile(request) {
  return (await caches.match(request, MATCH)) ?? fetch(request);
}
