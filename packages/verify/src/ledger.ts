import { blockBody, blockHash, blockSigningInput, canonicalBytes, GENESIS_HASH, isHex32, verifyEcdsaP256 } from 'ustp-audit';
import {
  sequenceId,
  signingKeyId,
  type AnchorDocument,
  type AnchorRecord,
  type LedgerBlockRecord,
  type SigningKeyRecord,
} from 'ustp-domain';
import { fail, info, pass, pending, problemsFinding, type Finding } from './report.js';
import { attempt, count, equalBytes, ranges } from './util.js';

/**
 * Ledger checks from public data (design §8.3, §8.4). The api publishes every block but only the public entries, so
 * unlike `verifyBlocks` (which needs every entry hash) this checks what an outsider can: numbering, contiguous entry
 * ranges, both links, each block's hash and signature, and the anchors. Merkle roots are checked per public entry,
 * through its inclusion proof (`entries.ts`).
 */

export interface BlockProblem {
  readonly index: number;
  readonly reason: string;
}

/** Problems with the chain of blocks as served, block by block; empty when it links from genesis without a gap. */
export function blockChainProblems(blocks: readonly LedgerBlockRecord[]): BlockProblem[] {
  const problems: BlockProblem[] = [];
  let prevHash = GENESIS_HASH;
  let nextIndex = 1;
  let nextSeq = 1;
  for (const block of blocks) {
    const add = (reason: string) => problems.push({ index: block.index, reason });
    if (block.v !== 1) add('unknown block version');
    if (block.index !== nextIndex) add('block numbers are not consecutive');
    if (block.prevBlockHash !== prevHash) add('prevBlockHash does not match the previous block');
    if (block.firstSeq !== nextSeq) add('block does not start right after the previous one');
    if (!Number.isSafeInteger(block.lastSeq) || block.lastSeq < block.firstSeq) add('block covers no entries');
    if (!isHex32(block.merkleRoot) || !isHex32(block.headEntryHash)) add('Merkle root or head entry hash is malformed');
    if (attempt(() => blockHash(block)) !== block.blockHash) add('blockHash does not match the block contents');
    // Link on what the block claims, so one altered or missing block is reported once and not again at each successor.
    prevHash = block.blockHash;
    nextIndex = block.index + 1;
    nextSeq = block.lastSeq + 1;
  }
  return problems;
}

/** Each block's signature against the key the api lists for its key version. */
export async function blockSignatureProblems(
  blocks: readonly LedgerBlockRecord[],
  keys: readonly SigningKeyRecord[],
): Promise<BlockProblem[]> {
  const pems = new Map(keys.map((k) => [k.keyVersion, k.publicKeyPem]));
  const problems: BlockProblem[] = [];
  for (const block of blocks) {
    const pem = pems.get(block.signature?.keyVersion);
    if (!pem) problems.push({ index: block.index, reason: 'signed by a key the api does not list' });
    else if (!(await verifyEcdsaP256(pem, blockSigningInput(block), block.signature.signature))) {
      problems.push({ index: block.index, reason: 'signature does not verify' });
    }
  }
  return problems;
}

/** A key's ID names its anchor object (`v1/keys/{keyId}.pem`), so it must be derived from the key version. */
export function keyProblems(keys: readonly SigningKeyRecord[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (key.keyId !== signingKeyId(key.keyVersion)) problems.push(`key ${key.keyId}: its ID is not derived from ${key.keyVersion}`);
    if (seen.has(key.keyVersion)) problems.push(`key version ${key.keyVersion} is listed twice`);
    seen.add(key.keyVersion);
  }
  return problems;
}

export interface LedgerCheck {
  readonly findings: readonly Finding[];
  /**
   * The blocks before the first problem of any kind. A chain is only as good as its first break, so the entry,
   * election and receipt checks trust these blocks and no others.
   */
  readonly verified: readonly LedgerBlockRecord[];
}

export async function checkLedger(input: {
  readonly blocks: readonly LedgerBlockRecord[];
  readonly keys: readonly SigningKeyRecord[];
  readonly anchor: AnchorRecord | null;
}): Promise<LedgerCheck> {
  const { blocks, keys, anchor } = input;
  if (blocks.length === 0) {
    return { findings: [pending('Ledger blocks', 'no ledger blocks yet: the worker seals the first within a minute of the first entry')], verified: [] };
  }
  const chain = blockChainProblems(blocks);
  const signatures = await blockSignatureProblems(blocks, keys);
  const firstBad = Math.min(...[...chain, ...signatures].map((p) => p.index));
  const verified = blocks.filter((b, i) => i + 1 < firstBad && b.index === i + 1);
  const head = blocks.at(-1)!;
  const describe = (p: BlockProblem) => `block ${p.index}: ${p.reason}`;
  const findings: Finding[] = [
    info(`${count(blocks.length, 'ledger block')} covering entries 1-${head.lastSeq}`, `head block ${head.index}: ${head.blockHash}`),
    problemsFinding(
      'Blocks chain from genesis (consecutive numbers, contiguous entries, prevBlockHash links, blockHash recomputes)',
      chain.map(describe),
    ),
    problemsFinding('Signing keys are listed under the IDs derived from their key versions', keyProblems(keys), keys.map((k) => `${k.keyId} ${k.keyVersion}`).join('\n')),
    problemsFinding(`Every block's signature verifies with a listed audit key`, signatures.map(describe)),
    anchorFinding(anchor, blocks),
  ];
  return { findings, verified };
}

