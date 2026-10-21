import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

/**
 * Merkle trees exactly as RFC 9162 §2.1 (Certificate Transparency v2): leaf = H(0x00 ‖ d),
 * node = H(0x01 ‖ left ‖ right), split at the largest power of two smaller than n.
 */

const LEAF_PREFIX = Uint8Array.of(0x00);
const NODE_PREFIX = Uint8Array.of(0x01);

export interface InclusionProof {
  readonly leafIndex: number;
  readonly treeSize: number;
  /** Sibling hashes from the leaf up to the root, lowercase hex. */
  readonly path: readonly string[];
  readonly root: string;
}

export function leafHash(data: Uint8Array): Uint8Array {
  return sha256.create().update(LEAF_PREFIX).update(data).digest();
}

export function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256.create().update(NODE_PREFIX).update(left).update(right).digest();
}

/** MTH(D[n]). The empty tree's root is SHA-256 of the empty string. */
export function merkleRoot(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256(new Uint8Array(0));
  return subtreeRoot(leaves.map(leafHash), 0, leaves.length);
}

/** PATH(m, D[n]) from RFC 9162 §2.1.3.1. */
export function inclusionPath(leaves: readonly Uint8Array[], index: number): Uint8Array[] {
  if (!Number.isSafeInteger(index) || index < 0 || index >= leaves.length) {
    throw new RangeError(`leaf index ${index} out of range for tree of size ${leaves.length}`);
  }
  return path(leaves.map(leafHash), index, 0, leaves.length);
}

/** Inclusion proof verification, RFC 9162 §2.1.3.2. `leafData` is the leaf's input d, not its hash. */
export function verifyInclusion(
  leafData: Uint8Array,
  leafIndex: number,
  treeSize: number,
  proofPath: readonly Uint8Array[],
  root: Uint8Array,
): boolean {
  if (!Number.isSafeInteger(leafIndex) || !Number.isSafeInteger(treeSize)) return false;
  if (leafIndex < 0 || leafIndex >= treeSize) return false;

  let fn = leafIndex;
  let sn = treeSize - 1;
  let r = leafHash(leafData);
  for (const p of proofPath) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn = Math.floor(fn / 2);
          sn = Math.floor(sn / 2);
        }
      }
    } else {
      r = nodeHash(r, p);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && equalBytes(r, root);
}

/** Root over hex-encoded leaf data (e.g. ballot commitments). */
export function merkleRootHex(leavesHex: readonly string[]): string {
  return bytesToHex(merkleRoot(leavesHex.map(hexToBytes)));
}

export function inclusionProofHex(leavesHex: readonly string[], leafIndex: number): InclusionProof {
  const leaves = leavesHex.map(hexToBytes);
  return {
    leafIndex,
    treeSize: leaves.length,
    path: inclusionPath(leaves, leafIndex).map(bytesToHex),
    root: bytesToHex(merkleRoot(leaves)),
  };
}

export function verifyInclusionHex(leafHex: string, proof: InclusionProof): boolean {
  try {
    return verifyInclusion(
      hexToBytes(leafHex),
      proof.leafIndex,
      proof.treeSize,
      proof.path.map(hexToBytes),
      hexToBytes(proof.root),
    );
  } catch {
    return false; // malformed hex
  }
}

function subtreeRoot(hashes: readonly Uint8Array[], lo: number, hi: number): Uint8Array {
  const n = hi - lo;
  if (n === 1) return hashes[lo]!;
  const k = splitPoint(n);
  return nodeHash(subtreeRoot(hashes, lo, lo + k), subtreeRoot(hashes, lo + k, hi));
}

function path(hashes: readonly Uint8Array[], m: number, lo: number, hi: number): Uint8Array[] {
  const n = hi - lo;
  if (n === 1) return [];
  const k = splitPoint(n);
  return m < lo + k
    ? [...path(hashes, m, lo, lo + k), subtreeRoot(hashes, lo + k, hi)]
    : [...path(hashes, m, lo + k, hi), subtreeRoot(hashes, lo, lo + k)];
}

/** Largest power of two strictly smaller than n (n >= 2). */
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
