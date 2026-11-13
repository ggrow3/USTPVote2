import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  Collections,
  DEFAULT_BILL_SETTINGS,
  type BillNoteRecord,
  type BillSettingsRecord,
  type BillWatchRecord,
  type PublicBillRecord,
  type PublicBillSnapshot,
  type RollCallRecord,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/**
 * Storage of the Bills tool (design §5.14, §11): its setting, the shared watchlist and its notes, the bills shown on the
 * public Legislation page and their roll calls. Only the bills context uses it. Queries are on one field each, so they need no composite index; results are sorted by the caller.
 */
@Injectable()
export class BillRepository {
  constructor(private readonly firebase: Firebase) {}

  private settingsRef() {
    return this.firebase.db.collection(Collections.billSettings).doc('current');
  }

  private watchlist() {
    return this.firebase.db.collection(Collections.billWatch);
  }

  private notes() {
    return this.firebase.db.collection(Collections.billNotes);
  }

  private publicBills() {
    return this.firebase.db.collection(Collections.billPublic);
  }

  private rollCalls() {
    return this.firebase.db.collection(Collections.billRollCalls);
  }

  async settings(): Promise<BillSettingsRecord> {
    return ((await this.settingsRef().get()).data() as BillSettingsRecord | undefined) ?? DEFAULT_BILL_SETTINGS;
  }

  async getSettings(tx: Transaction): Promise<BillSettingsRecord> {
    return ((await tx.get(this.settingsRef())).data() as BillSettingsRecord | undefined) ?? DEFAULT_BILL_SETTINGS;
  }

  setSettings(tx: Transaction, settings: BillSettingsRecord): void {
    tx.set(this.settingsRef(), settings);
  }

  async allWatched(): Promise<BillWatchRecord[]> {
    return (await this.watchlist().get()).docs.map((d) => d.data() as BillWatchRecord);
  }

  async findWatched(billId: string): Promise<BillWatchRecord | null> {
    return ((await this.watchlist().doc(billId).get()).data() as BillWatchRecord | undefined) ?? null;
  }

  async getWatched(tx: Transaction, billId: string): Promise<BillWatchRecord | null> {
    return ((await tx.get(this.watchlist().doc(billId))).data() as BillWatchRecord | undefined) ?? null;
  }

  async countWatched(tx: Transaction): Promise<number> {
    return (await tx.get(this.watchlist().count())).data().count;
  }

  setWatched(tx: Transaction, record: BillWatchRecord): void {
    tx.set(this.watchlist().doc(record.billId), record);
  }

  /**
   * What Congress.gov said when the entry was last read, written over the entry's own fields only, so tags saved at the
   * same moment are kept. False when the entry is gone (removed meanwhile).
   */
  async refreshWatched(billId: string, fields: Pick<BillWatchRecord, 'title' | 'sponsor' | 'status' | 'latestAction' | 'checkedAt'>): Promise<boolean> {
    try {
      await this.watchlist().doc(billId).update({ ...fields });
      return true;
    } catch (e) {
      if ((e as { code?: number }).code === 5) return false;
      throw e;
    }
  }

  /** Removes a bill from the watchlist with every note on it, read in `tx`. */
  async deleteWatched(tx: Transaction, billId: string): Promise<number> {
    const notes = await tx.get(this.notes().where('billId', '==', billId));
    for (const n of notes.docs) tx.delete(n.ref);
    tx.delete(this.watchlist().doc(billId));
    return notes.size;
  }

  async notesOn(billId: string): Promise<BillNoteRecord[]> {
    return (await this.notes().where('billId', '==', billId).get()).docs.map((d) => d.data() as BillNoteRecord);
  }

