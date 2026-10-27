import type { BallotReceipt, PartEvidence } from 'ustp-domain';
import { mapLimited, type PublicApi } from './api.js';
import { bylawsFindings } from './bylaws.js';
import { checkElection, missingElectionFindings } from './election.js';
import { checkEntryScan } from './entries.js';
import { anchorObjectFindings, checkLedger, type AnchorFiles } from './ledger.js';
import { checkReceipt, receiptCommitment } from './receipt.js';
import type { Section } from './report.js';
import { resultsFindings } from './results.js';

export interface VerifyOptions {
  /** Check this election's published record (`--election`). Without it, a receipt's own election is checked. */
  readonly electionId?: string;
  /** Check this ballot receipt (`--receipt`). */
  readonly receipt?: BallotReceipt;
  /** Compare these downloaded anchor objects with the api (`--anchors`). */
  readonly anchors?: AnchorFiles;
  /** Scan every public ledger entry even without an election (`--entries`). */
  readonly scanEntries?: boolean;
}

/** Ledger entries fetched at once during a scan. */
const CONCURRENCY = 8;

/**
 * Fetches what the options call for and runs the checks over it; this is the only place that talks to the api. The
 * ledger is always checked, and later sections trust only the blocks it verified.
 *
 * The api has no index of an election's ledger entries, so checking an election scans every entry the verified blocks
 * cover (one request each; private entries answer 404). That is how the `roll.approved` entry, whose snapshot and
 * approval IDs the roll signature covers, and any `ballots.sealed` entry the record leaves out, are found.
 */
export async function verify(api: PublicApi, options: VerifyOptions = {}): Promise<Section[]> {
  const electionId = options.electionId ?? options.receipt?.electionId;
  const [blocks, keys, anchor, record] = await Promise.all([
    api.ledgerBlocks(),
    api.ledgerKeys(),
    api.latestAnchor(),
    electionId ? api.election(electionId) : Promise.resolve(null),
  ]);
  const ledger = await checkLedger({ blocks, keys, anchor });
  const sections: Section[] = [{ title: 'Ledger', findings: ledger.findings }];
  if (options.anchors) sections.push({ title: 'Anchor objects', findings: anchorObjectFindings(blocks, keys, options.anchors) });

  if (!electionId && !options.scanEntries) return sections;

  const lastBlock = ledger.verified.at(-1) ?? null;
  const through = lastBlock?.lastSeq ?? 0;
  const seqs = Array.from({ length: through }, (_, i) => i + 1);
  const found = await mapLimited(seqs, CONCURRENCY, (seq) => api.ledgerEntry(seq));
  const scan = checkEntryScan(new Map(seqs.map((seq, i) => [seq, found[i]!])), through, ledger.verified);
  sections.push({ title: 'Public ledger entries', findings: scan.findings });
  if (!record) {
    // Without a record only the ledger can say what became of the election (deleted, design §6.1).
    if (electionId) sections.push({ title: `Election ${electionId}`, findings: missingElectionFindings(electionId, scan.entries) });
    return sections;
  }

  const id = record.election.electionId;
  const [sealedBlocks, results] = await Promise.all([api.sealedBlocks(id), api.results(id)]);
  sections.push({
    title: `Election: ${record.election.title}`,
    findings: await checkElection({ record, entries: scan.entries, lastBlock, keys, sealedBlocks }),
  });
  const resultsEntry = Number.isSafeInteger(results?.ledgerSeq) ? await api.ledgerEntry(results!.ledgerSeq) : null;
  const certification = Number.isSafeInteger(results?.certifiedLedgerSeq) ? await api.ledgerEntry(results!.certifiedLedgerSeq!) : null;
  sections.push({
    title: 'Results',
    findings: await resultsFindings({
      evidence: { election: record, keys, ledger: resultsEntry, anchor, certification },
      results,
      blocks: sealedBlocks,
      verified: ledger.verified,
    }),
  });
  if (record.definition.contests.some((c) => c.proposal?.amendsBylaws)) {
    const view = results?.status === 'certified' ? await api.amendedBylaws(id) : null;
    const [base, adopted] = await Promise.all([
      view ? api.bylaws(view.base.version) : null,
      view?.adoptedAs ? api.bylaws(view.adoptedAs) : null,
    ]);
    sections.push({ title: 'Bylaws amendments', findings: bylawsFindings({ record, results, certification, view, base, adopted, entries: scan.entries }) });
  }

  const { receipt } = options;
  if (receipt) {
    const evidence = await mapLimited(receipt.parts, CONCURRENCY, async (part): Promise<PartEvidence> => {
      const commitment = receiptCommitment(receipt, part.contestId);
      const proof = await api.proof(id, commitment);
      const entry = proof ? await api.ledgerEntry(proof.ledgerSeq) : null;
      return { part, commitment, proof, ledger: entry, keys, anchor };
    });
    sections.push(...(await checkReceipt({ receipt, record, evidence, verified: ledger.verified })));
  }
  return sections;
}
