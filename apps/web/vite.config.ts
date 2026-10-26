import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { quasar, transformAssetUrls } from '@quasar/vite-plugin';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin, type ResolvedConfig, type Rolldown } from 'vite';

type OutputChunk = Rolldown.OutputChunk;

export default defineConfig({
  plugins: [vue({ template: { transformAssetUrls } }), quasar(), serviceWorker()],
  server: {
    // Local API (npm run dev:api) during development; Firebase Hosting rewrites in deployed environments. Like
    // Hosting, it sends X-Forwarded-Host, so links the API builds (the results CSV) point at this server.
    proxy: { '/v1': { target: 'http://localhost:8080', changeOrigin: true, xfwd: true } },
  },
});

/**
 * Builds dist/sw.js from service-worker.js: the files to cache are the whole build (the app shell, index.html first)
 * except the diagram library, and the version is a hash of their contents, so every deploy that changes the app
 * installs a new worker. Builds only; the dev server has no service worker.
 */
function serviceWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'ustp-service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    writeBundle(_options, bundle) {
      const outDir = resolve(config.root, config.build.outDir);
      const diagrams = diagramFiles(bundle);
      const files = listFiles(outDir)
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !diagrams.has(f))
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

/**
 * The build files only Mermaid needs (its own chunks and the libraries only they import): the election editor's
 * workflow diagram loads them when it is shown. Left out of the shell, they are fetched from the network like any file
 * not in it, and a voter's browser never downloads them. A chunk the app reaches without going through Mermaid stays.
 */
function diagramFiles(bundle: Rolldown.OutputBundle): Set<string> {
  const chunks = new Map(
    Object.values(bundle)
      .filter((f): f is OutputChunk => f.type === 'chunk')
      .map((c) => [c.fileName, c]),
  );
  const isMermaid = (c: OutputChunk) => c.moduleIds.some((id) => /[\\/]node_modules[\\/]mermaid[\\/]/.test(id));
  const reached = new Set<string>();
  const visit = (c: OutputChunk | undefined) => {
    if (!c || reached.has(c.fileName) || isMermaid(c)) return;
    reached.add(c.fileName);
    for (const f of [...c.imports, ...c.dynamicImports]) visit(chunks.get(f));
  };
  for (const c of chunks.values()) if (c.isEntry) visit(c);
  const left = [...chunks.values()].filter((c) => !reached.has(c.fileName));
  const kept = [...reached].map((f) => chunks.get(f)!);
  const assets = (c: OutputChunk) => [...(c.viteMetadata?.importedCss ?? []), ...(c.viteMetadata?.importedAssets ?? [])];
  const keptAssets = new Set(kept.flatMap(assets));
  return new Set([...left.map((c) => c.fileName), ...left.flatMap(assets).filter((a) => !keptAssets.has(a))]);
}

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name), root)
      : [relative(root, join(dir, entry.name)).split('\\').join('/')],
  );
}
