import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DocumentReference } from 'firebase-admin/firestore';
import {
  blockBody,
  blockHash,
  blockSigningInput,
  buildBlock,
  canonicalize,
  GENESIS_HASH,
  verifyChain,
} from 'ustp-audit';
import {
  Collections,
  rollSigningInput,
  sequenceId,
  signingKeyId,
  type AnchorDocument,
  type AnchorRecord,
  type LedgerBlockRecord,
  type LedgerEntry,
  type RollSnapshotRecord,
  type SigningKeyRecord,
} from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { AUDIT_SIGNER, type AuditSigner } from '../infra/audit-signer.js';
import { Firebase } from '../infra/firebase.js';

/** Bounds per tick, so a backlog is worked off over several ticks instead of one long request. */
const MAX_ENTRIES_PER_BLOCK = 500;
const MAX_BLOCKS_PER_TICK = 20;

/**
 * The worker's half of the ledger (design §8.3, §8.4): seals new entries into signed blocks, signs approved rolls and
 * anchors blocks outside Firestore. Every step is idempotent: documents and anchor objects are created once, so
 * overlapping ticks cannot produce two different blocks with the same index.
 */
@Injectable()
export class LedgerSealer {
  private readonly logger = new Logger(LedgerSealer.name);
  private warnedNoBucket = false;

  constructor(
    private readonly firebase: Firebase,
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(AUDIT_SIGNER) private readonly signer: AuditSigner,
  ) {}

  /** Blocks every entry recorded since the last block, at most MAX_ENTRIES_PER_BLOCK per block. */
  async sealBlocks(): Promise<LedgerBlockRecord[]> {
    const sealed: LedgerBlockRecord[] = [];
    for (let i = 0; i < MAX_BLOCKS_PER_TICK; i++) {
      const block = await this.sealNext();
      if (!block) break;
      sealed.push(block);
    }
    return sealed;
  }

  /** Signs rolls an Auditor approved (including any superseded before the worker got to them). */
  async signRolls(): Promise<number> {
    const snapshots = this.firebase.db.collection(Collections.eligibilitySnapshots);
    const unsigned = await Promise.all(
      (['approved', 'superseded'] as const).map((status) =>
        snapshots.where('status', '==', status).where('signature', '==', null).get(),
      ),
    );
    let signed = 0;
    for (const doc of unsigned.flatMap((s) => s.docs)) {
      const signature = await this.signer.sign(rollSigningInput(doc.data() as RollSnapshotRecord));
      await this.recordKey();
      const applied = await this.firebase.db.runTransaction(async (tx) => {
        const current = (await tx.get(doc.ref)).data() as RollSnapshotRecord | undefined;
        if (!current || current.signature) return false; // its election was deleted, or a concurrent tick signed it first
        tx.update(doc.ref, { signature });
        return true;
      });
      if (applied) signed++;
    }
    return signed;
  }

  /** Writes each block not yet anchored to the anchors bucket, in order, and records where it went. */
  async anchorBlocks(): Promise<number> {
    if (!this.config.anchorsBucket) {
      if (!this.warnedNoBucket) this.logger.warn('ANCHORS_BUCKET is not set: ledger blocks are not being anchored');
      this.warnedNoBucket = true;
      return 0;
    }
    const db = this.firebase.db;
    const last = (await db.collection(Collections.anchors).orderBy('index', 'desc').limit(1).get()).docs[0]?.data() as
      | AnchorRecord
      | undefined;
    const pending = await db
      .collection(Collections.blocks)
      .where('index', '>', last?.index ?? 0)
      .orderBy('index')
      .limit(MAX_BLOCKS_PER_TICK)
      .get();
    let anchored = 0;
    for (const doc of pending.docs) {
      const block = doc.data() as LedgerBlockRecord;
      const document: AnchorDocument = { v: 1, block: blockBody(block), blockHash: block.blockHash, signature: block.signature };
      const path = `v1/blocks/${sequenceId(block.index)}.json`;
      const generation = await this.writeOnce(path, canonicalize(document), 'application/json');
      const anchor: AnchorRecord = {
        index: block.index,
        blockHash: block.blockHash,
        uri: `gs://${this.config.anchorsBucket}/${path}`,
        generation,
        anchoredAt: new Date().toISOString(),
      };
      if (await createOnce(db.collection(Collections.anchors).doc(sequenceId(block.index)), anchor)) anchored++;
    }
    return anchored;
  }

