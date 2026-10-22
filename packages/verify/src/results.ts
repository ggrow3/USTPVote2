import {
  checkResults,
  type LedgerBlockRecord,
  type ResultsEvidence,
  type ResultsRecord,
  type SealedBlockRecord,
} from 'ustp-domain';
import { fail, info, pass, pending, stepFinding, type Finding } from './report.js';

/**
 * Results (design §2 invariant 4, §9) with `checkResults` from ustp-domain, the check the results page runs: the
 * bundle's hash and signature, the frozen definition and roll, the revealed tie-break seed against its commitment, the
 * sealed blocks, a full re-tally with ustp-tally that must reproduce the bundle byte for byte, and the
 * `results.computed` entry through the signed, anchored ledger. On top of that, the ledger block the entry is served
 * with must be one the ledger check verified.
 */
export async function resultsFindings(input: {
  readonly evidence: Omit<ResultsEvidence, 'results' | 'blocks'>;
  /** null: not published (404, or 409 before the tally). */
  readonly results: ResultsRecord | null;
  /** null: sealed contents not published yet. */
  readonly blocks: readonly SealedBlockRecord[] | null;
  readonly verified: readonly LedgerBlockRecord[];
}): Promise<Finding[]> {
  const { evidence, results, blocks, verified } = input;
  if (!results) return [info('Results', 'not published yet: they are computed once voting has closed and every ballot is sealed')];
  if (!blocks) return [pending('Results can be re-tallied', 'the sealed ballots are not published yet')];
  let check;
  try {
    check = await checkResults({ ...evidence, results, blocks });
  } catch (e) {
    return [fail('The results bundle can be read', e instanceof Error ? e.message : String(e))];
  }
  const findings = check.steps.map(stepFinding);
  if (evidence.ledger) {
    const known = verified[evidence.ledger.block.index - 1];
    const label = `Ledger block ${evidence.ledger.block.index} is one the ledger check verified`;
    findings.push(known?.blockHash === evidence.ledger.block.blockHash ? pass(label) : fail(label, 'the block served with the entry is not in the verified chain'));
  }
  return findings;
}
