import { describe, expect, it } from 'vitest';
import { blockHash, blockSigningInput, buildBlock, entryInclusionProof, verifyBlocks, type StoredBlock } from './blocks.js';
import { GENESIS_HASH } from './chain.js';
import { sha256Hex } from './hash.js';
import { merkleRootHex, verifyInclusionHex } from './merkle.js';

const ENTRIES = Array.from({ length: 7 }, (_, i) => sha256Hex(`entry ${i + 1}`));
const AT = '2026-10-21T12:00:00.000Z';

function chain(splits: readonly number[]): StoredBlock[] {
  const blocks: StoredBlock[] = [];
  let first = 1;
  let prev = GENESIS_HASH;
  for (const last of splits) {
    const block = buildBlock({ index: blocks.length + 1, prevBlockHash: prev, firstSeq: first, entryHashes: ENTRIES.slice(first - 1, last), createdAt: AT });
    prev = blockHash(block);
    blocks.push({ ...block, blockHash: prev });
    first = last + 1;
  }
  return blocks;
}

describe('ledger blocks', () => {
  it('commit to their entries by an RFC 9162 root and to the last entry', () => {
    const [block] = chain([4]);
    expect(block).toMatchObject({ index: 1, prevBlockHash: GENESIS_HASH, firstSeq: 1, lastSeq: 4, headEntryHash: ENTRIES[3] });
    expect(block!.merkleRoot).toBe(merkleRootHex(ENTRIES.slice(0, 4)));
  });

  it('sign the JCS bytes whose SHA-256 is the block hash', () => {
    const [block] = chain([3]);
    expect(sha256Hex(blockSigningInput(block!))).toBe(block!.blockHash);
    // Fields stored next to the block (its hash, a signature) are not part of what is hashed or signed.
    expect(blockHash({ ...block!, signature: 'x' } as StoredBlock)).toBe(block!.blockHash);
  });

  it('verify as a chain covering every entry once', () => {
    expect(verifyBlocks(chain([2, 5, 7]), ENTRIES)).toEqual({ ok: true, blocks: 3, lastSeq: 7, head: chain([2, 5, 7])[2]!.blockHash });
    expect(verifyBlocks([], ENTRIES)).toEqual({ ok: true, blocks: 0, lastSeq: 0, head: GENESIS_HASH });
    // Entries after the last block are simply not blocked yet.
    expect(verifyBlocks(chain([2, 5]), ENTRIES)).toMatchObject({ ok: true, lastSeq: 5 });
  });

  it('detect a changed entry, a broken link, a gap and a rewritten block', () => {
    const blocks = chain([2, 5, 7]);
    const changed = [...ENTRIES];
    changed[3] = sha256Hex('forged');
    expect(verifyBlocks(blocks, changed)).toMatchObject({ ok: false, index: 2, reason: 'Merkle root does not match the entries' });

    const relinked = [blocks[0]!, { ...blocks[1]!, prevBlockHash: GENESIS_HASH }, blocks[2]!];
    expect(verifyBlocks(relinked, ENTRIES)).toMatchObject({ ok: false, index: 2 });

    expect(verifyBlocks([blocks[0]!, blocks[2]!], ENTRIES)).toMatchObject({ ok: false, index: 3, reason: 'block numbers are not consecutive' });

    const rewritten = [blocks[0]!, { ...blocks[1]!, createdAt: '2027-01-01T00:00:00.000Z' }, blocks[2]!];
    expect(verifyBlocks(rewritten, ENTRIES)).toMatchObject({ ok: false, index: 2, reason: 'blockHash does not match block contents' });

    const truncated = ENTRIES.slice(0, 6);
    expect(verifyBlocks(blocks, truncated)).toMatchObject({ ok: false, index: 3, reason: 'block covers entries that do not exist' });
  });

  it('prove one entry without the others', () => {
    const [, block] = chain([2, 5]);
    const covered = ENTRIES.slice(2, 5);
    const proof = entryInclusionProof(covered, block!.firstSeq, 4);
    expect(proof).toMatchObject({ leafIndex: 1, treeSize: 3, root: block!.merkleRoot });
    expect(verifyInclusionHex(ENTRIES[3]!, proof)).toBe(true);
    expect(verifyInclusionHex(ENTRIES[2]!, proof)).toBe(false);
  });

  it('refuse empty or malformed input', () => {
    expect(() => buildBlock({ index: 1, prevBlockHash: GENESIS_HASH, firstSeq: 1, entryHashes: [], createdAt: AT })).toThrow(RangeError);
    expect(() => buildBlock({ index: 0, prevBlockHash: GENESIS_HASH, firstSeq: 1, entryHashes: ENTRIES, createdAt: AT })).toThrow(RangeError);
    expect(() => buildBlock({ index: 1, prevBlockHash: 'abc', firstSeq: 1, entryHashes: ENTRIES, createdAt: AT })).toThrow(TypeError);
  });
});
