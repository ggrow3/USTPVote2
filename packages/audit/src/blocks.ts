import { GENESIS_HASH } from './chain.js';
import { canonicalBytes, hashCanonical, isHex32 } from './hash.js';
import { inclusionProofHex, merkleRootHex, type InclusionProof } from './merkle.js';

/**
 * Ledger blocks (design §8.3). A block commits to a contiguous run of ledger entries through an RFC 9162 Merkle root
 * over their 32-byte entry hashes, and to the previous block through its hash, so blocks form a second chain on top of
 * the entry chain. Blocks and entries are both numbered from 1.
 */
export interface LedgerBlock {
  readonly v: 1;
  readonly index: number;
  /** `blockHash` of block index - 1; 64 zeros for block 1. */
  readonly prevBlockHash: string;
  readonly firstSeq: number;
  readonly lastSeq: number;
  /** RFC 9162 root over the entry hashes firstSeq..lastSeq, each as its 32 bytes. */
  readonly merkleRoot: string;
  /** Hash of entry `lastSeq`, binding the block to the entry chain. */
  readonly headEntryHash: string;
  readonly createdAt: string;
}

/** A stored block: the block plus its hash, and whatever else the store keeps alongside (signature, ...). */
export type StoredBlock = LedgerBlock & { readonly blockHash: string };

export function buildBlock(input: {
  readonly index: number;
  readonly prevBlockHash: string;
  readonly firstSeq: number;
  /** Hashes of entries firstSeq, firstSeq + 1, ...; at least one. */
  readonly entryHashes: readonly string[];
  readonly createdAt: string;
}): LedgerBlock {
  const { index, prevBlockHash, firstSeq, entryHashes, createdAt } = input;
  if (!Number.isSafeInteger(index) || index < 1) throw new RangeError('block index must be a positive integer');
  if (!Number.isSafeInteger(firstSeq) || firstSeq < 1) throw new RangeError('firstSeq must be a positive integer');
  if (entryHashes.length === 0) throw new RangeError('a block needs at least one entry');
  if (!isHex32(prevBlockHash) || !entryHashes.every(isHex32)) throw new TypeError('hashes must be 64 lowercase hex digits');
  return {
    v: 1,
    index,
    prevBlockHash,
    firstSeq,
    lastSeq: firstSeq + entryHashes.length - 1,
    merkleRoot: merkleRootHex(entryHashes),
    headEntryHash: entryHashes.at(-1)!,
    createdAt,
  };
}

/** The block fields alone, dropping anything a store keeps next to them. */
export function blockBody(block: LedgerBlock): LedgerBlock {
  const { v, index, prevBlockHash, firstSeq, lastSeq, merkleRoot, headEntryHash, createdAt } = block;
  return { v, index, prevBlockHash, firstSeq, lastSeq, merkleRoot, headEntryHash, createdAt };
}

/** H(JCS(block)). */
export function blockHash(block: LedgerBlock): string {
  return hashCanonical(blockBody(block));
}

/**
 * The bytes a block signature covers: JCS(block), UTF-8. Their SHA-256 is `blockHash`, so a signer that takes a digest
 * (Cloud KMS) signs `blockHash`, and anyone can check the signature over these bytes with ordinary tools.
 */
export function blockSigningInput(block: LedgerBlock): Uint8Array {
  return canonicalBytes(blockBody(block));
}

/** Inclusion proof for entry `seq` in a block built from `entryHashes` (entries firstSeq...). */
export function entryInclusionProof(entryHashes: readonly string[], firstSeq: number, seq: number): InclusionProof {
  return inclusionProofHex(entryHashes, seq - firstSeq);
}

export type BlockCheck =
  | { readonly ok: true; readonly blocks: number; readonly lastSeq: number; readonly head: string }
  | { readonly ok: false; readonly index: number; readonly reason: string };

/**
 * Checks blocks 1..n in order against the entry hashes they cover: numbering, contiguity, both links and every Merkle
 * root. `entryHashes[i]` is the hash of entry i + 1; verify the entry chain itself first (`verifyChain`).
 */
export function verifyBlocks(blocks: readonly StoredBlock[], entryHashes: readonly string[]): BlockCheck {
  let prevHash = GENESIS_HASH;
  let nextSeq = 1;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const fail = (reason: string): BlockCheck => ({ ok: false, index: block.index, reason });
    if (block.v !== 1) return fail('unknown block version');
    if (block.index !== i + 1) return fail('block numbers are not consecutive');
    if (block.prevBlockHash !== prevHash) return fail('prevBlockHash does not match the previous block');
    if (block.firstSeq !== nextSeq) return fail('block does not start right after the previous one');
    if (!Number.isSafeInteger(block.lastSeq) || block.lastSeq < block.firstSeq) return fail('block covers no entries');
    if (block.lastSeq > entryHashes.length) return fail('block covers entries that do not exist');
    const covered = entryHashes.slice(block.firstSeq - 1, block.lastSeq);
    if (block.merkleRoot !== merkleRootHex(covered)) return fail('Merkle root does not match the entries');
    if (block.headEntryHash !== covered.at(-1)) return fail('headEntryHash is not the last entry it covers');
    const hash = blockHash(block);
    if (block.blockHash !== hash) return fail('blockHash does not match block contents');
    prevHash = hash;
    nextSeq = block.lastSeq + 1;
  }
  return { ok: true, blocks: blocks.length, lastSeq: nextSeq - 1, head: prevHash };
}
