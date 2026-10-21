import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { GENESIS_HASH, linkRecord, verifyChain } from 'ustp-audit';
import { Collections, sequenceId, type LedgerEntry, type LedgerEventType } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

export interface LedgerEvent {
  readonly type: LedgerEventType;
  readonly actor: string;
  readonly subject: string | null;
  /** Plain JSON only (it is JCS-hashed); no Firestore types or Dates. */
  readonly payload: Readonly<Record<string, unknown>>;
}

interface LedgerHead {
  readonly seq: number;
  readonly hash: string;
}

export type LedgerVerification =
  | { readonly ok: true; readonly entries: number; readonly head: string }
  | { readonly ok: false; readonly entries: number; readonly seq: number | null; readonly reason: string };

/** The append-only, hash-chained audit ledger (design §8.2). Blocks and anchors are built on top of it in M2. */
@Injectable()
export class LedgerService {
  constructor(private readonly firebase: Firebase) {}

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

  /** Recomputes every entry hash and link, and checks the head points at the last entry. */
  async verify(): Promise<LedgerVerification> {
    const [entriesSnap, headSnap] = await Promise.all([
      this.firebase.db.collection(Collections.auditEvents).orderBy('seq').get(),
      this.headRef().get(),
    ]);
    const entries = entriesSnap.docs.map((d) => d.data() as LedgerEntry);
    const chain = verifyChain(entries);
    if (!chain.ok) {
      return { ok: false, entries: entries.length, seq: entries[chain.index]?.seq ?? null, reason: chain.reason };
    }
    const misnumbered = entries.findIndex((e, i) => e.seq !== i + 1);
    if (misnumbered >= 0) {
      return { ok: false, entries: entries.length, seq: entries[misnumbered]!.seq, reason: 'sequence gap' };
    }
    const head = headSnap.exists ? (headSnap.data() as LedgerHead) : { seq: 0, hash: GENESIS_HASH };
    if (head.seq !== entries.length || head.hash !== chain.head) {
      return { ok: false, entries: entries.length, seq: head.seq, reason: 'ledger head does not match the last entry' };
    }
    return { ok: true, entries: entries.length, head: chain.head };
  }

  private headRef() {
    return this.firebase.db.collection(Collections.ledgerHead).doc('main');
  }
}
