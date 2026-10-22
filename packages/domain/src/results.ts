import { canonicalBytes, hashCanonical, seedCommitment, tieBreakOrder } from 'ustp-audit';
import { tallyContest, TALLY_VERSION, type ContestResult } from 'ustp-tally';
import { definitionHash, type ElectionDefinition } from './elections.js';
import type { SignatureRecord } from './ledger.js';
import { sealedBlockProblems, type SealedBlockRecord } from './sealing.js';

/**
 * Results (design §9). The bundle holds everything an outcome depends on, and nothing that is not public once voting
 * has closed, so anyone holding the published record, the sealed blocks and the revealed seed can rebuild it byte for
 * byte. Its hash is what the worker signs and ledgers, and what certification (M4b) approves.
 */

export interface ContestOutcome {
  readonly contestId: string;
  /** Candidate contests: the order derived from the revealed seed, most favoured first. Null for proposals. */
  readonly tieBreakOrder: readonly string[] | null;
  readonly result: ContestResult;
}

export interface ResultsBundle {
  readonly v: 1;
  readonly electionId: string;
  readonly definitionHash: string;
  /** The approved roll; `count` is the roll size quorum and `roll`-based pass rules use. */
  readonly roll: { readonly snapshotId: string; readonly merkleRoot: string; readonly count: number };
  /** Ballots counted: every ballot in the sealed blocks, which the sealer checked equals participation. */
  readonly participationCount: number;
  readonly sealedBlocks: readonly { readonly index: number; readonly sealedHash: string; readonly ballotCount: number }[];
  readonly tally: { readonly library: 'ustp-tally'; readonly version: string };
  /** Revealed at tally; its SHA-256 is the commitment published at scheduling. */
  readonly tieBreakSeed: string;
  readonly tieBreakSeedCommitment: string;
  /** In definition order. */
  readonly contests: readonly ContestOutcome[];
}

/** `results/{electionId}`, and `GET /v1/public/elections/{id}/results`. */
export interface ResultsRecord {
  readonly electionId: string;
  /** `certified` arrives with two-person certification (M4b). */
  readonly status: 'provisional' | 'certified';
  readonly bundle: ResultsBundle;
  /** H(JCS(bundle)). */
  readonly resultsHash: string;
  /** By the `audit-signing` key over JCS(bundle), as for ledger blocks. */
  readonly signature: SignatureRecord;
  readonly computedAt: string;
  /** The `results.computed` ledger entry. */
  readonly ledgerSeq: number;
  /** Set by two-person certification (M4b), with the `results.certified` ledger entry. */
  readonly certifiedAt?: string | null;
  readonly certifiedLedgerSeq?: number | null;
}

/** What the published election record says about its results. */
export type ResultsSummary = Pick<
  ResultsRecord,
  'status' | 'resultsHash' | 'computedAt' | 'ledgerSeq' | 'certifiedAt' | 'certifiedLedgerSeq'
>;

export function resultsSummary(record: ResultsRecord): ResultsSummary {
  return {
    status: record.status,
    resultsHash: record.resultsHash,
    computedAt: record.computedAt,
    ledgerSeq: record.ledgerSeq,
    certifiedAt: record.certifiedAt ?? null,
    certifiedLedgerSeq: record.certifiedLedgerSeq ?? null,
  };
}

/**
 * The tie-break order of every candidate contest (design §9): candidates sorted by
 * H(JCS({v: 1, seed, contestId, candidateId})), most favoured first. Proposals need none.
 */
export function tieBreakOrders(seed: string, definition: ElectionDefinition): Record<string, string[]> {
  const orders: Record<string, string[]> = {};
  for (const { contestId, spec } of definition.contests) {
    if (spec.kind !== 'proposal') orders[contestId] = tieBreakOrder(seed, contestId, spec.candidates);
  }
  return orders;
}

/**
 * Tallies a closed, sealed election into its results bundle. Throws, rather than counting anything, if the definition
 * does not hash to the frozen one, the seed does not match its commitment, or the sealed blocks do not verify or hold
 * parts that belong to no contest of this election.
 */
export function buildResultsBundle(input: {
  readonly definition: ElectionDefinition;
  /** Frozen at scheduling. */
  readonly definitionHash: string;
  readonly roll: ResultsBundle['roll'];
  readonly tieBreakSeed: string;
  /** Published at scheduling. */
  readonly tieBreakSeedCommitment: string;
  /** Every sealed block of the election, in order. */
  readonly blocks: readonly SealedBlockRecord[];
}): ResultsBundle {
  const { definition, roll, tieBreakSeed, blocks } = input;
  const { electionId } = definition;
  if (definitionHash(definition) !== input.definitionHash) throw new Error('the definition does not hash to the frozen definitionHash');
  if (!matchesCommitment(tieBreakSeed, input.tieBreakSeedCommitment)) {
    throw new Error('the tie-break seed does not match the commitment published at scheduling');
  }
  if (blocks.some((b) => b.electionId !== electionId)) throw new Error('a sealed block belongs to another election');
  const problems = sealedBlockProblems(blocks);
  if (problems.length) throw new Error(`the sealed blocks do not verify: ${problems.join('; ')}`);

  const selections = new Map<string, unknown[]>(definition.contests.map((c) => [c.contestId, []]));
  for (const block of blocks) {
    for (const [contestId, parts] of Object.entries(block.contests)) {
      const into = selections.get(contestId);
      if (!into) throw new Error(`sealed block ${block.index} holds parts for unknown contest ${contestId}`);
      for (const part of parts) {
        if (part.contestId !== contestId || part.electionId !== electionId) {
          throw new Error(`sealed block ${block.index} holds a part filed under the wrong contest or election`);
        }
        into.push(part.selection);
      }
    }
  }

  const orders = tieBreakOrders(tieBreakSeed, definition);
  return {
    v: 1,
    electionId,
    definitionHash: input.definitionHash,
    roll: { snapshotId: roll.snapshotId, merkleRoot: roll.merkleRoot, count: roll.count },
    participationCount: blocks.reduce((n, b) => n + b.ballotCount, 0),
    sealedBlocks: blocks.map((b) => ({ index: b.index, sealedHash: b.sealedHash, ballotCount: b.ballotCount })),
    tally: { library: 'ustp-tally', version: TALLY_VERSION },
    tieBreakSeed,
    tieBreakSeedCommitment: input.tieBreakSeedCommitment,
    contests: definition.contests.map(({ contestId, spec }) => {
      const order = orders[contestId] ?? null;
      const ctx = order ? { rollSize: roll.count, tieBreakOrder: order } : { rollSize: roll.count };
      return { contestId, tieBreakOrder: order, result: tallyContest(spec, selections.get(contestId)!, ctx) };
    }),
  };
}

export function resultsHash(bundle: ResultsBundle): string {
  return hashCanonical(bundle);
}

/**
 * The bytes a results signature covers: JCS(bundle), UTF-8. Their SHA-256 is `resultsHash`, so Cloud KMS signs
 * `resultsHash`, exactly as it signs `blockHash` for ledger blocks (design §8.3).
 */
export function resultsSigningInput(bundle: ResultsBundle): Uint8Array {
  return canonicalBytes(bundle);
}

/** H(seed) = commitment; false for a malformed seed rather than throwing. */
export function matchesCommitment(seed: string, commitment: string | null): boolean {
  try {
    return seedCommitment(seed) === commitment;
  } catch {
    return false;
  }
}
