import { buildCommit } from 'ustp-domain';
import { APP_NAME } from './app-name.js';

/**
 * The version handshake (design §15). A release builds the web app and the server from one commit of main; the api
 * reports its commit on every response and in GET /v1/health, and Hosting serves the web app's in /version.json. A page
 * built from another commit than either was left open across a release, and offers a reload. The rules, kept apart from
 * the browser for tests; update.ts does the checking.
 */

/** The commit this web app was built from (VITE_BUILD_COMMIT); null in local and CI builds, which never offer a reload. */
export const WEB_COMMIT = buildCommit(import.meta.env.VITE_BUILD_COMMIT);

/**
 * Why to reload, least urgent first: the api runs another build; Hosting serves a newer web app; the api refused a
 * request, likely because what it accepts changed under this page.
 */
export type UpdateReason = 'api-changed' | 'web-changed' | 'refused';

export interface PendingUpdate {
  readonly reason: UpdateReason;
  /** The other build's commit: the api's, or the web app's that Hosting now serves. Empty when unknown. */
  readonly commit: string;
}

/** Whether two builds differ; null when either is unknown (a build without a commit). */
export function buildsDiffer(a: string | null, b: string | null): boolean | null {
  return a && b ? a !== b : null;
}

/**
 * What a check found, from this page's commit, the one Hosting serves (null when it could not be read) and the api's.
 * A newer web app on Hosting is always worth a reload. An api on another commit is too, unless Hosting still serves this
 * very page, as in the minute between the api and Hosting in a release, or after the api alone was rolled back: a reload
 * would bring back the same page, so `wait` and check again shortly instead.
 */
export function checkResult(web: string | null, served: string | null, api: string | null): PendingUpdate | 'wait' | null {
  if (served && buildsDiffer(web, served)) return { reason: 'web-changed', commit: served };
  if (!api || !buildsDiffer(web, api)) return null;
  return served ? 'wait' : { reason: 'api-changed', commit: api };
}

/** A request the api refused (400 or 409) while it runs another build than this page: likely a change of schema. */
export function refusedByOtherBuild(status: number, web: string | null, api: string | null): boolean {
  return (status === 400 || status === 409) && buildsDiffer(web, api) === true;
}

const URGENCY: Readonly<Record<UpdateReason, number>> = { 'api-changed': 0, 'web-changed': 1, refused: 2 };

export function sameUpdate(a: PendingUpdate | null, b: PendingUpdate | null): boolean {
  return a?.reason === b?.reason && a?.commit === b?.commit;
}

/**
 * The banner after a check or a refused request found `found` (null: nothing to reload for). A more urgent reason
 * replaces a less urgent one. A version the person put off with Later stays hidden until another commit comes along; a
 * refused request always shows, since a change was just lost. Finding nothing clears the banner, except after a refusal.
 */
export function nextBanner(
  shown: PendingUpdate | null,
  found: PendingUpdate | null,
  dismissed: PendingUpdate | null,
): PendingUpdate | null {
  if (!found) return shown?.reason === 'refused' ? shown : null;
  if (found.reason !== 'refused' && dismissed && dismissed.commit === found.commit) return shown;
  if (shown && URGENCY[shown.reason] > URGENCY[found.reason]) return shown;
  return found;
}

/** The banner's text; its button says Reload. */
export function updateMessage(reason: UpdateReason): string {
  return reason === 'refused'
    ? `${APP_NAME} was updated while this page was open, so that was not saved. Reload the page, then try again.`
    : `A new version of ${APP_NAME} is available.`;
}

/** Added to the message of a request refused by another build (see refusedByOtherBuild), where the error is shown. */
export const REFUSED_HINT = `${APP_NAME} was updated while this page was open: reload the page, then try again.`;
