import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Context boundaries in the web app (docs/DOMAIN-MODEL.md §7.2): a context's API routes are written only in its own
 * folder, in its `api.ts`, and other code calls that client. A context is listed here once it has that structure.
 */
const CONTEXTS: Readonly<Record<string, readonly string[]>> = {
  membership: ['/v1/registration/', '/v1/admin/applications', '/v1/admin/members', '/v1/me/resign', '/v1/me/details'],
  governance: ['/v1/navigation', '/v1/admin/navigation'],
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
