import { ballotPartCommitment, GENESIS_HASH, merkleRootHex, newSalt, verifyInclusionHex, type BallotPart } from 'ustp-audit';
import { describe, expect, it } from 'vitest';
import {
  buildSealedBlock,
  evenChunks,
  sealedBlockHash,
  sealedBlockProblems,
  sealedCommitments,
  sealedInclusionProof,
  type SealableBallot,
  type SealedBlockRecord,
} from './sealing.js';

const part = (contestId: string, selection: unknown): BallotPart => ({ v: 1, electionId: 'e1', contestId, selection, salt: newSalt() });
const ballots: SealableBallot[] = [
  { parts: [part('plank', 'yes'), part('chair', ['a', 'b'])] },
  { parts: [part('plank', 'no')] },
  { parts: [part('plank', 'yes'), part('chair', ['b'])] },
];
const AT = '2026-10-21T12:00:00.000Z';

function record(index: number, prevSealedHash: string, from: readonly SealableBallot[]): SealedBlockRecord {
  const block = buildSealedBlock({ electionId: 'e1', index, prevSealedHash, ballots: from, sealedAt: AT });
  return { ...block, sealedHash: sealedBlockHash(block), commitments: sealedCommitments(block.contests), ledgerSeq: index };
}

describe('sealed blocks', () => {
  it('group parts by contest in commitment order, so cast order and ballots are not visible', () => {
    const block = buildSealedBlock({ electionId: 'e1', index: 1, prevSealedHash: GENESIS_HASH, ballots, sealedAt: AT });
    expect(block.ballotCount).toBe(3);
    expect(Object.keys(block.contests).sort()).toEqual(['chair', 'plank']);
    for (const parts of Object.values(block.contests)) {
      const order = parts.map(ballotPartCommitment);
      expect(order).toEqual([...order].sort());
    }
    expect(block.contests.plank).toHaveLength(3);
    const all = ballots.flatMap((b) => b.parts.map(ballotPartCommitment)).sort();
    expect(block.merkleRoot).toBe(merkleRootHex(all));
  });

  it('carry the voter on roll-call parts, ordered by account, with the same commitments', () => {
    const named = ballots.map((b, i) => ({ ...b, accountId: `acct-${2 - i}` }));
    const block = buildSealedBlock({ electionId: 'e1', index: 1, prevSealedHash: GENESIS_HASH, ballots: named, sealedAt: AT });
    expect(block.contests.plank!.map((p) => p.accountId)).toEqual(['acct-0', 'acct-1', 'acct-2']);
    expect(sealedCommitments(block.contests)).toEqual(ballots.flatMap((b) => b.parts.map(ballotPartCommitment)).sort());
  });

  it('prove one part without revealing the others', () => {
    const block = record(1, GENESIS_HASH, ballots);
    const mine = ballotPartCommitment(ballots[1]!.parts[0]!);
    const proof = sealedInclusionProof(block, mine)!;
    expect(proof.root).toBe(block.merkleRoot);
    expect(verifyInclusionHex(mine, proof)).toBe(true);
    expect(sealedInclusionProof(block, '0'.repeat(64))).toBeNull();
  });

  it('verify as a chain and catch a changed part, a dropped part or a broken link', () => {
    const first = record(1, GENESIS_HASH, ballots.slice(0, 2));
    const second = record(2, first.sealedHash, ballots.slice(2));
    expect(sealedBlockProblems([first, second])).toEqual([]);

    const altered = { ...first, contests: { ...first.contests, plank: first.contests.plank!.map((p) => ({ ...p, selection: 'no' })) } };
    expect(sealedBlockProblems([altered, second])).toContain('sealed block 1: Merkle root does not match its parts');

    const dropped = { ...first, contests: { ...first.contests, chair: [] } };
    expect(sealedBlockProblems([dropped, second]).length).toBeGreaterThan(0);

    expect(sealedBlockProblems([first, { ...second, prevSealedHash: GENESIS_HASH }])).toContain(
      'sealed block 2: prevSealedHash does not match the previous block',
    );
  });

  it('refuse parts of another election', () => {
    expect(() =>
      buildSealedBlock({ electionId: 'e2', index: 1, prevSealedHash: GENESIS_HASH, ballots, sealedAt: AT }),
    ).toThrow(/another election/);
  });

  it('split large batches evenly', () => {
    expect(evenChunks([1, 2, 3, 4, 5], 2).map((c) => c.length)).toEqual([2, 2, 1]);
    expect(evenChunks(Array.from({ length: 401 }, (_, i) => i), 400).map((c) => c.length)).toEqual([201, 200]);
    expect(evenChunks([], 400)).toEqual([]);
  });
});
