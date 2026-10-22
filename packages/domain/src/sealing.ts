import {
  ballotPartCommitment,
  GENESIS_HASH,
  hashCanonical,
  inclusionProofHex,
  merkleRootHex,
  type BallotPart,
  type InclusionProof,
} from 'ustp-audit';
import type { ElectionDefinition, ElectionRecord } from './elections.js';
import type { SignatureRecord } from './ledger.js';
import type { ResultsSummary } from './results.js';

/**
 * Sealed blocks (design §7.2, §7.4): ballots taken out of the pool (or, for roll-call elections, out of the
 * participation records) and published in batches. Parts are grouped by contest and ordered by commitment, so a block
 * shows no cast order and does not keep one voter's parts together; roll-call parts carry the voter's account and are
 * ordered by it. Every block commits to all its parts with an RFC 9162 root over their sorted commitments.
 */

/** A part as published: the voter's part, plus their account for roll-call ballots. */
export interface SealedPart extends BallotPart {
  readonly accountId?: string;
}

export interface SealedBlock {
  readonly v: 1;
  readonly electionId: string;
  /** From 1, per election. */
  readonly index: number;
  /** `sealedHash` of block index - 1 of the same election; 64 zeros for block 1. */
  readonly prevSealedHash: string;
  /** Ballots (not parts) in the block. */
  readonly ballotCount: number;
  /** contestId → its parts in this block, ordered by commitment (secret) or account (roll-call). */
  readonly contests: Readonly<Record<string, readonly SealedPart[]>>;
  /** RFC 9162 root over the commitments of every part in the block, sorted. */
  readonly merkleRoot: string;
  readonly sealedAt: string;
}

/** `elections/{id}/sealed_blocks/{index}`. `sealedHash = H(JCS(block))`; the other fields are for lookups. */
export interface SealedBlockRecord extends SealedBlock {
  readonly sealedHash: string;
  /** Every part's commitment, sorted: the Merkle leaves, kept so a receipt's block can be found by query. */
  readonly commitments: readonly string[];
  /** The `ballots.sealed` ledger entry that records this block. */
  readonly ledgerSeq: number;
}

/** One ballot as the sealer reads it. */
export interface SealableBallot {
  readonly parts: readonly BallotPart[];
  /** Roll-call ballots only. */
  readonly accountId?: string;
}

export function buildSealedBlock(input: {
  readonly electionId: string;
  readonly index: number;
  readonly prevSealedHash: string;
  readonly ballots: readonly SealableBallot[];
  readonly sealedAt: string;
}): SealedBlock {
  const { electionId, index, prevSealedHash, ballots, sealedAt } = input;
  const keyed: { contestId: string; key: string; part: SealedPart }[] = [];
  for (const ballot of ballots) {
    for (const part of ballot.parts) {
      if (part.electionId !== electionId) throw new Error('a ballot part belongs to another election');
      const commitment = ballotPartCommitment(part);
      const sealed: SealedPart = ballot.accountId ? { ...part, accountId: ballot.accountId } : { ...part };
      keyed.push({ contestId: part.contestId, key: ballot.accountId ? `${ballot.accountId}:${commitment}` : commitment, part: sealed });
    }
  }
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const contests: Record<string, SealedPart[]> = {};
  for (const { contestId, part } of keyed) (contests[contestId] ??= []).push(part);
  return {
    v: 1,
    electionId,
    index,
    prevSealedHash,
    ballotCount: ballots.length,
    contests,
    merkleRoot: merkleRootHex(sealedCommitments(contests)),
    sealedAt,
  };
}

/** The block fields alone, dropping what the store keeps alongside. */
export function sealedBlockBody(block: SealedBlock): SealedBlock {
  const { v, electionId, index, prevSealedHash, ballotCount, contests, merkleRoot, sealedAt } = block;
  return { v, electionId, index, prevSealedHash, ballotCount, contests, merkleRoot, sealedAt };
}

