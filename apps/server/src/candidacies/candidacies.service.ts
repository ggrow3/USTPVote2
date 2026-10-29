import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  adminCandidacy,
  candidacyContent,
  changeCandidacy,
  compareAdminCandidacies,
  comparePublicCandidacies,
  decideCandidacy,
  declareCandidacy,
  districtLookupId,
  myCandidacy,
  OFFICE_DISTRICTS,
  publicCandidacy,
  removeCandidacy,
  uuidv7,
  withdrawCandidacy,
  type AdminCandidacy,
  type CandidacyContent,
  type CandidacyDecisionInput,
  type CandidacyInput,
  type CandidacyRecord,
  type District,
  type DistrictBoundary,
  type DistrictKind,
  type LedgerEvent,
  type MapsConfig,
  type MemberRecord,
  type MyCandidacy,
  type PublicCandidacy,
} from 'ustp-domain';
import type { Transaction } from 'firebase-admin/firestore';
import { CONFIG, type ServerConfig } from '../config.js';
import { accepted } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { CandidacyRepository } from './candidacy.repository.js';
import { DISTRICT_SOURCE, type DistrictSource } from './district-source.js';

/**
 * Candidacies for public office (design §5.8). Active members declare, change and withdraw theirs through
 * `/v1/candidacies`; Membership Admins approve or decline what is waiting, and take candidacies down, through
 * `/v1/admin/candidacies`; everyone reads the approved ones, and the districts and outlines the map needs, through
 * `/v1/public`. Decisions, withdrawals of a public candidacy and removals are ledgered in the transaction that makes them.
 */
