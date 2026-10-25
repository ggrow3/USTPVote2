import { canonicalBytes, sha256Hex, verifyInclusionHex } from 'ustp-audit';
import { describe, expect, it } from 'vitest';
import { isRehearsalRoll, rollInclusionProof, rollLeaf, rollMerkleRoot, rollSigningInput, rollStatement, sortRoll } from './roll.js';

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

  it('signs a statement of exactly the approved roll, not the stored record', () => {
    const snapshot = {
      snapshotId: 's1',
      electionId: 'e1',
      criteria: { status: 'active' as const },
      asOf: '2026-10-21T12:00:00.000Z',
      count: 3,
      merkleRoot: rollMerkleRoot('e1', members),
      approvalId: 'a1',
      // Stored alongside, but not part of what is signed:
      accountIds: members,
      status: 'approved',
      signature: null,
    };
    const statement = rollStatement(snapshot);
    expect(Object.keys(statement).sort()).toEqual(
      ['approvalId', 'asOf', 'count', 'criteria', 'electionId', 'merkleRoot', 'snapshotId', 'type', 'v'].sort(),
    );
    expect(rollSigningInput(snapshot)).toEqual(canonicalBytes(statement));
    const superseded = { ...snapshot, status: 'superseded' };
    expect(rollSigningInput(superseded)).toEqual(rollSigningInput(snapshot));
    expect(rollSigningInput({ ...snapshot, count: 4 })).not.toEqual(rollSigningInput(snapshot));
    // Golden value: roll signatures already in the ledger cover exactly these bytes (design §6.3).
    expect(sha256Hex(rollSigningInput(snapshot))).toBe('c72a82a1694be5726bbaff06beeb45ef5e9cca35a2ed3b42f4e338698f37d689');
  });

  it('signs a rehearsal roll as one, so it cannot pass for a roll of every member', () => {
    const common = { snapshotId: 's1', electionId: 'e1', asOf: '2026-10-21T12:00:00.000Z', count: 2, merkleRoot: 'r', approvalId: 'a1' };
    const members = { ...common, criteria: { status: 'active' as const } };
    const rehearsal = { ...common, criteria: { status: 'active' as const, testVotersOnly: true as const } };
    expect(rollStatement(rehearsal).criteria).toEqual({ status: 'active', testVotersOnly: true });
    expect(rollSigningInput(rehearsal)).not.toEqual(rollSigningInput(members));
    expect([isRehearsalRoll(rehearsal.criteria), isRehearsalRoll(members.criteria), isRehearsalRoll(undefined)]).toEqual([true, false, false]);
  });
});