  private async sealNext(): Promise<LedgerBlockRecord | null> {
    const db = this.firebase.db;
    const [lastSnap, headSnap] = await Promise.all([
      db.collection(Collections.blocks).orderBy('index', 'desc').limit(1).get(),
      db.collection(Collections.ledgerHead).doc('main').get(),
    ]);
    const last = lastSnap.docs[0]?.data() as LedgerBlockRecord | undefined;
    const headSeq = (headSnap.data() as { seq: number } | undefined)?.seq ?? 0;
    const firstSeq = (last?.lastSeq ?? 0) + 1;
    if (headSeq < firstSeq) return null;
    const lastSeq = Math.min(headSeq, firstSeq + MAX_ENTRIES_PER_BLOCK - 1);

    const entries = (
      await db.collection(Collections.auditEvents).where('seq', '>=', firstSeq).where('seq', '<=', lastSeq).orderBy('seq').get()
    ).docs.map((d) => d.data() as LedgerEntry);
    // Never sign a broken chain: the entries must be numbered without gaps and link onto the previous block.
    if (entries.length !== lastSeq - firstSeq + 1 || entries.some((e, i) => e.seq !== firstSeq + i)) {
      throw new Error(`ledger entries ${firstSeq}..${lastSeq} are not contiguous; not sealing`);
    }
    const chain = verifyChain(entries, last?.headEntryHash ?? GENESIS_HASH);
    if (!chain.ok) throw new Error(`ledger entry ${entries[chain.index]!.seq} does not verify (${chain.reason}); not sealing`);

    const block = buildBlock({
      index: (last?.index ?? 0) + 1,
      prevBlockHash: last?.blockHash ?? GENESIS_HASH,
      firstSeq,
      entryHashes: entries.map((e) => e.hash),
      createdAt: new Date().toISOString(),
    });
    const signature = await this.signer.sign(blockSigningInput(block));
    await this.recordKey();
    const record: LedgerBlockRecord = { ...block, blockHash: blockHash(block), signature };
    // A concurrent tick that sealed this index first wins; it covered the same entries.
    return (await createOnce(db.collection(Collections.blocks).doc(sequenceId(block.index)), record)) ? record : null;
  }

  /**
   * Publishes the signing key's public half (Firestore for the api, the anchors bucket for everyone) on first use. Call
   * it after anything the key signs (blocks, rolls, results), so every signature can be checked.
   */
  async recordKey(): Promise<void> {
    const { keyVersion, publicKeyPem } = await this.signer.currentKey();
    const keyId = signingKeyId(keyVersion);
    const ref = this.firebase.db.collection(Collections.signingKeys).doc(keyId);
    if ((await ref.get()).exists) return;
    if (this.config.anchorsBucket) await this.writeOnce(`v1/keys/${keyId}.pem`, publicKeyPem, 'application/x-pem-file');
    const record: SigningKeyRecord = { keyId, keyVersion, publicKeyPem, firstUsedAt: new Date().toISOString() };
    await createOnce(ref, record);
  }

  /**
   * Creates an object that must never change. If it already exists (an earlier attempt, or a concurrent tick) it must
   * hold exactly this content. Returns the object generation.
   */
  private async writeOnce(path: string, content: string, contentType: string): Promise<string> {
    const file = this.firebase.storage.bucket(this.config.anchorsBucket!).file(path);
    try {
      await file.save(content, { contentType, resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
    } catch (e) {
      if ((e as { code?: unknown }).code !== 412) throw e;
      const [existing] = await file.download();
      if (existing.toString() !== content) throw new Error(`anchor object ${path} already exists with different content`);
    }
    const [metadata] = await file.getMetadata();
    return String(metadata.generation);
  }
}

/** Creates a document; false if it already exists. */
async function createOnce(ref: DocumentReference, data: object): Promise<boolean> {
  try {
    await ref.create(data);
    return true;
  } catch (e) {
    if ((e as { code?: unknown }).code === 6) return false; // ALREADY_EXISTS
    throw e;
  }
}