@Injectable()
export class CandidaciesService {
  constructor(
    private readonly firebase: Firebase,
    private readonly candidacies: CandidacyRepository,
    private readonly ledger: LedgerService,
    private readonly members: MemberDirectory,
    @Inject(DISTRICT_SOURCE) private readonly districts: DistrictSource,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** The Candidates page: every approved candidacy of a member who is still Active, upcoming elections first. */
  async publicList(): Promise<PublicCandidacy[]> {
    const records = await this.candidacies.published();
    const people = await this.people(records);
    const today = new Date().toISOString().slice(0, 10);
    return records
      .map((r) => publicCandidacy(r, people.get(r.accountId) ?? null))
      .filter((c): c is PublicCandidacy => c !== null)
      .sort(comparePublicCandidacies(today));
  }

  async publicDetail(candidacyId: string): Promise<PublicCandidacy> {
    const record = await this.candidacies.find(candidacyId);
    const shown = record && publicCandidacy(record, await this.members.find(record.accountId));
    if (!shown) throw new NotFoundException('no such candidacy');
    return shown;
  }

  /** The caller's own candidacies, newest first, with where each stands. */
  async mine(accountId: string): Promise<MyCandidacy[]> {
    return (await this.candidacies.of(accountId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(myCandidacy);
  }

  /** A new declaration, waiting for a Membership Admin. */
  async declare(accountId: string, input: CandidacyInput): Promise<MyCandidacy> {
    await this.assertActive(accountId);
    const content = candidacyContent(input, await this.district(input));
    const candidacyId = uuidv7();
    const record = await this.firebase.db.runTransaction(async (tx) => {
      const mine = await this.candidacies.of(accountId, tx);
      const created = accepted(declareCandidacy(content, mine, { candidacyId, accountId }, new Date().toISOString()));
      this.candidacies.create(tx, created);
      return created;
    });
    return myCandidacy(record);
  }

  /** The member's change; it waits for review while the approved version stays up. */
  async change(accountId: string, candidacyId: string, input: CandidacyInput, basedOn: number): Promise<MyCandidacy> {
    await this.assertActive(accountId);
    const content = candidacyContent(input, await this.district(input));
    return this.update(candidacyId, async (_tx, current) => ({
      record: accepted(changeCandidacy(current, content, basedOn, accountId, new Date().toISOString())),
      events: [],
    }));
  }

  /** The member withdraws; whatever their status, a candidacy can always be taken back. */
  async withdraw(accountId: string, candidacyId: string): Promise<MyCandidacy> {
    return this.update(candidacyId, async (_tx, current) => {
      const { record, event } = accepted(withdrawCandidacy(current, accountId, new Date().toISOString()));
      return { record, events: event ? [event] : [] };
    });
  }

  /** Every candidacy, for Membership Admins: what waits for review first. */
  async adminList(): Promise<AdminCandidacy[]> {
    const records = await this.candidacies.all();
    const people = await this.people(records);
    return records.map((r) => adminCandidacy(r, people.get(r.accountId) ?? null)).sort(compareAdminCandidacies);
  }

  /** Approves what is waiting, which the Candidates page then shows, or declines it with a note to the member. */
  async decide(actor: string, candidacyId: string, input: CandidacyDecisionInput): Promise<AdminCandidacy> {
    const record = await this.update(candidacyId, async (tx, current) => {
      if (input.decision === 'approve' && current) {
        const [member] = await this.members.getAll(tx, [current.accountId]);
        if (member?.status !== 'active') throw new ConflictException('the member is no longer Active, so the candidacy cannot be shown');
      }
      const { record, event } = accepted(decideCandidacy(current, input, actor, new Date().toISOString()));
      return { record, events: [event] };
    });
    return adminCandidacy(record, await this.members.find(record.accountId));
  }

  /** Takes a candidacy down, with the reason the member is shown. */
  async remove(actor: string, candidacyId: string, reason: string): Promise<AdminCandidacy> {
    const record = await this.update(candidacyId, async (_tx, current) => {
      const { record, event } = accepted(removeCandidacy(current, reason, actor, new Date().toISOString()));
      return { record, events: [event] };
    });
    return adminCandidacy(record, await this.members.find(record.accountId));
  }

  /** The districts of a kind in a state, for the declaration form. */
  districtList(kind: DistrictKind, state: string | null): Promise<District[]> {
    return this.districts.list(kind, state);
  }

  async boundary(kind: DistrictKind, geoid: string): Promise<DistrictBoundary> {
    const boundary = await this.districts.boundary(kind, geoid);
    if (!boundary) throw new NotFoundException('no outline for that district');
    return boundary;
  }

  maps(): MapsConfig {
    return { googleMapsKey: this.config.googleMapsKey };
  }

  /** Reads the candidacy, applies the change in one transaction with its ledger entries, and returns the result. */
  private async update(
    candidacyId: string,
    apply: (tx: Transaction, current: CandidacyRecord | null) => Promise<{ record: CandidacyRecord; events: LedgerEvent[] }>,
  ): Promise<MyCandidacy> {
    const record = await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.candidacies.get(tx, candidacyId);
      const { record, events } = await apply(tx, current);
      if (events.length) await this.ledger.record(tx, events);
      this.candidacies.set(tx, record);
      return record;
    });
    return myCandidacy(record);
  }

  /** The district the member chose, as the source names it; refused unless the source lists it for that state. */
  private async district(input: CandidacyInput): Promise<CandidacyContent['district']> {
    const kind = OFFICE_DISTRICTS[input.office];
    const geoid = districtLookupId(kind, input.state, input.districtId);
    const found = (await this.districts.list(kind, input.state)).find((d) => d.geoid === geoid);
    if (!found) {
      throw new BadRequestException({
        message: 'invalid request',
        errors: [{ path: kind === 'state' ? 'state' : 'districtId', message: 'choose a district from the list' }],
      });
    }
    return found;
  }

  private async assertActive(accountId: string): Promise<void> {
    if ((await this.members.find(accountId))?.status !== 'active') {
      throw new ForbiddenException('only Active members can declare a candidacy');
    }
  }

  private async people(records: readonly CandidacyRecord[]): Promise<Map<string, MemberRecord | null>> {
    const ids = [...new Set(records.map((r) => r.accountId))];
    const found = await this.members.findMany(ids);
    return new Map(ids.map((id, i) => [id, found[i] ?? null]));
  }
}
