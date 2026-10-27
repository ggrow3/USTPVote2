import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { hashCanonical } from 'ustp-audit';
import {
  APPROVAL_TTL_DAYS,
  checkCanApprove,
  checkCanRequest,
  Collections,
  TWO_PERSON_ACTIONS,
  type Actor,
  type ApprovalRequestRecord,
  type ApprovalStatus,
  type DecisionInput,
  type TwoPersonAction,
} from 'ustp-domain';
import { actorOf, type RequestContext } from '../auth/principal.js';
import { assertCheck } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { ElectionApprovals } from '../elections/election-approvals.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PositionApprovals } from '../positions/position-approvals.js';
import { NO_EFFECT, type ApprovalHandler } from './approval-handler.js';
import { RoleChanges } from './role-changes.js';

export interface NewRequest {
  readonly action: TwoPersonAction;
  /** The account or election the action affects. */
  readonly subject: string;
  readonly payload: object;
  readonly reason: string;
  readonly requestedBy: string;
  /** Pre-allocated request ID, when the caller needs it before the request exists. */
  readonly id?: string;
}

/**
 * The two-person rule (design §10.2): one admin requests, a different admin with the approving role decides, and
 * the action executes on exactly the payload that was approved. Each action's effect lives in its handler.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    @Inject(CONFIG) private readonly config: ServerConfig,
    private readonly roles: RoleChanges,
    private readonly elections: ElectionApprovals,
    private readonly positions: PositionApprovals,
  ) {}

  /** Checks the caller may request `action` about `subject`; call before opening the request's transaction. */
  assertCanRequest(ctx: RequestContext, action: TwoPersonAction, subject?: string): Actor {
    const actor = actorOf(ctx, this.config.adminMfaRequired);
    assertCheck(checkCanRequest(action, actor, subject), ForbiddenException);
    return actor;
  }

  /**
   * Records a request inside the caller's transaction. Refuses a second pending request for the same action and
   * subject. Call after the transaction's own reads and before its writes.
   */
  async createRequest(tx: Transaction, input: NewRequest): Promise<ApprovalRequestRecord> {
    const db = this.firebase.db;
    const duplicate = await tx.get(
      db
        .collection(Collections.approvalRequests)
        .where('action', '==', input.action)
        .where('subject', '==', input.subject)
        .where('status', '==', 'pending')
        .limit(1),
    );
    if (!duplicate.empty) throw new ConflictException('a request for this is already waiting for a decision');

    const ref = input.id ? db.collection(Collections.approvalRequests).doc(input.id) : db.collection(Collections.approvalRequests).doc();
    const now = new Date();
    const record: ApprovalRequestRecord = {
      id: ref.id,
      action: input.action,
      subject: input.subject,
      payload: { ...input.payload },
      payloadHash: hashCanonical(input.payload),
      reason: input.reason,
      requestedBy: input.requestedBy,
      requestedAt: now.toISOString(),
      approverRole: TWO_PERSON_ACTIONS[input.action].approver,
      status: 'pending',
      expiresAt: new Date(now.getTime() + APPROVAL_TTL_DAYS * 86_400_000).toISOString(),
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
    };
    await this.ledger.record(tx, [
      {
        type: 'approval.requested',
        actor: input.requestedBy,
        subject: input.subject,
        payload: { approvalId: record.id, action: input.action, payloadHash: record.payloadHash, reason: input.reason },
      },
    ]);
    tx.create(ref, record);
    return record;
  }

  allocateId(): string {
    return this.firebase.db.collection(Collections.approvalRequests).doc().id;
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
    const ref = db.collection(Collections.approvalRequests).doc(id);

    // Authorize before any side effect a handler performs outside the transaction.
    const before = (await ref.get()).data() as ApprovalRequestRecord | undefined;
    if (!before) throw new NotFoundException('no such approval request');
    this.assertCanDecide(before, actor);
    const handler = this.handlerFor(before.action);
    const prepared = input.decision === 'approve' && handler.beforeApprove ? await handler.beforeApprove(before) : undefined;

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const request = snap.data() as ApprovalRequestRecord;
      this.assertCanDecide(request, actor);
      if (hashCanonical(request.payload) !== request.payloadHash) {
        throw new ConflictException('the request payload no longer matches what was requested');
      }

      const effect =
        input.decision === 'approve'
          ? await handler.approve(tx, request, actor, prepared)
          : handler.reject
            ? await handler.reject(tx, request)
            : NO_EFFECT;
      const seqs = await this.ledger.record(tx, [
        {
          type: 'approval.decided',
          actor: actor.accountId,
          subject: request.subject,
          payload: { approvalId: id, action: request.action, decision: input.decision, reason: input.reason },
        },
        ...effect.events,
      ]);
      effect.apply(seqs.slice(1));
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

  private assertCanDecide(request: ApprovalRequestRecord, actor: Actor): void {
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
      ForbiddenException,
    );
  }

  private handlerFor(action: TwoPersonAction): ApprovalHandler {
    // Role requests come only from before role changes needed one admin (design §10.2).
    if (action === 'role.grant' || action === 'role.revoke') return this.roles;
    if (action === 'position.modify' || action === 'position.appoint') return this.positions;
    return this.elections; // roll.approve, election.schedule, election.certify, election.cancel
  }
}
