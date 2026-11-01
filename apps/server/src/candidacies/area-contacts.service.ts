import { Inject, Injectable } from '@nestjs/common';
import {
  addAreaContact,
  areaContactContent,
  areaContactView,
  changeAreaContact,
  emailTemplates,
  inContactArea,
  mergeContacts,
  nextFederalElectionYear,
  PUBLIC_OFFICES,
  removeAreaContact,
  saveEmailTemplate,
  uuidv7,
  type AreaContactInput,
  type AreaContactRecord,
  type AreaContactsView,
  type EmailTemplate,
  type EmailTemplateInput,
  type PublicOffice,
} from 'ustp-domain';
import { accepted } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { AreaContactRepository } from './area-contact.repository.js';
import { CandidaciesService } from './candidacies.service.js';
import { CONTACT_SOURCE, type ContactSource } from './contact-source.js';

/**
 * The Your area page (design §5.12): for a signed-in member, who holds each office in their area and who runs for it,
 * from public records and from what Communications Admins enter, with each kind of office's email. Admins' entries and
 * templates are ledgered in the transaction that saves them.
 */
@Injectable()
export class AreaContactsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly repo: AreaContactRepository,
    private readonly ledger: LedgerService,
    private readonly candidacies: CandidaciesService,
    @Inject(CONTACT_SOURCE) private readonly source: ContactSource,
  ) {}

  /** The caller's area and its people. Admins' candidates are shown until the day after their election. */
  async view(accountId: string): Promise<AreaContactsView> {
    const area = await this.candidacies.area(accountId);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const electionYear = nextFederalElectionYear(today);
    const [found, entered, saved] = await Promise.all([
      this.source.forArea(area.state, area.basis === 'zip' ? area.districts : [], electionYear),
      this.repo.all(),
      this.repo.allTemplates(),
    ]);
    const mine = entered
      .filter((r) => inContactArea(r.district, area) && (r.role === 'holder' || (r.electionDate ?? '') >= yesterday))
      .map(areaContactView);
    return { area, electionYear, contacts: mergeContacts(found.contacts, mine), feeds: found.feeds, templates: emailTemplates(saved) };
  }

  /** Every entry, for Communications Admins: by state (nationwide first), office and name. */
  async list(): Promise<AreaContactRecord[]> {
    const order = (r: AreaContactRecord) => `${r.district.state ?? ''}|${PUBLIC_OFFICES.indexOf(r.office)}|${r.district.name}|${r.name}`;
    return (await this.repo.all()).sort((a, b) => order(a).localeCompare(order(b)));
  }

  async add(actor: string, input: AreaContactInput): Promise<AreaContactRecord> {
    const content = areaContactContent(input, await this.candidacies.lookUpDistrict(input.office, input.state, input.districtId));
    const { record, event } = addAreaContact(content, uuidv7(), actor, new Date().toISOString());
    await this.firebase.db.runTransaction(async (tx) => {
      await this.ledger.record(tx, [event]);
      this.repo.set(tx, record);
    });
    return record;
  }

  async change(actor: string, contactId: string, input: AreaContactInput, basedOn: number): Promise<AreaContactRecord> {
    const content = areaContactContent(input, await this.candidacies.lookUpDistrict(input.office, input.state, input.districtId));
    return this.firebase.db.runTransaction(async (tx) => {
      const { record, event } = accepted(changeAreaContact(await this.repo.get(tx, contactId), content, basedOn, actor, new Date().toISOString()));
      await this.ledger.record(tx, [event]);
      this.repo.set(tx, record);
      return record;
    });
  }

  async remove(actor: string, contactId: string): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const event = accepted(removeAreaContact(await this.repo.get(tx, contactId), actor));
      await this.ledger.record(tx, [event]);
      this.repo.delete(tx, contactId);
    });
  }

  /** Every kind of office's template, saved or the starting text, in the offices' order. */
  async templates(): Promise<EmailTemplate[]> {
    const all = emailTemplates(await this.repo.allTemplates());
    return PUBLIC_OFFICES.map((office) => all[office]);
  }

  async saveTemplate(actor: string, office: PublicOffice, input: EmailTemplateInput): Promise<EmailTemplate> {
    return this.firebase.db.runTransaction(async (tx) => {
      const { record, event } = accepted(saveEmailTemplate(await this.repo.getTemplate(tx, office), office, input, actor, new Date().toISOString()));
      await this.ledger.record(tx, [event]);
      this.repo.setTemplate(tx, record);
      return { office, subject: record.subject, body: record.body, version: record.version };
    });
  }
}
