import { Inject, Injectable } from '@nestjs/common';
import {
  addAreaContact,
  addEmailTemplate,
  areaContactContent,
  areaContactView,
  changeAreaContact,
  changeEmailTemplate,
  emailTemplateList,
  inContactArea,
  mergeContacts,
  nextFederalElectionYear,
  PUBLIC_OFFICES,
  removeAreaContact,
  removeEmailTemplate,
  uuidv7,
  type AreaCandidatesView,
  type AreaContactInput,
  type AreaContactRecord,
  type AreaContactsView,
  type CandidateArea,
  type EmailTemplate,
  type EmailTemplateInput,
  type EmailTemplateListRecord,
  type LedgerEvent,
  type Outcome,
} from 'ustp-domain';
import { accepted } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { AreaContactRepository } from './area-contact.repository.js';
import { CandidaciesService } from './candidacies.service.js';
import { CONTACT_SOURCE, type ContactSource } from './contact-source.js';
import { PROFILE_SOURCE, type ProfileSource } from './profile-source.js';

/** Today's next federal general election, whose candidates the FEC's lists are for. */
const electionYearNow = () => nextFederalElectionYear(new Date().toISOString().slice(0, 10));

/**
 * The Your area page (design §5.12): for a signed-in member, who holds each office in their area and who runs for it,
 * from public records and from what Communications Admins enter, with the email templates Membership Admins and
 * Communications Admins keep. Admins' entries and templates are ledgered in the transaction that saves them. Also the
 * Candidates page's people running in an area, from public records only: the member's own area, or a ZIP code anyone types.
 */
@Injectable()
export class AreaContactsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly repo: AreaContactRepository,
    private readonly ledger: LedgerService,
    private readonly candidacies: CandidaciesService,
    @Inject(CONTACT_SOURCE) private readonly source: ContactSource,
    @Inject(PROFILE_SOURCE) private readonly profiles: ProfileSource,
  ) {}

  /** The caller's area and its people. Admins' candidates are shown until the day after their election. */
  async view(accountId: string): Promise<AreaContactsView> {
    const { area, zip } = await this.candidacies.placed(accountId);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const electionYear = electionYearNow();
    const [found, entered, saved] = await Promise.all([
      this.source.forArea(area.state, area.basis === 'zip' ? area.districts : [], electionYear, { zip, holders: true }),
      this.repo.all(),
      this.repo.templateList(),
    ]);
    const profiled = await this.profiles.withProfiles(found.contacts);
    const mine = entered
      .filter((r) => inContactArea(r.district, area) && (r.role === 'holder' || (r.electionDate ?? '') >= yesterday))
      .map(areaContactView);
    return {
      area,
      electionYear,
      contacts: mergeContacts(profiled.people, mine),
      ballot: found.ballot,
      feeds: found.feeds,
      profiles: profiled.state,
      templates: emailTemplateList(saved),
    };
  }

  /** The Candidates page's people running in the caller's own area, from public records. */
  async myCandidates(accountId: string): Promise<AreaCandidatesView> {
    const { area, zip } = await this.candidacies.placed(accountId);
    return this.candidates(area, zip);
  }

  /** The Candidates page's people running where a ZIP code is, for anyone; the ZIP code is not kept. */
  async zipCandidates(zip: string): Promise<AreaCandidatesView> {
    return this.candidates(await this.candidacies.zipArea(zip), zip);
  }

  private async candidates(area: CandidateArea, zip: string | null): Promise<AreaCandidatesView> {
    const electionYear = electionYearNow();
    const found = await this.source.forArea(area.state, area.basis === 'zip' ? area.districts : [], electionYear, { zip, holders: false });
    const profiled = await this.profiles.withProfiles(found.contacts.filter((c) => c.role === 'candidate'));
    return { area, electionYear, candidates: profiled.people, ballot: found.ballot, feeds: found.feeds, profiles: profiled.state };
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

  /** The email templates, saved or the starting ones, in the order the Write dialog offers them. */
  async templates(): Promise<readonly EmailTemplate[]> {
    return emailTemplateList(await this.repo.templateList());
  }

  addTemplate(actor: string, input: EmailTemplateInput): Promise<EmailTemplate> {
    const templateId = uuidv7();
    return this.saveTemplates((list, at) => addEmailTemplate(list, input, templateId, actor, at));
  }

  changeTemplate(actor: string, templateId: string, input: EmailTemplateInput, basedOn: number): Promise<EmailTemplate> {
    return this.saveTemplates((list, at) => changeEmailTemplate(list, templateId, input, basedOn, actor, at));
  }

  async removeTemplate(actor: string, templateId: string): Promise<void> {
    await this.saveTemplates((list, at) => removeEmailTemplate(list, templateId, actor, at));
  }

  /** Reads the list, applies one change to it in a transaction with its ledger entry, and returns the template. */
  private saveTemplates(
    apply: (list: readonly EmailTemplate[], at: string) => Outcome<{ record: EmailTemplateListRecord; template: EmailTemplate; event: LedgerEvent }>,
  ): Promise<EmailTemplate> {
    return this.firebase.db.runTransaction(async (tx) => {
      const { record, template, event } = accepted(apply(emailTemplateList(await this.repo.templateList(tx)), new Date().toISOString()));
      await this.ledger.record(tx, [event]);
      this.repo.setTemplateList(tx, record);
      return template;
    });
  }
}
