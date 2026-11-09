import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { Collections, DEFAULT_BILL_SETTINGS, type BillNoteRecord, type BillSettingsRecord, type BillWatchRecord } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/**
 * Storage of the Bills tool (design §5.14, §11): its setting, the shared watchlist and its notes. Only the bills context
 * uses it. Queries are on one field each, so they need no composite index; results are sorted by the caller.
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
}
