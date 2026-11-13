import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  blockBody,
  blockSigningInput,
  canonicalize,
  entryInclusionProof,
  GENESIS_HASH,
  linkRecord,
  verifyBlocks,
  verifyChain,
  verifyEcdsaP256,
} from 'ustp-audit';
import {
  Collections,
  isPublicLedgerEvent,
  sequenceId,
  type AnchorDocument,
  type AnchorRecord,
  type LedgerBlockRecord,
  type LedgerEntry,
  type LedgerEvent,
  type LedgerVerification,
  type PublicLedgerEntry,
  type SigningKeyRecord,
} from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';

interface LedgerHead {
  readonly seq: number;
  readonly hash: string;
}

/**
 * The append-only, hash-chained audit ledger (design §8.2) and read access to its blocks and anchors (§8.3, §8.4).
 * The worker seals blocks and anchors them (`LedgerSealer`); this service never signs.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger('Ledger');

  constructor(
    private readonly firebase: Firebase,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /**
   * Appends events inside `tx` and returns their sequence numbers. Firestore transactions require all reads
   * before any write, so call this after the transaction's own reads and before its own writes.
   */
  async record(tx: Transaction, events: readonly LedgerEvent[]): Promise<number[]> {
    const headRef = this.headRef();
    const headSnap = await tx.get(headRef);
    let head: LedgerHead = headSnap.exists ? (headSnap.data() as LedgerHead) : { seq: 0, hash: GENESIS_HASH };
    const at = new Date().toISOString();
    const seqs: number[] = [];
    for (const event of events) {
      const seq = head.seq + 1;
      const entry: LedgerEntry = linkRecord(
        { v: 1 as const, seq, type: event.type, at, actor: event.actor, subject: event.subject, payload: event.payload },
        head.hash,
      );
      tx.create(this.firebase.db.collection(Collections.auditEvents).doc(sequenceId(seq)), entry);
      head = { seq, hash: entry.hash };
      seqs.push(seq);
      // The developer log's line for the action (design §14, "Logging"): what, by whom, about what, never the payload.
      // Written as the transaction runs, so one Firestore retries is written again, and one that fails was never kept:
      // the ledger is the record, this is for following a request.
      this.logger.log({ message: `ledger ${event.type}`, event: event.type, seq, actor: event.actor, subject: event.subject });
    }
    tx.set(headRef, head);
    return seqs;
  }

  async list(afterSeq: number, limit: number): Promise<LedgerEntry[]> {
    const snap = await this.firebase.db
      .collection(Collections.auditEvents)
      .orderBy('seq')
      .startAfter(afterSeq)
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as LedgerEntry);
  }

  async blocks(afterIndex: number, limit: number): Promise<LedgerBlockRecord[]> {
    const snap = await this.firebase.db
      .collection(Collections.blocks)
      .orderBy('index')
      .startAfter(afterIndex)
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as LedgerBlockRecord);
  }

  async block(index: number): Promise<LedgerBlockRecord> {
    const snap = await this.firebase.db.collection(Collections.blocks).doc(sequenceId(index)).get();
    if (!snap.exists) throw new NotFoundException(`no ledger block ${index}`);
    return snap.data() as LedgerBlockRecord;
  }

  async latestAnchor(): Promise<AnchorRecord> {
    const snap = await this.firebase.db.collection(Collections.anchors).orderBy('index', 'desc').limit(1).get();
    const anchor = snap.docs[0]?.data() as AnchorRecord | undefined;
    if (!anchor) throw new NotFoundException('nothing has been anchored yet');
    return anchor;
  }

  async keys(): Promise<SigningKeyRecord[]> {
    const snap = await this.firebase.db.collection(Collections.signingKeys).orderBy('firstUsedAt').get();
    return snap.docs.map((d) => d.data() as SigningKeyRecord);
  }

  /**
   * A public entry with its inclusion proof. Member-related entries are not public, and an entry is only provable once
   * a block covers it, so both answer 404.
   */
  async publicEntry(seq: number): Promise<PublicLedgerEntry> {
    const db = this.firebase.db;
    const entry = (await db.collection(Collections.auditEvents).doc(sequenceId(seq)).get()).data() as LedgerEntry | undefined;
    if (!entry || !isPublicLedgerEvent(entry.type)) throw new NotFoundException(`no public ledger entry ${seq}`);
    const blockSnap = await db.collection(Collections.blocks).where('lastSeq', '>=', seq).orderBy('lastSeq').limit(1).get();
    const block = blockSnap.docs[0]?.data() as LedgerBlockRecord | undefined;
    if (!block || block.firstSeq > seq) throw new NotFoundException(`ledger entry ${seq} is not in a block yet`);
    const covered = await db
      .collection(Collections.auditEvents)
      .where('seq', '>=', block.firstSeq)
      .where('seq', '<=', block.lastSeq)
      .orderBy('seq')
      .get();
    const hashes = covered.docs.map((d) => (d.data() as LedgerEntry).hash);
    return { entry, block, proof: entryInclusionProof(hashes, block.firstSeq, seq) };
  }

  /**
   * Everything an Auditor can check from inside: every entry hash and link, the head, every block (numbering, links,
   * Merkle roots) and its signature, and every anchor record against its block and, when the bucket is configured,
   * the stored anchor object.
   */
  async verify(): Promise<LedgerVerification> {
    const db = this.firebase.db;
    const [entriesSnap, headSnap, blocksSnap, anchorsSnap, keys] = await Promise.all([
      db.collection(Collections.auditEvents).orderBy('seq').get(),
      this.headRef().get(),
      db.collection(Collections.blocks).orderBy('index').get(),
      db.collection(Collections.anchors).orderBy('index').get(),
      this.keys(),
    ]);
    const entries = entriesSnap.docs.map((d) => d.data() as LedgerEntry);
    const n = entries.length;
    const fail = (part: 'entry' | 'block' | 'anchor', at: number | null, reason: string): LedgerVerification => ({
      ok: false,
      entries: n,
      part,
      at,
      reason,
    });

    const chain = verifyChain(entries);
    if (!chain.ok) return fail('entry', entries[chain.index]?.seq ?? null, chain.reason);
    const misnumbered = entries.findIndex((e, i) => e.seq !== i + 1);
    if (misnumbered >= 0) return fail('entry', entries[misnumbered]!.seq, 'sequence gap');
    const head = headSnap.exists ? (headSnap.data() as LedgerHead) : { seq: 0, hash: GENESIS_HASH };
    if (head.seq !== n || head.hash !== chain.head) return fail('entry', head.seq, 'ledger head does not match the last entry');

    const blocks = blocksSnap.docs.map((d) => d.data() as LedgerBlockRecord);
    const blockCheck = verifyBlocks(blocks, entries.map((e) => e.hash));
    if (!blockCheck.ok) return fail('block', blockCheck.index, blockCheck.reason);
    const pems = new Map(keys.map((k) => [k.keyVersion, k.publicKeyPem]));
    for (const block of blocks) {
      const pem = pems.get(block.signature.keyVersion);
      if (!pem) return fail('block', block.index, 'signed by an unknown key');
      if (!(await verifyEcdsaP256(pem, blockSigningInput(block), block.signature.signature))) {
        return fail('block', block.index, 'signature does not verify');
      }
    }

    const anchors = anchorsSnap.docs.map((d) => d.data() as AnchorRecord);
    for (const [i, anchor] of anchors.entries()) {
      const block = blocks[i];
      if (anchor.index !== i + 1 || !block) return fail('anchor', anchor.index, 'anchor for a block that does not exist');
      if (anchor.blockHash !== block.blockHash) return fail('anchor', anchor.index, 'anchor records a different block hash');
      const problem = await this.checkAnchorObject(anchor, block);
      if (problem) return fail('anchor', anchor.index, problem);
    }
    return {
      ok: true,
      entries: n,
      head: chain.head,
      blocks: blocks.length,
      unblocked: n - blockCheck.lastSeq,
      anchored: anchors.length,
    };
  }

  /** The anchor object must hold exactly this block, hash and signature, at the recorded generation. */
  private async checkAnchorObject(anchor: AnchorRecord, block: LedgerBlockRecord): Promise<string | null> {
    const prefix = `gs://${this.config.anchorsBucket}/`;
    if (!this.config.anchorsBucket || !anchor.uri.startsWith(prefix)) return null; // checked where the bucket is known
    const file = this.firebase.storage.bucket(this.config.anchorsBucket).file(anchor.uri.slice(prefix.length));
    try {
      const [[metadata], [content]] = await Promise.all([file.getMetadata(), file.download()]);
      const expected: AnchorDocument = { v: 1, block: blockBody(block), blockHash: block.blockHash, signature: block.signature };
      if (String(metadata.generation) !== anchor.generation) return 'anchor object was rewritten (generation changed)';
      if (content.toString() !== canonicalize(expected)) return 'anchor object does not match the block';
      return null;
    } catch (e) {
      if ((e as { code?: unknown }).code === 404) return 'anchor object is missing';
      throw e;
    }
  }

  private headRef() {
    return this.firebase.db.collection(Collections.ledgerHead).doc('main');
  }
}