export function sealedBlockHash(block: SealedBlock): string {
  return hashCanonical(sealedBlockBody(block));
}

/** The commitment of every part in the block, sorted: the block's Merkle leaves. */
export function sealedCommitments(contests: SealedBlock['contests']): string[] {
  const parts = Object.values(contests).flat();
  // The published part carries the voter's account in roll-call blocks; the commitment covers the part alone.
  return parts.map(({ accountId: _account, ...part }) => ballotPartCommitment(part)).sort();
}

export function sealedInclusionProof(block: SealedBlockRecord, commitment: string): InclusionProof | null {
  const index = block.commitments.indexOf(commitment);
  return index < 0 ? null : inclusionProofHex(block.commitments, index);
}

/**
 * Checks an election's published blocks in order: numbering, links, each block's root against its parts and its hash
 * against its contents. An empty array means they verify.
 */
export function sealedBlockProblems(blocks: readonly SealedBlockRecord[]): string[] {
  const problems: string[] = [];
  let prev = GENESIS_HASH;
  for (const [i, block] of blocks.entries()) {
    const at = `sealed block ${block.index}`;
    if (block.index !== i + 1) problems.push(`${at}: blocks are not numbered consecutively`);
    if (block.prevSealedHash !== prev) problems.push(`${at}: prevSealedHash does not match the previous block`);
    const commitments = sealedCommitments(block.contests);
    if (merkleRootHex(commitments) !== block.merkleRoot) problems.push(`${at}: Merkle root does not match its parts`);
    if (commitments.join() !== block.commitments.join()) problems.push(`${at}: commitment list does not match its parts`);
    if (sealedBlockHash(block) !== block.sealedHash) problems.push(`${at}: sealedHash does not match its contents`);
    prev = block.sealedHash;
  }
  return problems;
}

/** Splits n items into as few chunks of at most `max` as possible, as evenly as possible. */
export function evenChunks<T>(items: readonly T[], max: number): T[][] {
  const count = Math.ceil(items.length / max);
  const chunks: T[][] = [];
  for (let i = 0, start = 0; i < count; i++) {
    const size = Math.floor(items.length / count) + (i < items.length % count ? 1 : 0);
    chunks.push(items.slice(start, start + size));
    start += size;
  }
  return chunks;
}

/** Most ballots in one sealed block, to stay well under Firestore's 1 MiB document limit (design §7.2). */
export const MAX_BALLOTS_PER_SEALED_BLOCK = 400;

/** A sealed block without its contents. */
export type SealedBlockSummary = Pick<SealedBlockRecord, 'index' | 'ballotCount' | 'merkleRoot' | 'sealedHash' | 'sealedAt' | 'ledgerSeq'>;

/**
 * `GET /v1/public/elections/{id}`: what anyone may see of an election past its draft. Block contents (the parts
 * themselves) are published only once voting has closed, so nobody sees a running tally (`.../sealed-blocks`); the
 * results follow once every ballot is sealed (`.../results`).
 */
export interface PublicElection {
  readonly election: Pick<
    ElectionRecord,
    | 'electionId'
    | 'title'
    | 'description'
    | 'secrecy'
    | 'state'
    | 'opensAt'
    | 'closesAt'
    | 'kAnonymity'
    | 'definitionHash'
    | 'tieBreakSeedCommitment'
    | 'openedAt'
    | 'closedAt'
    | 'sealedAt'
    | 'certifiedAt'
    | 'poolKeyDestroyedAt'
    | 'cancelledAt'
  >;
  readonly definition: ElectionDefinition;
  readonly roll: {
    readonly snapshotId: string;
    readonly count: number;
    readonly merkleRoot: string;
    readonly asOf: string;
    readonly signature: SignatureRecord | null;
  } | null;
  readonly sealedBlocks: readonly SealedBlockSummary[];
  readonly ballotsSealed: number;
  /** Null until the worker has tallied the sealed election. */
  readonly results: ResultsSummary | null;
}
