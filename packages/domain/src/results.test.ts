import { GENESIS_HASH, hashCanonical, newSalt, seedCommitment, tieBreakOrder, type BallotPart } from 'ustp-audit';
import { TALLY_VERSION, type IrvResult, type ProposalResult } from 'ustp-tally';
import { describe, expect, it } from 'vitest';
import { definitionHash, type ElectionDefinition } from './elections.js';
import { checkResults, type ResultsEvidence } from './results-check.js';
import { buildResultsBundle, resultsHash, resultsSigningInput, tieBreakOrders, type ResultsRecord } from './results.js';
import {
  buildSealedBlock,
  sealedBlockHash,
  sealedCommitments,
  type PublicElection,
  type SealableBallot,
  type SealedBlockRecord,
} from './sealing.js';

const SEED = '5eed'.repeat(16);
const AT = '2026-10-21T12:00:00.000Z';
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' as const }, base: 'yes_no' as const };

const definition: ElectionDefinition = {
  v: 1,
  electionId: 'e1',
  title: 'Officers',
  description: '',
  secrecy: 'secret',
  opensAt: AT,
  closesAt: AT,
  kAnonymity: 2,
  contests: [
    {
      contestId: 'plank',
      title: 'Plank 12',
      description: '',
      spec: { kind: 'proposal', id: 'plank', passRule: MAJORITY },
      proposal: { snapshotId: 'p1', title: 'Plank 12', contentHash: '0'.repeat(64) },
      candidates: [],
      positionId: null,
    },
    {
      contestId: 'chair',
      title: 'Chair',
      description: '',
      spec: { kind: 'irv', id: 'chair', candidates: ['alex', 'blair'] },
      proposal: null,
      candidates: [
        { candidateId: 'alex', name: 'Alex', statement: null },
        { candidateId: 'blair', name: 'Blair', statement: null },
      ],
      positionId: 'chair',
    },
  ],
};
const roll = { snapshotId: 'r1', merkleRoot: 'ab'.repeat(32), count: 5 };

const part = (contestId: string, selection: unknown): BallotPart => ({ v: 1, electionId: 'e1', contestId, selection, salt: newSalt() });
const ballot = (plank: string, chair: string[]): SealableBallot => ({ parts: [part('plank', plank), part('chair', chair)] });

function blocksOf(...batches: SealableBallot[][]): SealedBlockRecord[] {
  const out: SealedBlockRecord[] = [];
  for (const [i, ballots] of batches.entries()) {
    const block = buildSealedBlock({ electionId: 'e1', index: i + 1, prevSealedHash: out.at(-1)?.sealedHash ?? GENESIS_HASH, ballots, sealedAt: AT });
    out.push({ ...block, sealedHash: sealedBlockHash(block), commitments: sealedCommitments(block.contests), ledgerSeq: i + 1 });
  }
  return out;
}

const blocks = blocksOf(
  [ballot('yes', ['blair', 'alex']), ballot('no', ['alex'])],
  [ballot('yes', ['blair']), ballot('abstain', [])],
);
const input = {
  definition,
  definitionHash: definitionHash(definition),
  roll,
  tieBreakSeed: SEED,
  tieBreakSeedCommitment: seedCommitment(SEED),
  blocks,
};

describe('tie-break orders', () => {
  it('derive each candidate contest’s order from the revealed seed, and none for proposals', () => {
    const orders = tieBreakOrders(SEED, definition);
    expect(Object.keys(orders)).toEqual(['chair']);
    expect(orders.chair).toEqual(tieBreakOrder(SEED, 'chair', ['alex', 'blair']));
    expect([...orders.chair!].sort()).toEqual(['alex', 'blair']);
  });

  it('are H(JCS({v: 1, seed, contestId, candidateId})) ascending, so anyone can recompute them', () => {
    const candidates = ['c1', 'c2', 'c3', 'c4', 'c5'];
    const key = (candidateId: string) => hashCanonical({ v: 1, seed: SEED, contestId: 'board', candidateId });
    const expected = [...candidates].sort((a, b) => (key(a) < key(b) ? -1 : 1));
    expect(tieBreakOrder(SEED, 'board', candidates)).toEqual(expected);
    // Fixed vector: a change to the derivation would silently change every past election's tie-breaks.
    expect(expected).toMatchInlineSnapshot(`
      [
        "c4",
        "c2",
        "c5",
        "c3",
        "c1",
      ]
    `);
  });

  it('differ between contests and seeds', () => {
    const candidates = Array.from({ length: 8 }, (_, i) => `c${i}`);
    const a = tieBreakOrder(SEED, 'board', candidates);
    expect(tieBreakOrder(SEED, 'other', candidates)).not.toEqual(a);
    expect(tieBreakOrder('0'.repeat(64), 'board', candidates)).not.toEqual(a);
  });
});

