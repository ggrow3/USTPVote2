import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { quasar, transformAssetUrls } from '@quasar/vite-plugin';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';

export default defineConfig({
  plugins: [vue({ template: { transformAssetUrls } }), quasar(), siteOrigin(), appName(), serviceWorker()],
  server: {
    // Local API (npm run dev:api) during development; Firebase Hosting rewrites in deployed environments, robots.txt and
    // sitemap.xml included (design §15). Like Hosting, it sends X-Forwarded-Host, so links the API builds (the results
    // CSV, the sitemap) point at this server.
    proxy: Object.fromEntries(
      ['/v1', '/robots.txt', '/sitemap.xml'].map((path) => [path, { target: 'http://localhost:8080', changeOrigin: true, xfwd: true }]),
    ),
  },
});

/**
 * Fills in index.html's %SITE_ORIGIN% for the link preview image, which must be an absolute URL (design §15): the
 * VITE_SITE_ORIGIN the build is given, for an address of the site's own, or else the Firebase project's Hosting
 * default; nothing for the emulators' demo project, leaving the path relative.
 */
function siteOrigin(): Plugin {
  let origin = '';
  return {
    name: 'ustp-site-origin',
    configResolved({ env }) {
      const project = env.VITE_FIREBASE_PROJECT_ID as string | undefined;
      origin = (env.VITE_SITE_ORIGIN as string | undefined) || (project && !project.startsWith('demo-') ? `https://${project}.web.app` : '');
    },
    transformIndexHtml: (html) => html.replaceAll('%SITE_ORIGIN%', origin),
  };
}

const MANIFEST = 'manifest.webmanifest';

/**
 * Fills in %VITE_APP_NAME% with the site's name (apps/web/.env, design §15): in index.html, escaped, ahead of Vite's own
 * fill-in, which is not; and in the manifest, as the dev server serves it and in the build before serviceWorker()
 * hashes it. Stops without a name.
 */
function appName(): Plugin {
  let name = '';
  const fill = (text: string, value: string) => text.replaceAll('%VITE_APP_NAME%', value);
  const named = (manifest: string) => fill(manifest, JSON.stringify(name).slice(1, -1));
  let config: ResolvedConfig;
  return {
    name: 'ustp-app-name',
    configResolved(resolved) {
      config = resolved;
      name = (config.env.VITE_APP_NAME as string | undefined) ?? '';
      if (!name) throw new Error('VITE_APP_NAME is empty: apps/web/.env names the site.');
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => fill(html, name.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)),
    },
    configureServer(server) {
      server.middlewares.use(`/${MANIFEST}`, (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(named(readFileSync(resolve(config.publicDir, MANIFEST), 'utf8')));
      });
    },
    writeBundle() {
      const built = resolve(config.root, config.build.outDir, MANIFEST);
      writeFileSync(built, named(readFileSync(built, 'utf8')));
    },
  };
}

/** What Hosting serves as the deployed build's commit (design §15); never cached by the service worker. */
const VERSION_FILE = 'version.json';

/**
 * Builds dist/sw.js from service-worker.js: the files to cache are the whole build (the app shell, index.html first),
 * and the version is a hash of their contents, so every deploy that changes the app installs a new worker. Also writes
 * dist/version.json with the commit the release workflow builds from (VITE_BUILD_COMMIT), which open pages compare
 * with their own to offer a reload (src/update.ts). Builds only; the dev server has no service worker.
 */
function serviceWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'ustp-service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    generateBundle() {
      const commit = (config.env.VITE_BUILD_COMMIT as string | undefined) || null;
      this.emitFile({ type: 'asset', fileName: VERSION_FILE, source: `${JSON.stringify({ commit })}
` });
    },
    writeBundle() {
      const outDir = resolve(config.root, config.build.outDir);
      const files = listFiles(outDir)
        .filter((f) => f !== 'sw.js' && f !== VERSION_FILE && !f.endsWith('.map'))
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
