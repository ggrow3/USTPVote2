import { Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  addPartner,
  recordPartnerConsent,
  removePartner,
  updatePartner,
  uuidv7,
  withdrawPartnerConsent,
  type CreatePartnerInput,
  type LedgerEvent,
  type Outcome,
  type PartnerConsentInput,
  type PartnerRecord,
  type UpdatePartnerInput,
} from 'ustp-domain';
import { accepted } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { EventsRepository } from './events.repository.js';
import { EventsService } from './events.service.js';

/**
 * Partner groups for Communications Admins (design §10.17): the team's list, and which of them have agreed to be
 * named in public. Every change but one to the team's notes alone is ledgered (`partner.changed`).
 */
@Injectable()
export class PartnersService {
  constructor(
    private readonly firebase: Firebase,
    private readonly repo: EventsRepository,
    private readonly ledger: LedgerService,
    private readonly events: EventsService,
  ) {}

  /** Every partner, listed ones first, then by name. */
  async all(): Promise<PartnerRecord[]> {
    const partners = await this.repo.allPartners();
    return partners.sort((a, b) => Number(!a.consent) - Number(!b.consent) || a.name.localeCompare(b.name, 'en'));
  }

  async detail(partnerId: string): Promise<PartnerRecord> {
    const partner = await this.repo.findPartner(partnerId);
    if (!partner) throw new NotFoundException('no such partner');
    return partner;
  }

  async add(actor: string, input: CreatePartnerInput): Promise<PartnerRecord> {
    const { partner, event } = addPartner(input, uuidv7(), actor, new Date().toISOString());
    await this.firebase.db.runTransaction(async (tx) => {
      await this.ledger.record(tx, [event]);
      this.repo.setPartner(tx, partner);
    });
    this.events.forget();
    return partner;
  }

  async update(actor: string, partnerId: string, input: UpdatePartnerInput): Promise<PartnerRecord> {
    const { basedOn, ...content } = input;
    return this.change(partnerId, (partner) => updatePartner(partner, content, basedOn, actor, new Date().toISOString()));
  }

  async recordConsent(actor: string, partnerId: string, input: PartnerConsentInput): Promise<PartnerRecord> {
    const { basedOn, ...consent } = input;
    return this.change(partnerId, (partner) => recordPartnerConsent(partner, consent, basedOn, actor, new Date().toISOString()));
  }

  async withdrawConsent(actor: string, partnerId: string, basedOn: number): Promise<PartnerRecord> {
    return this.change(partnerId, (partner) => withdrawPartnerConsent(partner, basedOn, actor, new Date().toISOString()));
  }

  /** Takes a group off the list; the events it co-hosted keep its ID, which then names no one. */
  async remove(actor: string, partnerId: string): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const event = accepted(removePartner(await this.repo.getPartner(tx, partnerId), actor));
      await this.ledger.record(tx, [event]);
      this.repo.deletePartner(tx, partnerId);
    });
    this.events.forget();
  }

  private async change(
    partnerId: string,
    act: (partner: PartnerRecord | null, tx: Transaction) => Outcome<{ partner: PartnerRecord; event: LedgerEvent | null }>,
  ): Promise<PartnerRecord> {
    const saved = await this.firebase.db.runTransaction(async (tx) => {
      const { partner, event } = accepted(act(await this.repo.getPartner(tx, partnerId), tx));
      if (event) await this.ledger.record(tx, [event]);
      this.repo.setPartner(tx, partner);
      return partner;
    });
    this.events.forget();
    return saved;
  }
}