describe('results bundles', () => {
  it('tally every contest across all sealed blocks with the roll size and seeded tie-break order', () => {
    const bundle = buildResultsBundle(input);
    expect(bundle).toMatchObject({
      v: 1,
      electionId: 'e1',
      definitionHash: definitionHash(definition),
      roll,
      participationCount: 4,
      sealedBlocks: blocks.map((b) => ({ index: b.index, sealedHash: b.sealedHash, ballotCount: 2 })),
      tally: { library: 'ustp-tally', version: TALLY_VERSION },
      tieBreakSeed: SEED,
      tieBreakSeedCommitment: seedCommitment(SEED),
    });
    expect(bundle.contests.map((c) => c.contestId)).toEqual(['plank', 'chair']);
    const [plank, chair] = bundle.contests;
    expect(plank!.tieBreakOrder).toBeNull();
    expect(plank!.result as ProposalResult).toMatchObject({ counts: { yes: 2, no: 1, abstain: 1 }, outcome: 'passed' });
    expect(chair!.tieBreakOrder).toEqual(tieBreakOrder(SEED, 'chair', ['alex', 'blair']));
    expect(chair!.result as IrvResult).toMatchObject({ ballots: 4, blank: 1, winner: 'blair' });
  });

  it('are deterministic: rebuilding from the same public data gives the same hash', () => {
    const shuffled = blocks.map((b) => ({ ...b, contests: Object.fromEntries(Object.entries(b.contests).reverse()) }));
    expect(resultsHash(buildResultsBundle({ ...input, blocks: shuffled }))).toBe(resultsHash(buildResultsBundle(input)));
    expect(resultsHash(buildResultsBundle(input))).toBe(hashCanonical(buildResultsBundle(input)));
  });

  it('record tie-breaks resolved by the seeded order', () => {
    const tied = blocksOf([ballot('yes', ['alex']), ballot('no', ['blair'])]);
    const chair = buildResultsBundle({ ...input, blocks: tied }).contests[1]!.result as IrvResult;
    const [favoured, last] = tieBreakOrder(SEED, 'chair', ['alex', 'blair']);
    expect(chair.tieBreaks).toEqual([
      { reason: 'irv_elimination', tied: [favoured, last], resolvedBy: 'tie_break_order', excluded: [last], round: 1 },
    ]);
    expect(chair.winner).toBe(favoured);
  });

  it('count an election nobody voted in', () => {
    const bundle = buildResultsBundle({ ...input, blocks: [] });
    expect(bundle.participationCount).toBe(0);
    expect((bundle.contests[0]!.result as ProposalResult).outcome).toBe('failed');
    expect((bundle.contests[1]!.result as IrvResult).winner).toBeNull();
  });

  it('refuse a seed that does not match its commitment, or a malformed one', () => {
    expect(() => buildResultsBundle({ ...input, tieBreakSeed: '0'.repeat(64) })).toThrow(/does not match the commitment/);
    expect(() => buildResultsBundle({ ...input, tieBreakSeed: 'not hex' })).toThrow(/does not match the commitment/);
  });

  it('refuse a changed definition, altered blocks, or parts of an unknown contest', () => {
    expect(() => buildResultsBundle({ ...input, definitionHash: '0'.repeat(64) })).toThrow(/definitionHash/);
    const altered = [{ ...blocks[0]!, contests: { ...blocks[0]!.contests, plank: blocks[0]!.contests.plank!.map((p) => ({ ...p, selection: 'yes' })) } }, blocks[1]!];
    expect(() => buildResultsBundle({ ...input, blocks: altered })).toThrow(/do not verify/);
    const stray = blocksOf([{ parts: [part('treasurer', ['alex'])] }]);
    expect(() => buildResultsBundle({ ...input, blocks: stray })).toThrow(/unknown contest treasurer/);
  });
});

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** A P-256 key and a signature over `data` in the DER form Cloud KMS returns, made with Web Crypto. */
async function signed(data: Uint8Array): Promise<{ publicKeyPem: string; signature: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new Uint8Array(data)));
  const int = (v: Uint8Array) => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    const body = v[i]! & 0x80 ? [0, ...v.subarray(i)] : [...v.subarray(i)];
    return [0x02, body.length, ...body];
  };
  const seq = [...int(raw.subarray(0, 32)), ...int(raw.subarray(32))];
  return {
    publicKeyPem: `-----BEGIN PUBLIC KEY-----
${base64(spki)}
-----END PUBLIC KEY-----
`,
    signature: base64(Uint8Array.from([0x30, seq.length, ...seq])),
  };
}

