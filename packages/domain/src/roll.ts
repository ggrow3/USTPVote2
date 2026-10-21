import { hashCanonical, inclusionProofHex, merkleRootHex, type InclusionProof } from 'ustp-audit';

/**
 * Voter rolls (design §6.3). A roll is the sorted list of eligible accountIds; its Merkle root commits to exactly
 * that list. Leaves are H(JCS({v: 1, electionId, accountId})), so a root is bound to its election and a member can
 * be shown their own inclusion without revealing anyone else.
 */

export function rollLeaf(electionId: string, accountId: string): string {
  return hashCanonical({ v: 1, electionId, accountId });
}

/** Canonical roll order: unique, sorted by code unit. */
export function sortRoll(accountIds: readonly string[]): string[] {
  return [...new Set(accountIds)].sort();
}

export function rollMerkleRoot(electionId: string, sortedAccountIds: readonly string[]): string {
  return merkleRootHex(sortedAccountIds.map((id) => rollLeaf(electionId, id)));
}

export function rollInclusionProof(electionId: string, sortedAccountIds: readonly string[], accountId: string): InclusionProof | null {
  const index = sortedAccountIds.indexOf(accountId);
  return index < 0 ? null : inclusionProofHex(sortedAccountIds.map((id) => rollLeaf(electionId, id)), index);
}
