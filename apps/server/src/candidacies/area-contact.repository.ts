import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { Collections, type AreaContactRecord, type EmailTemplateListRecord } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/**
 * Storage of the Your area page's own data (design §5.12, §11): `area_contacts`, the people Communications Admins
 * enter, and `email_templates/current`, the list of email templates (absent until an admin first changes it). Both stay
 * small, so they are read whole and filtered by the caller.
 */
@Injectable()
export class AreaContactRepository {
  constructor(private readonly firebase: Firebase) {}

  private contacts() {
    return this.firebase.db.collection(Collections.areaContacts);
  }

  private templates() {
    return this.firebase.db.collection(Collections.emailTemplates).doc('current');
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

  /** The saved list, read in `tx` when given; null until it is first saved. */
  async templateList(tx?: Transaction): Promise<EmailTemplateListRecord | null> {
    const ref = this.templates();
    return ((await (tx ? tx.get(ref) : ref.get())).data() as EmailTemplateListRecord | undefined) ?? null;
  }

  setTemplateList(tx: Transaction, record: EmailTemplateListRecord): void {
    tx.set(this.templates(), record);
  }
}
