import { verifyInclusionHex } from 'ustp-audit';
import { describe, expect, it } from 'vitest';
import { rollInclusionProof, rollLeaf, rollMerkleRoot, sortRoll } from './roll.js';

describe('voter roll', () => {
  const members = sortRoll(['c-3', 'a-1', 'b-2', 'a-1']);

  it('is unique and sorted', () => {
    expect(members).toEqual(['a-1', 'b-2', 'c-3']);
  });

  it('binds the root to the election', () => {
    expect(rollMerkleRoot('e1', members)).toMatch(/^[0-9a-f]{64}$/);
    expect(rollMerkleRoot('e1', members)).not.toBe(rollMerkleRoot('e2', members));
    expect(rollMerkleRoot('e1', members)).not.toBe(rollMerkleRoot('e1', members.slice(1)));
  });

  it('proves one member is on the roll without listing the others', () => {
    const proof = rollInclusionProof('e1', members, 'b-2')!;
    expect(proof.root).toBe(rollMerkleRoot('e1', members));
    expect(verifyInclusionHex(rollLeaf('e1', 'b-2'), proof)).toBe(true);
    expect(verifyInclusionHex(rollLeaf('e1', 'c-3'), proof)).toBe(false);
    expect(rollInclusionProof('e1', members, 'z-9')).toBeNull();
  });
});