describe('the results check', async () => {
  const keyVersion = 'test/audit-signing/1';
  const bundle = buildResultsBundle(input);
  const { publicKeyPem, signature } = await signed(resultsSigningInput(bundle));
  const keys = [{ keyId: 'k1', keyVersion, publicKeyPem, firstUsedAt: AT }];
  const results: ResultsRecord = {
    electionId: 'e1',
    status: 'provisional',
    bundle,
    resultsHash: resultsHash(bundle),
    signature: { keyVersion, signature },
    computedAt: AT,
    ledgerSeq: 9,
  };
  const election: PublicElection = {
    election: {
      electionId: 'e1',
      title: 'Officers',
      description: '',
      secrecy: 'secret',
      state: 'closed',
      opensAt: AT,
      closesAt: AT,
      kAnonymity: 2,
      definitionHash: definitionHash(definition),
      tieBreakSeedCommitment: seedCommitment(SEED),
      openedAt: AT,
      closedAt: AT,
      sealedAt: AT,
      certifiedAt: null,
      poolKeyDestroyedAt: null,
      cancelledAt: null,
    },
    definition,
    roll: { ...roll, criteria: { status: 'active' }, asOf: AT, signature: null },
    sealedBlocks: [],
    ballotsSealed: 4,
    results: null,
  };
  const evidence: ResultsEvidence = { election, results, blocks, keys, ledger: null, anchor: null };

  it('passes everything it can check before the ledger block exists', async () => {
    const check = await checkResults(evidence);
    expect(check.steps.filter((s) => s.ok !== true).map((s) => s.label)).toEqual(['Recorded in the signed audit ledger']);
    expect(check.status).toBe('pending');
  });

  it('fails a forged outcome even when it is re-hashed, because the signature and the re-tally disagree', async () => {
    const forged = {
      ...bundle,
      contests: bundle.contests.map((c) => (c.contestId === 'chair' ? { ...c, result: { ...c.result, winner: 'alex' } as IrvResult } : c)),
    };
    const check = await checkResults({ ...evidence, results: { ...results, bundle: forged, resultsHash: resultsHash(forged) } });
    expect(check.status).toBe('failed');
    const failed = check.steps.filter((s) => s.ok === false).map((s) => s.label);
    expect(failed).toEqual(['Results signed by the audit key', `Re-tallied here with ustp-tally ${TALLY_VERSION}: the same results`]);
  });

  it('fails a revealed seed that does not match the published commitment', async () => {
    const other = { ...election, election: { ...election.election, tieBreakSeedCommitment: seedCommitment('0'.repeat(64)) } };
    const check = await checkResults({ ...evidence, election: other });
    expect(check.steps.find((s) => s.label.startsWith('The revealed tie-break seed'))?.ok).toBe(false);
    expect(check.status).toBe('failed');
  });

  it('fails when a published block is missing from the count', async () => {
    const check = await checkResults({ ...evidence, blocks: blocks.slice(0, 1) });
    expect(check.steps.find((s) => s.label.startsWith('Counts every published sealed block'))?.ok).toBe(false);
  });
});
