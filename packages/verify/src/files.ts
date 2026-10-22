import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AnchorFiles } from './ledger.js';

/**
 * Reads anchor objects downloaded from the anchors bucket (for example `gcloud storage cp -r gs://<bucket>/v1 <dir>`).
 * `dir` may be the bucket root, holding `v1/`, or `v1/` itself; files are read as raw bytes.
 */
export async function readAnchorFiles(dir: string): Promise<AnchorFiles> {
  if (!(await isDirectory(dir))) throw new Error(`--anchors: ${dir} is not a directory`);
  const root = (await isDirectory(join(dir, 'v1'))) ? join(dir, 'v1') : dir;
  return {
    blocks: await readNamed(join(root, 'blocks'), /^(\d{12})\.json$/, Number),
    keys: await readNamed(join(root, 'keys'), /^([0-9a-f]{16})\.pem$/, String),
  };
}

async function readNamed<K>(dir: string, pattern: RegExp, key: (name: string) => K): Promise<Map<K, Uint8Array>> {
  const files = new Map<K, Uint8Array>();
  if (!(await isDirectory(dir))) return files;
  for (const name of (await readdir(dir)).sort()) {
    const match = pattern.exec(name);
    if (match) files.set(key(match[1]!), new Uint8Array(await readFile(join(dir, name))));
  }
  return files;
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}
