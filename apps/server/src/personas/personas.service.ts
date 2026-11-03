import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  ADMIN_PERSONAS,
  checkCanDeleteTestVoters,
  Collections,
  MAX_TEST_VOTERS,
  PERSONA_KINDS,
  TEST_VOTER_DELETION_REASON,
  uuidv7,
  voterPersonaLabel,
  type AccountRecord,
  type CreatePersonasInput,
  type DeleteTestVotersInput,
  type PersonaKind,
  type PersonaRecord,
  type PersonaSummary,
  type RoleAssignmentRecord,
} from 'ustp-domain';
import { AccountsService } from '../accounts/accounts.service.js';
import { requireAccount } from '../auth/decorators.js';
import { DirectoryService, roleAssignmentId } from '../auth/directory.service.js';
import { actorOf, type RequestContext } from '../auth/principal.js';
import { assertCheck } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { Members } from '../membership/members.service.js';
import { MembershipService } from '../membership/membership.service.js';

/**
 * Test personas (design §10.4): synthetic accounts with no login, one per admin role plus numbered voters, that a
 * System Admin acts as to rehearse an election. Each is created in its own transaction with the same ledger entry its
 * real counterpart would get (`role.granted` or `member.status_changed`), naming the System Admin as the actor. Test
 * voters can be deleted again, each as an account is (`AccountsService.erase`).
 */
