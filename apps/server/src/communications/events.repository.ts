import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { Collections, type EventRecord, type PartnerRecord } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/**
 * Storage of events and partners (design §10.17, §11), part of the communications context: only it reads and writes
 * these collections. Queries are on one field each, so they need no composite index; results are sorted by the caller.
 */
@Injectable()
export class EventsRepository {
  constructor(private readonly firebase: Firebase) {}

  private get events() {
    return this.firebase.db.collection(Collections.events);
  }

  private get partners() {
    return this.firebase.db.collection(Collections.partners);
  }

  // --- Events ------------------------------------------------------------------------------------------------------

  async allEvents(): Promise<EventRecord[]> {
    return (await this.events.get()).docs.map((d) => d.data() as EventRecord);
  }

  /** Published and cancelled events: everything the public may reach. */
  async publicEvents(): Promise<EventRecord[]> {
    const snap = await this.events.where('status', 'in', ['published', 'cancelled']).get();
    return snap.docs.map((d) => d.data() as EventRecord);
  }

  async eventBySlug(slug: string, tx?: Transaction): Promise<EventRecord | null> {
    const query = this.events.where('slug', '==', slug).limit(1);
    const snap = tx ? await tx.get(query) : await query.get();
    return (snap.docs[0]?.data() as EventRecord | undefined) ?? null;
  }

  async getEvent(tx: Transaction, eventId: string): Promise<EventRecord | null> {
    return ((await tx.get(this.events.doc(eventId))).data() as EventRecord | undefined) ?? null;
  }

  async findEvent(eventId: string): Promise<EventRecord | null> {
    return ((await this.events.doc(eventId).get()).data() as EventRecord | undefined) ?? null;
  }

  setEvent(tx: Transaction, event: EventRecord): void {
    tx.set(this.events.doc(event.eventId), event);
  }

  deleteEvent(tx: Transaction, eventId: string): void {
    tx.delete(this.events.doc(eventId));
  }

  // --- Partners ----------------------------------------------------------------------------------------------------

  async allPartners(tx?: Transaction): Promise<PartnerRecord[]> {
    const snap = tx ? await tx.get(this.partners) : await this.partners.get();
    return snap.docs.map((d) => d.data() as PartnerRecord);
  }

  /** The partners of `ids` that exist. */
  async partnersById(ids: readonly string[], tx?: Transaction): Promise<Map<string, PartnerRecord>> {
    if (!ids.length) return new Map();
    const refs = ids.map((id) => this.partners.doc(id));
    const snaps = tx ? await tx.getAll(...refs) : await this.firebase.db.getAll(...refs);
    return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, s.data() as PartnerRecord]));
  }

  async getPartner(tx: Transaction, partnerId: string): Promise<PartnerRecord | null> {
    return ((await tx.get(this.partners.doc(partnerId))).data() as PartnerRecord | undefined) ?? null;
  }

  async findPartner(partnerId: string): Promise<PartnerRecord | null> {
    return ((await this.partners.doc(partnerId).get()).data() as PartnerRecord | undefined) ?? null;
  }

  setPartner(tx: Transaction, partner: PartnerRecord): void {
    tx.set(this.partners.doc(partner.partnerId), partner);
  }

  deletePartner(tx: Transaction, partnerId: string): void {
    tx.delete(this.partners.doc(partnerId));
  }
}
