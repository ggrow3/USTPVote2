import { blockHash, recordHash, verifyInclusionHex } from 'ustp-audit';
import { isPublicLedgerEvent, type LedgerBlockRecord, type LedgerEntry, type PublicLedgerEntry } from 'ustp-domain';
import { info, problemsFinding, type Finding } from './report.js';
import { attempt } from './util.js';

/**
 * Public ledger entries (design §8.2): each comes with the block that covers it and an RFC 9162 inclusion proof. An
 * entry verifies when its hash recomputes and the proof leads from that hash to the Merkle root of a block the ledger
 * check verified, so its signature covers the entry too.
 */

/** Problems with entry `seq` as the api served it; empty when it verifies. */
export function publicEntryProblems(seq: number, found: PublicLedgerEntry, verified: readonly LedgerBlockRecord[]): string[] {
  const { entry, block, proof } = found;
  const at = `entry ${seq}`;
  const problems: string[] = [];
  if (entry.seq !== seq) problems.push(`${at}: the api returned entry ${entry.seq}`);
  if (entry.v !== 1) problems.push(`${at}: unknown entry version`);
  if (!isPublicLedgerEvent(entry.type)) problems.push(`${at}: ${entry.type} entries are not meant to be public`);
  if (attempt(() => recordHash(entry)) !== entry.hash) problems.push(`${at}: hash does not match the entry contents`);

  const known = verified[block.index - 1];
  if (!known || known.index !== block.index) {
    problems.push(`${at}: its block ${block.index} is not a verified ledger block`);
    return problems;
  }
  if (block.blockHash !== known.blockHash || attempt(() => blockHash(block)) !== known.blockHash) {
    problems.push(`${at}: the block served with it differs from ledger block ${known.index}`);
  }
  if (seq < known.firstSeq || seq > known.lastSeq) {
    problems.push(`${at}: block ${known.index} covers entries ${known.firstSeq}-${known.lastSeq}`);
    return problems;
  }
  const proofOk =
    proof.leafIndex === seq - known.firstSeq &&
    proof.treeSize === known.lastSeq - known.firstSeq + 1 &&
    proof.root === known.merkleRoot &&
    verifyInclusionHex(entry.hash, proof);
  if (!proofOk) problems.push(`${at}: inclusion proof does not lead to block ${known.index}'s Merkle root`);
  if (seq === known.lastSeq && entry.hash !== known.headEntryHash) problems.push(`${at}: is not block ${known.index}'s head entry`);
  return problems;
}

/** Where two public entries are next to each other, the later one must link to the earlier one's hash. */
export function entryLinkProblems(entries: ReadonlyMap<number, LedgerEntry>): string[] {
  const problems: string[] = [];
  for (const [seq, entry] of entries) {
    const before = entries.get(seq - 1);
    if (before && entry.prevHash !== before.hash) problems.push(`entry ${seq}: prevHash does not link to entry ${seq - 1}`);
  }
  return problems;
}

export interface EntryScan {
  /** Public entries that verify, by seq. */
  readonly entries: ReadonlyMap<number, PublicLedgerEntry>;
  /** Entries 1..through were asked for: everything the verified blocks cover. */
  readonly through: number;
  readonly findings: readonly Finding[];
}

/**
 * Checks what a scan of entries 1..through returned: an entry for each public one, null (404) for the rest. Only
 * entries that verify are kept for the election checks.
 */
export function checkEntryScan(
  fetched: ReadonlyMap<number, PublicLedgerEntry | null>,
  through: number,
  verified: readonly LedgerBlockRecord[],
): EntryScan {
  const entries = new Map<number, PublicLedgerEntry>();
  const problems: string[] = [];
  let hidden = 0;
  for (let seq = 1; seq <= through; seq++) {
    const found = fetched.get(seq);
    if (!found) {
      hidden++;
      continue;
    }
    const wrong = publicEntryProblems(seq, found, verified);
    if (wrong.length) problems.push(...wrong);
    else entries.set(seq, found);
  }
  problems.push(...entryLinkProblems(new Map([...entries].map(([seq, e]) => [seq, e.entry]))));
  return {
    entries,
    through,
    findings: [
      info(`Scanned entries 1-${through}: ${through - hidden} public, ${hidden} private (not served)`),
      problemsFinding(
        'Every public entry hashes correctly and is included in a verified block',
        problems,
        'neighbouring public entries also link by prevHash',
      ),
    ],
  };
}
