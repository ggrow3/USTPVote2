import { hexToBytes } from '@noble/hashes/utils.js';
import { hashCanonical, isHex32, sha256Hex } from './hash.js';

/** Published at scheduling: SHA-256 of the 32 raw seed bytes. */
export function seedCommitment(seedHex: string): string {
  assertSeed(seedHex);
  return sha256Hex(hexToBytes(seedHex));
}

/**
 * Tie-break order for one contest, most favoured first: candidates sorted by
 * H(JCS({v: 1, seed, contestId, candidateId})) ascending. Anyone holding the revealed seed can recompute it.
 */
export function tieBreakOrder(seedHex: string, contestId: string, candidateIds: readonly string[]): string[] {
  assertSeed(seedHex);
  if (new Set(candidateIds).size !== candidateIds.length) throw new TypeError('candidate ids must be unique');
  return candidateIds
    .map((candidateId) => ({ candidateId, key: hashCanonical({ v: 1, seed: seedHex, contestId, candidateId }) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((x) => x.candidateId);
}

function assertSeed(seedHex: string): void {
  if (!isHex32(seedHex)) throw new TypeError('seed must be 64 lowercase hex digits');
}