@Injectable()
export class PersonasService {
  private readonly logger = new Logger(PersonasService.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly directory: DirectoryService,
    private readonly membership: MembershipService,
    private readonly members: MemberDirectory,
    private readonly statusChanges: Members,
    private readonly accounts: AccountsService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Admin personas in role order, then voters by number. Never more than a few dozen documents. */
  async list(): Promise<PersonaSummary[]> {
    this.assertEnabled();
    const db = this.firebase.db;
    const snap = await db.collection(Collections.testingPersonas).get();
    const personas = snap.docs
      .map((d) => d.data() as PersonaRecord)
      .sort((a, b) => PERSONA_KINDS.indexOf(a.kind) - PERSONA_KINDS.indexOf(b.kind) || (a.number ?? 0) - (b.number ?? 0));
    const [roles, members] = await Promise.all([
      this.directory.allActiveRoles(),
      this.members.findMany(personas.map((p) => p.accountId)),
    ]);
    return personas.map((p, i) => ({
      ...p,
      roles: roles.get(p.accountId) ?? [],
      memberStatus: members[i]?.status ?? null,
    }));
  }

  /** Creates whichever admin personas are missing, then adds `voters` voter personas as Active members. */
  async create(ctx: RequestContext, input: CreatePersonasInput): Promise<PersonaSummary[]> {
    this.assertEnabled();
    const operator = requireAccount(ctx);
    let bylawsVersion: string | null = null;
    if (input.voters > 0) {
      const existing = await this.firebase.db.collection(Collections.testingPersonas).where('kind', '==', 'voter').count().get();
      if (existing.data().count + input.voters > MAX_TEST_VOTERS) {
        throw new BadRequestException(`a deployment holds at most ${MAX_TEST_VOTERS} test voters; it has ${existing.data().count}`);
      }
      bylawsVersion = (await this.membership.currentBylaws())?.version ?? null;
      if (!bylawsVersion) {
        throw new ConflictException('publish bylaws before adding test voters: act as the Test Membership Admin and use Admin → Bylaws');
      }
    }
    for (const { kind, label } of ADMIN_PERSONAS) await this.createAdmin(operator, kind, label);
    for (let i = 0; i < input.voters; i++) await this.createVoter(operator, bylawsVersion!);
    return this.list();
  }

  /**
   * Deletes test voters (design §10.4): one System Admin, at once, whatever elections hold them, since their rolls,
   * ballots and results keep the IDs. Every ID must be a test voter's before any is deleted; then each goes in its own
   * transaction, ledgered as `account.deleted`, with its persona record, and its activity after. A voter deleted
   * meanwhile is skipped.
   */
  async deleteVoters(ctx: RequestContext, input: DeleteTestVotersInput): Promise<PersonaSummary[]> {
    this.assertEnabled();
    const operator = requireAccount(ctx);
    assertCheck(checkCanDeleteTestVoters(actorOf(ctx, this.config.adminMfaRequired)), ForbiddenException);
    const db = this.firebase.db;
    const records = await db.getAll(...input.voters.map((id) => db.collection(Collections.testingPersonas).doc(id)));
    const others = input.voters.filter((_, i) => (records[i]!.data() as PersonaRecord | undefined)?.kind !== 'voter');
    if (others.length) throw new NotFoundException(`not a test voter: ${others.join(', ')}`);
    for (const accountId of input.voters) await this.deleteVoter(operator, accountId);
    return this.list();
  }

  private assertEnabled(): void {
    if (!this.config.testingMode) throw new NotFoundException('testing mode is off on this deployment');
  }

  private async createAdmin(operator: string, kind: Exclude<PersonaKind, 'voter'>, label: string): Promise<void> {
    const db = this.firebase.db;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(db.collection(Collections.testingPersonas).where('kind', '==', kind).limit(1));
      if (!existing.empty) return;
      const accountId = uuidv7();
      await this.ledger.record(tx, [
        { type: 'role.granted', actor: operator, subject: accountId, payload: { role: kind, reason: 'test persona' } },
      ]);
      const now = this.writePersona(tx, { accountId, kind, label, number: null, createdBy: operator });
      const role: RoleAssignmentRecord = {
        accountId,
        role: kind,
        grantedAt: now,
        grantedBy: operator,
        approvedBy: null,
        approvalId: null,
        revokedAt: null,
        revokedBy: null,
      };
      tx.create(db.collection(Collections.roleAssignments).doc(roleAssignmentId(accountId, kind)), role);
    });
  }

  private async createVoter(operator: string, bylawsVersion: string): Promise<void> {
    const db = this.firebase.db;
    await db.runTransaction(async (tx) => {
      const voters = await tx.get(db.collection(Collections.testingPersonas).where('kind', '==', 'voter'));
      if (voters.size >= MAX_TEST_VOTERS) throw new ConflictException(`a deployment holds at most ${MAX_TEST_VOTERS} test voters`);
      const number = Math.max(0, ...voters.docs.map((d) => (d.data() as PersonaRecord).number ?? 0)) + 1;
      const accountId = uuidv7();
      const label = voterPersonaLabel(number);
      await this.statusChanges.admitTestPersona(tx, { accountId, label, actor: operator, bylawsVersion });
      this.writePersona(tx, { accountId, kind: 'voter', label, number, createdBy: operator });
    });
  }

  private async deleteVoter(operator: string, accountId: string): Promise<void> {
    const db = this.firebase.db;
    const deleted = await db.runTransaction(async (tx) => {
      const personaRef = db.collection(Collections.testingPersonas).doc(accountId);
      const [persona, account] = await Promise.all([tx.get(personaRef), tx.get(db.collection(Collections.accounts).doc(accountId))]);
      if (!persona.exists) return false;
      // A persona has no login (design §10.4), so there is nothing to delete from Identity Platform.
      const found = { account: account.data() as AccountRecord, identities: [] };
      if (account.exists) await this.accounts.erase(tx, found, operator, TEST_VOTER_DELETION_REASON);
      tx.delete(personaRef);
      return true;
    });
    if (!deleted) return;
    await this.accounts.forgetActivity(accountId, []).catch((e: unknown) => {
      this.logger.warn(`test voter ${accountId} deleted, but not all its activity: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  /** The persona's account (no login, no email) and its persona record. Returns the creation time. */
  private writePersona(tx: Transaction, persona: Omit<PersonaRecord, 'createdAt'>): string {
    const db = this.firebase.db;
    const createdAt = new Date().toISOString();
    const account: AccountRecord = {
      accountId: persona.accountId,
      displayName: persona.label,
      primaryEmail: null,
      emailVerified: false,
      createdAt,
    };
    tx.create(db.collection(Collections.accounts).doc(persona.accountId), account);
    tx.create(db.collection(Collections.testingPersonas).doc(persona.accountId), { ...persona, createdAt } satisfies PersonaRecord);
    return createdAt;
  }
}
