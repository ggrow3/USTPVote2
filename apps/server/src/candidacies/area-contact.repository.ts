import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { Collections, type AreaContactRecord, type EmailTemplateRecord, type PublicOffice } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/**
 * Storage of the Your area page's own data (design §5.12, §11): `area_contacts`, the people Communications Admins
 * enter, and `email_templates`, one per kind of office. Both stay small, so they are read whole and filtered by the
 * caller.
 */
@Injectable()
export class AreaContactRepository {
  constructor(private readonly firebase: Firebase) {}

  private contacts() {
    return this.firebase.db.collection(Collections.areaContacts);
  }

  private templates() {
    return this.firebase.db.collection(Collections.emailTemplates);
  }

  async all(): Promise<AreaContactRecord[]> {
    return (await this.contacts().get()).docs.map((d) => d.data() as AreaContactRecord);
  }

  async get(tx: Transaction, contactId: string): Promise<AreaContactRecord | null> {
    return ((await tx.get(this.contacts().doc(contactId))).data() as AreaContactRecord | undefined) ?? null;
  }

  set(tx: Transaction, record: AreaContactRecord): void {
    tx.set(this.contacts().doc(record.contactId), record);
  }

  delete(tx: Transaction, contactId: string): void {
    tx.delete(this.contacts().doc(contactId));
  }

  async allTemplates(): Promise<EmailTemplateRecord[]> {
    return (await this.templates().get()).docs.map((d) => d.data() as EmailTemplateRecord);
  }

  async getTemplate(tx: Transaction, office: PublicOffice): Promise<EmailTemplateRecord | null> {
    return ((await tx.get(this.templates().doc(office))).data() as EmailTemplateRecord | undefined) ?? null;
  }

  setTemplate(tx: Transaction, record: EmailTemplateRecord): void {
    tx.set(this.templates().doc(record.office), record);
  }
}
