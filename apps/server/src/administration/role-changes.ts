import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  checkCanChangeRole,
  checkRoleChange,
  Collections,
  type AccountSummary,
  type Actor,
  type ApprovalRequestRecord,
  type Role,
  type RoleAssignmentRecord,
  type RoleChangeInput,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import { DirectoryService, roleAssignmentId } from '../auth/directory.service.js';
import { actorOf, type RequestContext } from '../auth/principal.js';
import { assertCheck } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { ApprovalHandler, PreparedDecision } from './approval-handler.js';

export interface RoleChangePayload {
  readonly accountId: string;
  readonly role: Role;
  readonly change: 'grant' | 'revoke';
}

/** Who made a change: the System Admin, and for a two-person request also its approver. */
interface ChangedBy {
  readonly by: string;
  readonly approvedBy: string | null;
  readonly approvalId: string | null;
}

/**
 * Role changes (design §10.2): one System Admin grants or revokes a role and it takes effect at once, ledgered as
 * `role.granted` / `role.revoked` with that admin as actor. Also the handler for `role.grant` / `role.revoke`
 * requests made while role changes were two-person, so those can still be decided until they expire.
 */
@Injectable()
export class RoleChanges implements ApprovalHandler {
  constructor(
    private readonly firebase: Firebase,
    private readonly directory: DirectoryService,
    private readonly ledger: LedgerService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Applies the change now; returns the roles the account holds afterwards. */
  async change(ctx: RequestContext, input: RoleChangeInput): Promise<Pick<AccountSummary, 'accountId' | 'roles'>> {
    const changedBy = requireAccount(ctx);
    const actor = actorOf(ctx, this.config.adminMfaRequired);
    assertCheck(checkCanChangeRole(actor, { accountId: input.accountId, roles: null }, input.change, input.role), ForbiddenException);
    const payload: RoleChangePayload = { accountId: input.accountId, role: input.role, change: input.change };
    return this.firebase.db.runTransaction(async (tx) => {
      const held = await this.assertAllowed(tx, payload);
      await this.ledger.record(tx, [
        {
          type: payload.change === 'grant' ? 'role.granted' : 'role.revoked',
          actor: changedBy,
          subject: payload.accountId,
          payload: { role: payload.role, reason: input.reason },
        },
      ]);
      this.applyChange(tx, payload, { by: changedBy, approvedBy: null, approvalId: null });
      const roles = payload.change === 'grant' ? [...held, payload.role].sort() : held.filter((r) => r !== payload.role);
      return { accountId: payload.accountId, roles };
    });
  }

  /** The account exists and the change is compatible with the roles it holds now, which are returned. */
  async assertAllowed(tx: Transaction, payload: RoleChangePayload): Promise<Role[]> {
    const account = await tx.get(this.firebase.db.collection(Collections.accounts).doc(payload.accountId));
    if (!account.exists) throw new NotFoundException('no such account');
    const held = await this.directory.activeRoles(payload.accountId, tx);
    assertCheck(checkRoleChange(held, payload.change, payload.role));
    return held;
  }

  /** A request made while role changes were two-person, approved now. */
  async approve(tx: Transaction, request: ApprovalRequestRecord, approver: Actor): Promise<PreparedDecision> {
    const payload = request.payload as unknown as RoleChangePayload;
    await this.assertAllowed(tx, payload);
    return {
      events: [
        {
          type: payload.change === 'grant' ? 'role.granted' : 'role.revoked',
          actor: approver.accountId,
          subject: payload.accountId,
          payload: { role: payload.role, approvalId: request.id, requestedBy: request.requestedBy },
        },
      ],
      apply: () => this.applyChange(tx, payload, { by: request.requestedBy, approvedBy: approver.accountId, approvalId: request.id }),
    };
  }

  private applyChange(tx: Transaction, payload: RoleChangePayload, changedBy: ChangedBy): void {
    const ref = this.firebase.db.collection(Collections.roleAssignments).doc(roleAssignmentId(payload.accountId, payload.role));
    const now = new Date().toISOString();
    if (payload.change === 'grant') {
      const record: RoleAssignmentRecord = {
        accountId: payload.accountId,
        role: payload.role,
        grantedAt: now,
        grantedBy: changedBy.by,
        approvedBy: changedBy.approvedBy,
        approvalId: changedBy.approvalId,
        revokedAt: null,
        revokedBy: null,
      };
      tx.set(ref, record);
    } else {
      tx.update(ref, { revokedAt: now, revokedBy: changedBy.by });
    }
  }
}
