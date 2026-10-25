import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  ADMIN_PERSONAS,
  Collections,
  MAX_TEST_VOTERS,
  PERSONA_KINDS,
  uuidv7,
  voterPersonaLabel,
  type AccountRecord,
  type CreatePersonasInput,
  type PersonaKind,
  type PersonaRecord,
  type PersonaSummary,
  type RoleAssignmentRecord,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import { DirectoryService, roleAssignmentId } from '../auth/directory.service.js';
import type { RequestContext } from '../auth/principal.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { Members } from '../membership/members.service.js';
import { MembershipService } from '../membership/membership.service.js';

/**
 * Test personas (design §10.4): synthetic accounts with no login, one per admin role plus numbered voters, that a
 * System Admin acts as to rehearse an election. Each is created in its own transaction with the same ledger entry its
 * real counterpart would get (`role.granted` or `member.status_changed`), naming the System Admin as the actor.
 */
@Injectable()
export class PersonasService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly directory: DirectoryService,
    private readonly membership: MembershipService,
    private readonly members: MemberDirectory,
    private readonly statusChanges: Members,
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
