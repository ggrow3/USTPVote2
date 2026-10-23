import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  Collections,
  type Actor,
  type ApprovalRequestRecord,
  type PositionModifyPayload,
  type PositionRecord,
  type PositionTermRecord,
} from 'ustp-domain';
import type { ApprovalHandler, PreparedDecision } from '../administration/approval-handler.js';
import { Firebase } from '../infra/firebase.js';

/**
 * Executes `position.modify` (design §6.4, §10.2): ending a term early, and defining or changing an office for requests
 * made before offices were defined directly (`PositionsService.define`). Terms are otherwise only created by
 * certification (`ElectionApprovals`).
 */
@Injectable()
export class PositionApprovals implements ApprovalHandler {
  constructor(private readonly firebase: Firebase) {}

  async approve(tx: Transaction, request: ApprovalRequestRecord, approver: Actor): Promise<PreparedDecision> {
    const payload = request.payload as unknown as PositionModifyPayload;
    const now = new Date().toISOString();
    if (payload.change === 'define') {
      const { position } = payload;
      const record: PositionRecord = { ...position, definedAt: now, approvalId: request.id };
      return {
        events: [
          {
            type: 'position.defined',
            actor: approver.accountId,
            subject: position.positionId,
            payload: { ...position, approvalId: request.id },
          },
        ],
        apply: () => tx.set(this.firebase.db.collection(Collections.positions).doc(position.positionId), record),
      };
    }

    const ref = this.firebase.db.collection(Collections.positionTerms).doc(payload.termId);
    const term = (await tx.get(ref)).data() as PositionTermRecord | undefined;
    if (!term || term.positionId !== payload.positionId) throw new ConflictException('that term no longer exists');
    if (term.status !== 'active') throw new ConflictException('that term has already ended');
    if (term.accountId && term.accountId === approver.accountId) throw new ForbiddenException('you cannot decide on your own term');
    return {
      events: [
        {
          type: 'position_term.ended',
          actor: approver.accountId,
          subject: term.positionId,
          payload: {
            termId: term.termId,
            positionId: term.positionId,
            holderName: term.holderName,
            endedAt: now,
            reason: request.reason,
            approvalId: request.id,
          },
        },
      ],
      apply: () => tx.update(ref, { status: 'ended', endedAt: now, endReason: request.reason }),
    };
  }
}
