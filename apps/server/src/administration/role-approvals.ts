import { Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { checkRoleChange, Collections, type Actor, type ApprovalRequestRecord, type Role, type RoleAssignmentRecord } from 'ustp-domain';
import { DirectoryService, roleAssignmentId } from '../auth/directory.service.js';
import { assertCheck } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import type { ApprovalHandler, PreparedDecision } from './approval-handler.js';

export interface RoleChangePayload {
  readonly accountId: string;
  readonly role: Role;
  readonly change: 'grant' | 'revoke';
}

/** `role.grant` / `role.revoke` (design §10.2). */
@Injectable()
export class RoleApprovals implements ApprovalHandler {
  constructor(
    private readonly firebase: Firebase,
    private readonly directory: DirectoryService,
  ) {}

  /** The account exists and the change is compatible with the roles it holds now. */
  async assertAllowed(tx: Transaction, payload: RoleChangePayload): Promise<void> {
    const account = await tx.get(this.firebase.db.collection(Collections.accounts).doc(payload.accountId));
    if (!account.exists) throw new NotFoundException('no such account');
    const held = await this.directory.activeRoles(payload.accountId, tx);
    assertCheck(checkRoleChange(held, payload.change, payload.role));
  }

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
      apply: () => this.applyChange(tx, payload, request, approver.accountId),
    };
  }

  private applyChange(tx: Transaction, payload: RoleChangePayload, request: ApprovalRequestRecord, approvedBy: string): void {
    const ref = this.firebase.db.collection(Collections.roleAssignments).doc(roleAssignmentId(payload.accountId, payload.role));
    const now = new Date().toISOString();
    if (payload.change === 'grant') {
      const record: RoleAssignmentRecord = {
        accountId: payload.accountId,
        role: payload.role,
        grantedAt: now,
        grantedBy: request.requestedBy,
        approvedBy,
        approvalId: request.id,
        revokedAt: null,
        revokedBy: null,
      };
      tx.set(ref, record);
    } else {
      tx.update(ref, { revokedAt: now, revokedBy: request.requestedBy });
    }
  }
}
