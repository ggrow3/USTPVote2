import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalBytes } from 'ustp-audit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAnchorFiles } from './files.js';
import { anchorDocument, anchorObjectFindings } from './ledger.js';
import { buildWorld, type World } from './testing/fixtures.js';

let w: World;
let dir: string;
beforeAll(async () => {
  w = await buildWorld();
  dir = await mkdtemp(join(tmpdir(), 'ustp-verify-'));
  await mkdir(join(dir, 'v1', 'blocks'), { recursive: true });
  await mkdir(join(dir, 'v1', 'keys'), { recursive: true });
  for (const block of w.blocks) {
    await writeFile(join(dir, 'v1', 'blocks', `${String(block.index).padStart(12, '0')}.json`), canonicalBytes(anchorDocument(block)));
  }
  await writeFile(join(dir, 'v1', 'keys', `${w.signer.key.keyId}.pem`), w.signer.key.publicKeyPem);
  await writeFile(join(dir, 'v1', 'blocks', 'README.txt'), 'not an anchor object');
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('downloaded anchor objects', () => {
  it('are read from the bucket root or from v1/ itself, ignoring other files', async () => {
    for (const root of [dir, join(dir, 'v1')]) {
      const files = await readAnchorFiles(root);
      expect([...files.blocks.keys()]).toEqual(w.blocks.map((b) => b.index));
      expect([...files.keys.keys()]).toEqual([w.signer.key.keyId]);
      expect(anchorObjectFindings(w.blocks, [w.signer.key], files).every((f) => f.status === 'pass')).toBe(true);
    }
  });

  it('must be a directory', async () => {
    await expect(readAnchorFiles(join(dir, 'missing'))).rejects.toThrow('is not a directory');
  });
});
