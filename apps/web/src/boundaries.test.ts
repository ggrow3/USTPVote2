import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Context boundaries in the web app (docs/DOMAIN-MODEL.md §7.2): a context's API routes are written only in its own
 * folder, in its `api.ts`, and other code calls that client. A context is listed here once it has that structure.
 */
const CONTEXTS: Readonly<Record<string, readonly string[]>> = {
  membership: [
    '/v1/registration/',
    '/v1/admin/applications',
    '/v1/admin/members',
    '/v1/admin/registration-form',
    '/v1/me/resign',
    '/v1/me/details',
  ],
  notifications: ['/notices', '/notice-settings'],
  governance: ['/v1/navigation', '/v1/admin/navigation', '/v1/home-quote', '/v1/admin/home-quote', '/v1/hub', '/v1/admin/hub'],
  // Its routes end the path after an election ID; the folder's own name appears in imports.
  'consistency-check': ['}/consistency-check'],
  'claude-key': ['/v1/admin/anthropic-key'],
  // `…/bylaws-checks` (the editor) and `…/bylaws-check` (the public notes), after an election ID.
  'election-check': ['}/bylaws-check'],
  offices: ['/v1/admin/positions', '/v1/public/positions'],
  candidacies: ['/v1/candidacies', '/v1/admin/candidacies', '/v1/public/candidacies', '/v1/public/districts', '/v1/public/maps'],
};

const SRC = import.meta.dirname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|vue)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('context boundaries', () => {
  const files = sources(SRC).map((path) => ({ path: relative(SRC, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') }));

  for (const [context, routes] of Object.entries(CONTEXTS)) {
    it(`only ${context}/api.ts calls ${context}'s routes`, () => {
      const leaks = files
        .filter((f) => f.path !== `${context}/api.ts`)
        .flatMap((f) => routes.filter((r) => f.text.includes(r)).map((r) => `${f.path}: ${r}`));
      expect(leaks).toEqual([]);
    });
  }
});