/** The latest anchor must name a block the api serves, with the same hash, and should have caught up with the head. */
export function anchorFinding(anchor: AnchorRecord | null, blocks: readonly LedgerBlockRecord[]): Finding {
  const label = 'The latest anchor covers the head block';
  const head = blocks.at(-1);
  if (!anchor) return head ? pending(label, 'nothing has been anchored yet') : info(label, 'no blocks and no anchors yet');
  const block = blocks[anchor.index - 1];
  if (!block || block.index !== anchor.index) {
    return fail(label, `the anchor is for block ${anchor.index}, but the api serves blocks 1-${head?.index ?? 0}: history is missing`);
  }
  if (anchor.blockHash !== block.blockHash) {
    return fail(label, `the anchor records block ${anchor.index} as ${anchor.blockHash}; the api serves ${block.blockHash}`);
  }
  if (!anchor.uri.endsWith(`/${anchorObjectPath(anchor.index)}`)) {
    return fail(label, `the anchor URI ${anchor.uri} is not block ${anchor.index}'s anchor object`);
  }
  const where = `block ${anchor.index} at ${anchor.uri} (generation ${anchor.generation}, ${anchor.anchoredAt})`;
  if (anchor.index < head!.index) return pending(label, `anchored through ${where}; block ${head!.index} follows within a minute`);
  return pass(label, where);
}

/** Where block `index` is anchored in the bucket. */
export function anchorObjectPath(index: number): string {
  return `v1/blocks/${sequenceId(index)}.json`;
}

/** What the worker writes to the anchors bucket for a block; its JCS bytes are the object's content. */
export function anchorDocument(block: LedgerBlockRecord): AnchorDocument {
  return { v: 1, block: blockBody(block), blockHash: block.blockHash, signature: block.signature };
}

/** Anchor objects downloaded from the bucket (`v1/blocks/<index>.json`, `v1/keys/<keyId>.pem`), as raw bytes. */
export interface AnchorFiles {
  readonly blocks: ReadonlyMap<number, Uint8Array>;
  readonly keys: ReadonlyMap<string, Uint8Array>;
}

/**
 * Compares downloaded anchor objects byte for byte with what the api serves: each block object with JCS of
 * `{v, block, blockHash, signature}` for that block, each key object with the listed public key. An object for a block
 * the api no longer serves means the api's history was cut or rewritten.
 */
export function anchorObjectFindings(
  blocks: readonly LedgerBlockRecord[],
  keys: readonly SigningKeyRecord[],
  files: AnchorFiles,
): Finding[] {
  if (files.blocks.size === 0 && files.keys.size === 0) {
    return [fail('Anchor objects match the api', 'no v1/blocks/<index>.json or v1/keys/<keyId>.pem files found')];
  }
  const blockProblems: string[] = [];
  for (const [index, content] of [...files.blocks].sort(([a], [b]) => a - b)) {
    const block = blocks[index - 1];
    if (!block || block.index !== index) blockProblems.push(`${anchorObjectPath(index)}: the api does not serve block ${index}`);
    else if (!equalBytes(content, canonicalBytes(anchorDocument(block)))) {
      blockProblems.push(`${anchorObjectPath(index)}: differs from block ${index} as the api serves it`);
    }
  }
  const keyProblems: string[] = [];
  for (const [keyId, content] of files.keys) {
    const key = keys.find((k) => k.keyId === keyId);
    if (!key) keyProblems.push(`v1/keys/${keyId}.pem: the api does not list key ${keyId}`);
    else if (!equalBytes(content, new TextEncoder().encode(key.publicKeyPem))) keyProblems.push(`v1/keys/${keyId}.pem: differs from the listed key`);
  }
  const notDownloaded = blocks.filter((b) => !files.blocks.has(b.index)).map((b) => b.index);
  const findings = [
    problemsFinding('Block anchor objects match the blocks byte for byte', blockProblems, count(files.blocks.size, 'object')),
    problemsFinding('Key anchor objects match the listed keys', keyProblems, count(files.keys.size, 'object')),
  ];
  if (notDownloaded.length) findings.push(info('Blocks without a downloaded anchor object', ranges(notDownloaded)));
  const keysMissing = keys.filter((k) => !files.keys.has(k.keyId));
  if (keysMissing.length) findings.push(info('Keys without a downloaded anchor object', keysMissing.map((k) => k.keyId).join(', ')));
  return findings;
}

