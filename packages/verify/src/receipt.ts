import { checkReceiptPart, type BallotReceipt, type LedgerBlockRecord, type PartEvidence, type PublicElection } from 'ustp-domain';
import { fail, pass, problemsFinding, stepFinding, type Section } from './report.js';
import { count } from './util.js';

/** Reads a receipt file the way the /verify page does: JSON, version 1, with an election, parts and commitments. */
export function parseReceipt(text: string): BallotReceipt {
  let value: unknown;
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); // some Windows tools save with a BOM
  } catch {
    throw new Error('the receipt is not valid JSON');
  }
  const r = value as Partial<BallotReceipt> | null;
  if (r?.v !== 1 || typeof r.electionId !== 'string' || !Array.isArray(r.parts) || !Array.isArray(r.commitments)) {
    throw new Error('that is not a USTP ballot receipt');
  }
  return r as BallotReceipt;
}

/** The commitment a receipt lists for a contest, or '' when it lists none (the check then fails at its first step). */
export function receiptCommitment(receipt: BallotReceipt, contestId: string): string {
  return receipt.commitments.find((c) => c.contestId === contestId)?.commitment ?? '';
}

/**
 * A receipt's check (design §7.5): that it was cast on the published definition, then for each part every step of
 * `checkReceiptPart` (commitment, sealed block, ledger entry, ledger block, signature, anchor), plus that the ledger
 * block the proof leads to is one the ledger check verified. `evidence` is what was fetched for each part.
 */
export async function checkReceipt(input: {
  readonly receipt: BallotReceipt;
  readonly record: PublicElection;
  readonly evidence: readonly PartEvidence[];
  readonly verified: readonly LedgerBlockRecord[];
}): Promise<Section[]> {
  const { receipt, record, evidence, verified } = input;
  const problems: string[] = [];
  if (receipt.electionId !== record.election.electionId) problems.push(`the receipt is for election ${receipt.electionId}`);
  if (receipt.definitionHash !== record.election.definitionHash) {
    problems.push(`the receipt was cast on definition ${receipt.definitionHash}; the election's is ${record.election.definitionHash}`);
  }
  for (const c of receipt.commitments) {
    if (!receipt.parts.some((p) => p.contestId === c.contestId)) problems.push(`commitment for contest ${c.contestId} has no part`);
  }
  const sections: Section[] = [
    {
      title: `Receipt cast ${receipt.castAt}`,
      findings: [problemsFinding('The receipt belongs to this election and was cast on its published definition', problems, count(receipt.parts.length, 'part'))],
    },
  ];
  for (const e of evidence) {
    const check = await checkReceiptPart(e);
    const findings = check.steps.map(stepFinding);
    // Only once the part's own check went past its commitment to the ledger entry the proof names.
    if (check.steps[0]?.ok && e.ledger) {
      const known = verified[e.ledger.block.index - 1];
      const label = `Ledger block ${e.ledger.block.index} is one the ledger check verified`;
      findings.push(known?.blockHash === e.ledger.block.blockHash ? pass(label) : fail(label, 'the block served with the entry is not in the verified chain'));
    }
    const title = record.definition.contests.find((c) => c.contestId === e.part.contestId)?.title ?? e.part.contestId;
    sections.push({ title: `Receipt part: ${title} (${check.status})`, findings });
  }
  return sections;
}