  /** How many notes each watched bill has. */
  async noteCounts(): Promise<Map<string, number>> {
    const snap = await this.notes().select('billId').get();
    const counts = new Map<string, number>();
    for (const d of snap.docs) {
      const id = d.get('billId') as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  async getNote(tx: Transaction, noteId: string): Promise<BillNoteRecord | null> {
    return ((await tx.get(this.notes().doc(noteId))).data() as BillNoteRecord | undefined) ?? null;
  }

  setNote(tx: Transaction, note: BillNoteRecord): void {
    tx.set(this.notes().doc(note.noteId), note);
  }

  deleteNote(tx: Transaction, noteId: string): void {
    tx.delete(this.notes().doc(noteId));
  }

  // --- The public Legislation page and scorecard ------------------------------------------------------------------

  async allPublic(): Promise<PublicBillRecord[]> {
    return (await this.publicBills().get()).docs.map((d) => d.data() as PublicBillRecord);
  }

  /** The IDs of the bills shown publicly, without reading the rest of them. */
  async publicIds(): Promise<Set<string>> {
    return new Set((await this.publicBills().select().get()).docs.map((d) => d.id));
  }

  async findPublic(billId: string): Promise<PublicBillRecord | null> {
    return ((await this.publicBills().doc(billId).get()).data() as PublicBillRecord | undefined) ?? null;
  }

  async getPublic(tx: Transaction, billId: string): Promise<PublicBillRecord | null> {
    return ((await tx.get(this.publicBills().doc(billId))).data() as PublicBillRecord | undefined) ?? null;
  }

  async allPublicIn(tx: Transaction): Promise<PublicBillRecord[]> {
    return (await tx.get(this.publicBills())).docs.map((d) => d.data() as PublicBillRecord);
  }

  setPublic(tx: Transaction, record: PublicBillRecord): void {
    tx.set(this.publicBills().doc(record.billId), record);
  }

  deletePublic(tx: Transaction, billId: string): void {
    tx.delete(this.publicBills().doc(billId));
  }

  /** Public bills due a read from Congress.gov, the most overdue first. */
  async publicDue(now: string, limit: number): Promise<PublicBillRecord[]> {
    return (await this.publicBills().where('nextCheckAt', '<=', now).orderBy('nextCheckAt').limit(limit).get()).docs.map((d) => d.data() as PublicBillRecord);
  }

  /**
   * What Congress.gov says of a public bill now, written over those fields only, so the team's topic, summary and
   * positions saved at the same moment are kept. False when it is no longer public.
   */
  async refreshPublic(billId: string, fields: PublicBillSnapshot & Pick<PublicBillRecord, 'nextCheckAt' | 'refreshFailedAt'>): Promise<boolean> {
    return this.updateIfThere(billId, { ...fields });
  }

  /** A failed read: when to try again. False when it is no longer public. */
  async publicReadFailed(billId: string, fields: Pick<PublicBillRecord, 'nextCheckAt' | 'refreshFailedAt'>): Promise<boolean> {
    return this.updateIfThere(billId, { ...fields });
  }

  private async updateIfThere(billId: string, fields: Record<string, unknown>): Promise<boolean> {
    try {
      await this.publicBills().doc(billId).update(fields);
      return true;
    } catch (e) {
      if ((e as { code?: number }).code === 5) return false;
      throw e;
    }
  }

  /** The roll calls kept of these, read at once. */
  async rollCallsFor(voteIds: readonly string[]): Promise<RollCallRecord[]> {
    if (!voteIds.length) return [];
    const snaps = await this.firebase.db.getAll(...voteIds.map((id) => this.rollCalls().doc(id)));
    return snaps.filter((s) => s.exists).map((s) => s.data() as RollCallRecord);
  }

  /** Which of these roll calls are kept already. */
  async rollCallsKept(voteIds: readonly string[]): Promise<Set<string>> {
    if (!voteIds.length) return new Set();
    const snaps = await this.firebase.db.getAll(...voteIds.map((id) => this.rollCalls().doc(id)), { fieldMask: ['voteId'] });
    return new Set(snaps.filter((s) => s.exists).map((s) => s.id));
  }

  async setRollCall(record: RollCallRecord): Promise<void> {
    await this.rollCalls().doc(record.voteId).set(record);
  }

  deleteRollCall(tx: Transaction, voteId: string): void {
    tx.delete(this.rollCalls().doc(voteId));
  }
}
