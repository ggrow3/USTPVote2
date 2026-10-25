import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  changeMemberStatus,
  checkMemberStatusRequest,
  resignMembership,
  testVoterAdmission,
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
import { MemberRepository } from './member.repository.js';

/**
 * Members and their status (design §5.1): resigning, the Membership Admin's status changes other than deciding an
 * application, the member list and history. The rules are the Member aggregate's in `ustp-domain`.
 */
@Injectable()
export class Members {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly members: MemberRepository,
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
}
