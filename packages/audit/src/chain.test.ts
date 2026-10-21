import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, linkRecord, verifyChain } from './chain.js';
import { ballotPartCommitment, newSalt, type BallotPart } from './commitment.js';
import { isHex32 } from './hash.js';
import { seedCommitment, tieBreakOrder } from './tiebreak.js';

function buildChain(n: number) {
  const records = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const record = linkRecord({ v: 1, seq, type: 'test.event', payload: { n: seq } }, prev);
    records.push(record);
    prev = record.hash;
  }
  return records;
}

describe('hash chain', () => {
  it('verifies an intact chain and reports its head', () => {
    const chain = buildChain(4);
    expect(verifyChain(chain)).toEqual({ ok: true, head: chain[3]!.hash });
    expect(verifyChain([])).toEqual({ ok: true, head: GENESIS_HASH });
  });

  it('detects edited, reordered and dropped records', () => {
    const chain = buildChain(4);
    const edited = chain.map((r, i) => (i === 2 ? { ...r, payload: { n: 99 } } : r));
    expect(verifyChain(edited)).toMatchObject({ ok: false, index: 2, reason: /hash does not match/ });

    const swapped = [chain[0]!, chain[2]!, chain[1]!, chain[3]!];
    expect(verifyChain(swapped)).toMatchObject({ ok: false, index: 1, reason: /prevHash/ });

    expect(verifyChain([chain[0]!, chain[2]!])).toMatchObject({ ok: false, index: 1 });
  });

  it('verifies a segment from a known starting hash', () => {
    const chain = buildChain(5);
    expect(verifyChain(chain.slice(2), chain[1]!.hash)).toEqual({ ok: true, head: chain[4]!.hash });
    expect(verifyChain(chain.slice(2))).toMatchObject({ ok: false, index: 0 });
  });

  it('refuses bodies that already carry chain fields', () => {
    expect(() => linkRecord({ hash: 'x' }, GENESIS_HASH)).toThrow(/must not contain/);
    expect(() => linkRecord({ a: 1 }, 'abc')).toThrow(/prevHash/);
  });
});

describe('ballot commitments', () => {
  const part: BallotPart = {
    v: 1,
    electionId: '0192f1c4-7a00-7000-8000-000000000001',
    contestId: 'chair',
    selection: ['b', 'a'],
    salt: 'ab'.repeat(32),
  };

  it('is deterministic and depends on every field', () => {
    const c = ballotPartCommitment(part);
    expect(isHex32(c)).toBe(true);
    expect(ballotPartCommitment({ ...part })).toBe(c);
    expect(ballotPartCommitment({ ...part, salt: 'cd'.repeat(32) })).not.toBe(c);
    expect(ballotPartCommitment({ ...part, selection: ['a', 'b'] })).not.toBe(c);
    expect(ballotPartCommitment({ ...part, contestId: 'treasurer' })).not.toBe(c);
  });

  it('ignores extra fields such as an open-ballot accountId', () => {
    const withAccount = { ...part, accountId: 'someone' } as BallotPart;
    expect(ballotPartCommitment(withAccount)).toBe(ballotPartCommitment(part));
  });

  it('requires a 32-byte hex salt', () => {
    expect(() => ballotPartCommitment({ ...part, salt: 'AB'.repeat(32) })).toThrow(/salt/);
    expect(() => ballotPartCommitment({ ...part, salt: 'ab' })).toThrow(/salt/);
    expect(isHex32(newSalt())).toBe(true);
    expect(newSalt()).not.toBe(newSalt());
  });
});

describe('tie-break order', () => {
  const seed = '5e'.repeat(32);

  it('is a deterministic permutation that varies by seed and contest', () => {
    const candidates = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const order = tieBreakOrder(seed, 'chair', candidates);
    expect([...order].sort()).toEqual(candidates);
    expect(tieBreakOrder(seed, 'chair', [...candidates].reverse())).toEqual(order);
    expect(tieBreakOrder('5f'.repeat(32), 'chair', candidates)).not.toEqual(order);
    expect(tieBreakOrder(seed, 'treasurer', candidates)).not.toEqual(order);
  });

  it('commits to the raw seed bytes', () => {
    // sha256 of 32 zero bytes
    expect(seedCommitment('00'.repeat(32))).toBe('66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925');
    expect(() => seedCommitment('00')).toThrow(/seed/);
    expect(() => tieBreakOrder(seed, 'c', ['a', 'a'])).toThrow(/unique/);
  });
});
