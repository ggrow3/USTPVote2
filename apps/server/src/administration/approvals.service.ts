import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { hashCanonical } from 'ustp-audit';
import {
  APPROVAL_TTL_DAYS,
  checkCanApprove,
  checkCanRequest,
  checkRoleChange,
  Collections,
  TWO_PERSON_ACTIONS,
  type ApprovalRequestRecord,
  type ApprovalStatus,
  type DecisionInput,
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
import { LedgerService, type LedgerEvent } from '../ledger/ledger.service.js';

interface RoleChangePayload {
  readonly accountId: string;
  readonly role: Role;
  readonly change: 'grant' | 'revoke';
}

const forbidden = (reason: string) => new ForbiddenException(reason);

/**
 * The two-person rule (design §10.2): one admin requests, a different admin with the approving role decides,
 * and the action executes on exactly the payload that was approved. Role changes are the first actions;
 * election actions arrive in M2.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly directory: DirectoryService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async requestRoleChange(ctx: RequestContext, input: RoleChangeInput): Promise<ApprovalRequestRecord> {
    const requestedBy = requireAccount(ctx);
    const action = input.change === 'grant' ? 'role.grant' : 'role.revoke';
    assertCheck(checkCanRequest(action, actorOf(ctx, this.config.adminMfaRequired), input.accountId), forbidden);
    const payload: RoleChangePayload = { accountId: input.accountId, role: input.role, change: input.change };
    const db = this.firebase.db;

    return db.runTransaction(async (tx) => {
      await this.assertRoleChangeAllowed(tx, payload);
      const ref = db.collection(Collections.approvalRequests).doc();
      const now = new Date();
      const record: ApprovalRequestRecord = {
        id: ref.id,
        action,
        subject: input.accountId,
        payload: { ...payload },
        payloadHash: hashCanonical(payload),
        reason: input.reason,
        requestedBy,
        requestedAt: now.toISOString(),
        approverRole: TWO_PERSON_ACTIONS[action].approver,
        status: 'pending',
        expiresAt: new Date(now.getTime() + APPROVAL_TTL_DAYS * 86_400_000).toISOString(),
        decidedBy: null,
        decidedAt: null,
        decisionReason: null,
      };
      await this.ledger.record(tx, [
        {
          type: 'approval.requested',
          actor: requestedBy,
          subject: record.subject,
          payload: { approvalId: record.id, action, payloadHash: record.payloadHash, reason: record.reason },
        },
      ]);
      tx.create(ref, record);
      return record;
    });
  }

  async list(status: ApprovalStatus): Promise<ApprovalRequestRecord[]> {
    const snap = await this.firebase.db
      .collection(Collections.approvalRequests)
      .where('status', '==', status)
      .orderBy('requestedAt')
      .limit(200)
      .get();
    return snap.docs.map((d) => d.data() as ApprovalRequestRecord);
  }

  async decide(ctx: RequestContext, id: string, input: DecisionInput): Promise<ApprovalRequestRecord> {
    const actor = actorOf(ctx, this.config.adminMfaRequired);
    const db = this.firebase.db;

    return db.runTransaction(async (tx) => {
      const ref = db.collection(Collections.approvalRequests).doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundException('no such approval request');
      const request = snap.data() as ApprovalRequestRecord;
      assertCheck(
        checkCanApprove(
          {
            action: request.action,
            requestedBy: request.requestedBy,
            status: request.status,
            expiresAt: new Date(request.expiresAt),
            subject: request.subject,
          },
          actor,
        ),
        forbidden,
      );
      if (hashCanonical(request.payload) !== request.payloadHash) {
        throw new ConflictException('the request payload no longer matches what was requested');
      }

      const events: LedgerEvent[] = [
        {
          type: 'approval.decided',
          actor: actor.accountId,
          subject: request.subject,
          payload: { approvalId: id, action: request.action, decision: input.decision, reason: input.reason },
        },
      ];
      let execute: (() => void) | null = null;
      if (input.decision === 'approve') {
        // Re-check preconditions at execution time: roles may have changed since the request.
        const payload = request.payload as unknown as RoleChangePayload;
        await this.assertRoleChangeAllowed(tx, payload);
        events.push({
          type: payload.change === 'grant' ? 'role.granted' : 'role.revoked',
          actor: actor.accountId,
          subject: payload.accountId,
          payload: { role: payload.role, approvalId: id, requestedBy: request.requestedBy },
        });
        execute = () => this.applyRoleChange(tx, payload, request, actor.accountId);
      }

      await this.ledger.record(tx, events);
      execute?.();
      const decided: ApprovalRequestRecord = {
        ...request,
        status: input.decision === 'approve' ? 'executed' : 'rejected',
        decidedBy: actor.accountId,
        decidedAt: new Date().toISOString(),
        decisionReason: input.reason,
      };
      tx.set(ref, decided);
      return decided;
    });
  }

  private async assertRoleChangeAllowed(tx: Transaction, payload: RoleChangePayload): Promise<void> {
    const account = await tx.get(this.firebase.db.collection(Collections.accounts).doc(payload.accountId));
    if (!account.exists) throw new NotFoundException('no such account');
    const held = await this.directory.activeRoles(payload.accountId, tx);
    assertCheck(checkRoleChange(held, payload.change, payload.role));
  }

  private applyRoleChange(tx: Transaction, payload: RoleChangePayload, request: ApprovalRequestRecord, approvedBy: string) {
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
