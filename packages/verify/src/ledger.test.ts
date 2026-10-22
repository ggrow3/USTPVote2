import { blockHash, blockSigningInput, canonicalBytes } from 'ustp-audit';
import type { LedgerBlockRecord } from 'ustp-domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { anchorDocument, anchorFinding, anchorObjectFindings, blockChainProblems, checkLedger, type AnchorFiles } from './ledger.js';
import type { Finding } from './report.js';
import { buildWorld, makeSigner, type World } from './testing/fixtures.js';

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});

const failures = (findings: readonly Finding[]) => findings.filter((f) => f.status === 'fail');
/** A block changed and given a hash that matches the change, as someone rewriting the store would. */
const rehashed = (block: LedgerBlockRecord, change: Partial<LedgerBlockRecord>): LedgerBlockRecord => {
  const changed = { ...block, ...change };
  return { ...changed, blockHash: blockHash(changed) };
};

describe('ledger blocks', () => {
  it('verify when untouched: chain, keys, signatures and an anchor at the head', async () => {
    const check = await checkLedger({ blocks: w.blocks, keys: [w.signer.key], anchor: w.anchor });
    expect(failures(check.findings)).toEqual([]);
    expect(check.findings.filter((f) => f.status === 'pass')).toHaveLength(4);
    expect(check.verified).toHaveLength(w.blocks.length);
  });

  it('catch a block whose contents changed without its hash', async () => {
    const blocks = w.blocks.with(1, { ...w.blocks[1]!, merkleRoot: 'a'.repeat(64) });
    expect(blockChainProblems(blocks)).toEqual([{ index: 2, reason: 'blockHash does not match the block contents' }]);
    const check = await checkLedger({ blocks, keys: [w.signer.key], anchor: w.anchor });
    expect(failures(check.findings).length).toBeGreaterThan(0);
    expect(check.verified.map((b) => b.index)).toEqual([1]);
  });

  it('catch a broken chain: a missing block, or a block re-linked and rehashed', async () => {
    const gap = w.blocks.filter((b) => b.index !== 2);
    expect(blockChainProblems(gap).map((p) => p.reason)).toEqual([
      'block numbers are not consecutive',
      'prevBlockHash does not match the previous block',
      'block does not start right after the previous one',
    ]);
    const relinked = w.blocks.with(2, rehashed(w.blocks[2]!, { prevBlockHash: 'f'.repeat(64) }));
    const problems = blockChainProblems(relinked);
    expect(problems).toContainEqual({ index: 3, reason: 'prevBlockHash does not match the previous block' });
    // Rehashing cannot fix the signature, which covers the old contents.
    const check = await checkLedger({ blocks: relinked, keys: [w.signer.key], anchor: w.anchor });
    expect(failures(check.findings).map((f) => f.detail)).toEqual(
      expect.arrayContaining([expect.stringContaining('block 3: signature does not verify')]),
    );
    expect(check.verified).toHaveLength(2);
  });

  it('catch a bad signature and a key the api does not list', async () => {
    const forger = await makeSigner(); // same key version, different key
    const forged = { ...w.blocks[0]!, signature: await forger.sign(blockSigningInput(w.blocks[0]!)) };
    const check = await checkLedger({ blocks: w.blocks.with(0, forged), keys: [w.signer.key], anchor: w.anchor });
    expect(failures(check.findings).map((f) => f.detail)).toEqual(['block 1: signature does not verify']);
    expect(check.verified).toEqual([]);

    const unknown = await checkLedger({ blocks: w.blocks, keys: [], anchor: w.anchor });
    expect(failures(unknown.findings)[0]!.detail).toContain('block 1: signed by a key the api does not list');
  });

  it('catch a key listed under an ID not derived from its version', async () => {
    const check = await checkLedger({ blocks: w.blocks, keys: [{ ...w.signer.key, keyId: '0123456789abcdef' }], anchor: w.anchor });
    expect(failures(check.findings)).toHaveLength(1);
    expect(failures(check.findings)[0]!.label).toContain('Signing keys');
  });

  it('wait while there are no blocks yet', async () => {
    const check = await checkLedger({ blocks: [], keys: [], anchor: null });
    expect(check.findings.map((f) => f.status)).toEqual(['pending']);
  });
});

describe('anchors', () => {
  it('pass at the head, wait when behind, fail for a block the api does not serve or a different hash', () => {
    expect(anchorFinding(w.anchor, w.blocks).status).toBe('pass');
    const behind = { ...w.anchor, index: 2, blockHash: w.blocks[1]!.blockHash, uri: w.anchor.uri.replace(/\d{12}/, '000000000002') };
    expect(anchorFinding(behind, w.blocks).status).toBe('pending');
    expect(anchorFinding(null, w.blocks).status).toBe('pending');
    // The api cut its history after the anchored block.
    expect(anchorFinding(w.anchor, w.blocks.slice(0, 2))).toMatchObject({ status: 'fail', detail: expect.stringContaining('history is missing') });
    expect(anchorFinding({ ...w.anchor, blockHash: 'b'.repeat(64) }, w.blocks).status).toBe('fail');
    expect(anchorFinding({ ...w.anchor, uri: 'gs://elsewhere/v1/blocks/000000000001.json' }, w.blocks).status).toBe('fail');
  });

  it('downloaded objects match byte for byte, and any difference is caught', () => {
    const files = (): { blocks: Map<number, Uint8Array>; keys: Map<string, Uint8Array> } => ({
      blocks: new Map(w.blocks.map((b) => [b.index, canonicalBytes(anchorDocument(b))])),
      keys: new Map([[w.signer.key.keyId, new TextEncoder().encode(w.signer.key.publicKeyPem)]]),
    });
    expect(failures(anchorObjectFindings(w.blocks, [w.signer.key], files()))).toEqual([]);

    const flipped = files();
    const bytes = new Uint8Array(flipped.blocks.get(2)!);
    bytes[bytes.length - 3]! ^= 1;
    flipped.blocks.set(2, bytes);
    expect(failures(anchorObjectFindings(w.blocks, [w.signer.key], flipped))[0]!.detail).toContain('000000000002.json: differs');

    // An anchored block the api no longer serves: its history was cut or rewritten.
    const truncated = anchorObjectFindings(w.blocks.slice(0, 2), [w.signer.key], files());
    expect(failures(truncated)[0]!.detail).toContain('the api does not serve block 3');

    const otherKey = files();
    otherKey.keys.set(w.signer.key.keyId, new TextEncoder().encode('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n'));
    expect(failures(anchorObjectFindings(w.blocks, [w.signer.key], otherKey))[0]!.label).toContain('Key anchor objects');

    const none: AnchorFiles = { blocks: new Map(), keys: new Map() };
    expect(failures(anchorObjectFindings(w.blocks, [w.signer.key], none))).toHaveLength(1);
  });

  it('report blocks that were not downloaded without failing', () => {
    const some: AnchorFiles = { blocks: new Map([[1, canonicalBytes(anchorDocument(w.blocks[0]!))]]), keys: new Map() };
    const findings = anchorObjectFindings(w.blocks, [w.signer.key], some);
    expect(failures(findings)).toEqual([]);
    expect(findings.find((f) => f.label.startsWith('Blocks without'))?.detail).toBe(`2-${w.blocks.length}`);
  });
});
