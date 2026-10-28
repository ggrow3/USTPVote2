import { Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  changeMemberStatus,
  checkMemberCorrectionRequest,
  checkMemberStatusRequest,
  Collections,
  correctMemberDetails,
  preferencesOf,
  resignMembership,
  testVoterAdmission,
  updateOwnDetails,
  type AccountRecord,
  type DetailsTransition,
  type MemberCorrectionInput,
  type MemberDetail,
  type MemberDetailsInput,
  type MemberRecord,
  type MemberStatus,
  type MemberStatusInput,
  type StatusHistoryRecord,
  type StatusTransition,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { accepted, assertCheck } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ApplicationRepository } from './application.repository.js';
import { MemberRepository } from './member.repository.js';

/**
 * Members and their status (design §5.1): resigning, the Membership Admin's status changes other than deciding an
 * application, the member list, history and profile, and changes to a member's details (design §5.2). The rules are
 * the Member aggregate's in `ustp-domain`.
 */
@Injectable()
export class Members {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly members: MemberRepository,
    private readonly applications: ApplicationRepository,
  ) {}

  async resign(ctx: RequestContext, reason: string | undefined): Promise<MemberRecord> {
    const accountId = requireAccount(ctx);
    return this.firebase.db.runTransaction(async (tx) => {
      const current = await this.members.get(tx, accountId);
      const transition = accepted(resignMembership(current, { reason: reason || null, at: new Date().toISOString() }));
      return this.record(tx, transition);
    });
  }

  /** Any other status change (suspend, reinstate, lapse…). Applications are decided by `MembershipApplications`. */
  async setStatus(ctx: RequestContext, accountId: string, input: MemberStatusInput): Promise<MemberRecord> {
    const actor = requireAccount(ctx);
    assertCheck(checkMemberStatusRequest(actor, accountId, input.to));
    return this.firebase.db.runTransaction(async (tx) => {
      const current = await this.members.get(tx, accountId);
      const transition = accepted(changeMemberStatus(current, { ...input, actor, at: new Date().toISOString() }));
      return this.record(tx, transition);
    });
  }

  list(status: MemberStatus | undefined, after: string | undefined, limit: number): Promise<MemberRecord[]> {
    return this.members.list(status, after, limit);
  }

  history(accountId: string): Promise<StatusHistoryRecord[]> {
    return this.members.history(accountId);
  }

  /** One member as a Membership Admin sees them: the record, every application with its answers, and the history. */
  async detail(accountId: string): Promise<MemberDetail> {
    const [member, applications, history, account] = await Promise.all([
      this.members.find(accountId),
      this.applications.ofAccount(accountId),
      this.members.history(accountId),
      this.firebase.db.collection(Collections.accounts).doc(accountId).get(),
    ]);
    if (!member) throw new NotFoundException('no such member');
    return { member, applications, history, preferences: preferencesOf(account.data() as AccountRecord | undefined) };
  }

  /** The signed-in member changes their own details and email opt-ins. */
  async updateOwnDetails(ctx: RequestContext, input: MemberDetailsInput): Promise<MemberRecord> {
    const accountId = requireAccount(ctx);
    return this.firebase.db.runTransaction(async (tx) => {
      const current = await this.members.get(tx, accountId);
      return this.recordDetails(tx, accepted(updateOwnDetails(current, { input, at: new Date().toISOString() })));
    });
  }

  /** A Membership Admin corrects someone else's names, state or contact details, with a reason. */
  async correctDetails(ctx: RequestContext, accountId: string, input: MemberCorrectionInput): Promise<MemberRecord> {
    const actor = requireAccount(ctx);
    assertCheck(checkMemberCorrectionRequest(actor, accountId));
    return this.firebase.db.runTransaction(async (tx) => {
      const current = await this.members.get(tx, accountId);
      return this.recordDetails(tx, accepted(correctMemberDetails(current, { input, actor })));
    });
  }

  /**
   * Makes a test voter persona an Active member on `bylawsVersion` (design §10.4), recorded like any status change.
   * Call inside the persona's creation transaction, after its other reads.
   */
  admitTestPersona(
    tx: Transaction,
    persona: { readonly accountId: string; readonly label: string; readonly actor: string; readonly bylawsVersion: string },
  ): Promise<MemberRecord> {
    return this.record(tx, testVoterAdmission({ ...persona, at: new Date().toISOString() }));
  }

  /**
   * The one way a member's status changes (design §5.1): its ledger entry, member record and history entry, in the
   * caller's transaction. Call after the transaction's other reads.
   */
  async record(tx: Transaction, transition: StatusTransition): Promise<MemberRecord> {
    const [ledgerSeq] = await this.ledger.record(tx, [transition.event]);
    this.members.save(tx, transition.member, transition.history(ledgerSeq!));
    return transition.member;
  }

  /** A change of details: its ledger entry (field names only) and the member record, in the caller's transaction. */
  private async recordDetails(tx: Transaction, transition: DetailsTransition): Promise<MemberRecord> {
    await this.ledger.record(tx, [transition.event]);
    this.members.update(tx, transition.member);
    return transition.member;
  }
}
