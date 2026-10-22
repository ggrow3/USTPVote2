import { Notify } from 'quasar';
import { router } from './router.js';

const UPDATE_CHECK_MS = 60 * 60 * 1000;
const RELOAD_KEY = 'ustp-chunk-reload';

/**
 * Installs the service worker (production builds only; see service-worker.js) and keeps open tabs working across
 * deploys: a tab whose next page's scripts were replaced by a deploy reloads that page from the network, and a tab
 * that was already open when a new version took over is offered a reload.
 */
export function setUpPwa(): void {
  router.onError((error, to) => {
    if (isStaleChunkError(error)) reloadOnce(to.fullPath);
  });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first install also takes control (clients.claim); only a replacement means a new version.
    if (hadController) offerReload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => setInterval(() => void registration.update().catch(() => {}), UPDATE_CHECK_MS))
      .catch((e: unknown) => console.warn('Service worker not registered:', e));
  });
}

/** A lazy-loaded page's script or style is gone: the server now has a newer build. */
function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|module script failed|Unable to preload CSS/i.test(message);
}

/** Loads `path` in full, unless that already happened in the last few seconds (a broken deploy must not loop). */
function reloadOnce(path: string): void {
  try {
    const last = JSON.parse(sessionStorage.getItem(RELOAD_KEY) ?? 'null') as { path: string; at: number } | null;
    if (last?.path === path && Date.now() - last.at < 10_000) return;
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // storage blocked: reload anyway
  }
  window.location.assign(path);
}

function offerReload(): void {
  Notify.create({
    message: 'A new version of USTP Vote is available.',
    timeout: 0,
    actions: [
      { label: 'Reload', color: 'white', handler: () => window.location.reload() },
      { label: 'Later', color: 'white' },
    ],
  });
}
