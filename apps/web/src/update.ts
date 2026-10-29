import { reactive, readonly } from 'vue';
import { BUILD_COMMIT_HEADER, buildCommit } from 'ustp-domain';
import { announce, focusElement } from './a11y.js';
import {
  buildsDiffer,
  checkResult,
  nextBanner,
  refusedByOtherBuild,
  sameUpdate,
  updateMessage,
  WEB_COMMIT,
  type PendingUpdate,
} from './version.js';

/**
 * Notices that a release has replaced the web app or the api under an open page, and offers a reload (design §15; the
 * rules are in version.ts). A page checks when the api answers from another commit, when it is shown again, every
 * quarter of an hour, and when a new service worker takes over; each check also asks the browser to look for a new
 * service worker, which installs and takes over at once (service-worker.js).
 */

const CHECK_EVERY_MS = 15 * 60 * 1000;
/** No two checks closer than this, however many responses or focus changes ask for one. */
const MIN_GAP_MS = 60 * 1000;
/** While the api is newer than what Hosting serves (mid-release), checks repeat this often, at most WAITS times. */
const WAIT_MS = 60 * 1000;
const WAITS = 15;
/** The version the person put off with Later, kept for this tab across reloads. */
const DISMISSED_KEY = 'ustp-update-dismissed';

const state = reactive({ banner: null as PendingUpdate | null });
/** The banner to show, if any (UpdateBanner.vue). */
export const update = readonly(state);

let registration: ServiceWorkerRegistration | null = null;
let lastCheck = 0;
let waits = 0;
let waitTimer: ReturnType<typeof setTimeout> | undefined;
let dismissedHere: PendingUpdate | null = null;

/** Starts the regular checks; once, at start-up. */
export function startUpdateChecks(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
}

/** The service worker's registration, so checks can ask it to look for a new version. */
export function useServiceWorker(r: ServiceWorkerRegistration): void {
  registration = r;
}

/**
 * A new service worker replaced the one that loaded this page. The first page loaded after a deploy is already the new
 * version when that happens, so ask Hosting rather than assume; a build without a commit cannot tell, and offers anyway.
 */
export function newWorkerTookOver(): void {
  if (WEB_COMMIT) void checkForUpdate(true);
  else show({ reason: 'web-changed', commit: '' });
}

/** Every api response: an api on another commit than this page means a release is under way or done. */
export function noteApiResponse(res: Response): void {
  if (buildsDiffer(WEB_COMMIT, responseCommit(res))) void checkForUpdate();
}

/**
 * A refused request: true when the api runs another build than this page, so the refusal is likely the page being out
 * of date. The banner then asks for a reload, and the caller says so with the error.
 */
export function refusedAfterUpdate(res: Response): boolean {
  const api = responseCommit(res);
  if (!api || !refusedByOtherBuild(res.status, WEB_COMMIT, api)) return false;
  show({ reason: 'refused', commit: api });
  return true;
}

/** Later: hides the banner until another version comes along, and puts focus back on the page. */
export function dismissUpdate(): void {
  try {
    if (state.banner) sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(state.banner));
  } catch {
    // storage blocked: dismissed until the next reload only
  }
  dismissedHere = state.banner;
  state.banner = null;
  focusElement(document.querySelector('main h1'));
}

export function reloadForUpdate(): void {
  window.location.reload();
}

async function checkForUpdate(force = false): Promise<void> {
  if (!force && Date.now() - lastCheck < MIN_GAP_MS) return;
  lastCheck = Date.now();
  clearTimeout(waitTimer);
  void registration?.update().catch(() => {});
  if (!WEB_COMMIT) return;
  const [served, api] = await Promise.all([commitAt('/version.json'), commitAt('/v1/health')]);
  const found = checkResult(WEB_COMMIT, served, api);
  if (found === 'wait') {
    if (waits++ < WAITS) waitTimer = setTimeout(() => void checkForUpdate(true), WAIT_MS);
    show(null);
  } else {
    waits = 0;
    show(found);
  }
}

function show(found: PendingUpdate | null): void {
  const next = nextBanner(state.banner, found, dismissed());
  if (next && (next.reason === 'refused' || !sameUpdate(next, state.banner))) announce(updateMessage(next.reason));
  state.banner = next;
}

function dismissed(): PendingUpdate | null {
  try {
    return (JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? 'null') as PendingUpdate | null) ?? dismissedHere;
  } catch {
    return dismissedHere;
  }
}

function responseCommit(res: Response): string | null {
  return buildCommit(res.headers.get(BUILD_COMMIT_HEADER));
}

/** The commit in a small JSON document (version.json, the api's health check), never from a cache; null if unreadable. */
async function commitAt(path: string): Promise<string | null> {
  try {
    const res = await fetch(path, { cache: 'no-store', headers: { accept: 'application/json' } });
    return res.ok ? buildCommit(((await res.json()) as { commit?: unknown }).commit) : null;
  } catch {
    return null;
  }
}
