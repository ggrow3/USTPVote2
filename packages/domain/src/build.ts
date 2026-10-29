/**
 * Which build is running (design §15). The release workflow builds the server image and the web app from one commit of
 * main and gives both its SHA; the api reports its own on every response and in GET /v1/health, and the web app
 * compares it with the one it was built from, so a page left open across a release can offer a reload.
 */

/** Sent by the api with every response when it knows its commit. */
export const BUILD_COMMIT_HEADER = 'x-build-commit';

/** GET /v1/health. */
export interface HealthStatus {
  readonly status: 'ok';
  /** The tally library's version. */
  readonly tally: string;
  /** The commit the server was built from; null in builds the release workflow did not make (local, tests, CI). */
  readonly commit: string | null;
}

/** A commit SHA as 7 to 40 lowercase hex digits, or null for anything else (unset, empty, garbled). */
export function buildCommit(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const commit = value.trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(commit) ? commit : null;
}
