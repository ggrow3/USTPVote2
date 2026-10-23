import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { quasar, transformAssetUrls } from '@quasar/vite-plugin';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';

export default defineConfig({
  plugins: [vue({ template: { transformAssetUrls } }), quasar(), serviceWorker()],
  server: {
    // Local API (npm run dev:api) during development; Firebase Hosting rewrites in deployed environments. Like
    // Hosting, it sends X-Forwarded-Host, so links the API builds (the results CSV) point at this server.
    proxy: { '/v1': { target: 'http://localhost:8080', changeOrigin: true, xfwd: true } },
  },
});

/**
 * Builds dist/sw.js from service-worker.js: the files to cache are the whole build (the app shell, index.html first),
 * and the version is a hash of their contents, so every deploy that changes the app installs a new worker. Builds
 * only; the dev server has no service worker.
 */
function serviceWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'ustp-service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    writeBundle() {
      const outDir = resolve(config.root, config.build.outDir);
      const files = listFiles(outDir)
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
        .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
      const template = readFileSync(resolve(config.root, 'service-worker.js'), 'utf8');
      const hash = createHash('sha256').update(template);
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const shell = files.map((f) => config.base + (f === 'index.html' ? '' : f));
      const source = template
        .replace(`'%VERSION%'`, JSON.stringify(hash.digest('hex').slice(0, 16)))
        .replace(`['%SHELL%']`, JSON.stringify(shell));
      writeFileSync(join(outDir, 'sw.js'), source);
    },
  };
}

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name), root)
      : [relative(root, join(dir, entry.name)).split('\\').join('/')],
  );
}
