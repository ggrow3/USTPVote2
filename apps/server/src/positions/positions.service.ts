import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  Collections,
  type ApprovalRequestRecord,
  type PositionInput,
  type PositionModifyPayload,
  type PositionRecord,
  type PositionsView,
  type PositionTermRecord,
} from 'ustp-domain';
import { ApprovalsService } from '../administration/approvals.service.js';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { Firebase } from '../infra/firebase.js';

/**
 * Offices and terms (design §6.4). Every change is a `position.modify` request an Auditor approves; this service only
 * files requests and reads.
 */
@Injectable()
export class PositionsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly approvals: ApprovalsService,
  ) {}

  /** Every office and every term, for administrators. */
  async all(): Promise<PositionsView> {
    const [positions, terms] = await Promise.all([
      this.firebase.db.collection(Collections.positions).orderBy('positionId').get(),
      this.firebase.db.collection(Collections.positionTerms).orderBy('startsAt', 'desc').limit(500).get(),
    ]);
    return {
      positions: positions.docs.map((d) => d.data() as PositionRecord),
      terms: terms.docs.map((d) => d.data() as PositionTermRecord),
    };
  }

  /** Every office with the people holding it now; office holders are public. */
  async current(): Promise<PositionsView> {
    const [positions, terms] = await Promise.all([
      this.firebase.db.collection(Collections.positions).orderBy('positionId').get(),
      this.firebase.db.collection(Collections.positionTerms).where('status', '==', 'active').get(),
    ]);
    return {
      positions: positions.docs.map((d) => d.data() as PositionRecord),
      terms: terms.docs.map((d) => d.data() as PositionTermRecord).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    };
  }

  /** Asks an Auditor to define a new office, or to change an existing one to exactly this. */
  async requestDefine(ctx: RequestContext, input: PositionInput): Promise<ApprovalRequestRecord> {
    const requestedBy = requireAccount(ctx);
    this.approvals.assertCanRequest(ctx, 'position.modify', input.positionId);
    const { reason, ...position } = input;
    const payload: PositionModifyPayload = { change: 'define', position };
    return this.firebase.db.runTransaction((tx) =>
      this.approvals.createRequest(tx, { action: 'position.modify', subject: position.positionId, payload, reason, requestedBy }),
    );
  }

  /** Asks an Auditor to end an active term now (resignation, removal under the bylaws). */
  async requestEndTerm(ctx: RequestContext, positionId: string, termId: string, reason: string): Promise<ApprovalRequestRecord> {
    const requestedBy = requireAccount(ctx);
    this.approvals.assertCanRequest(ctx, 'position.modify', termId);
    const ref = this.firebase.db.collection(Collections.positionTerms).doc(termId);
    return this.firebase.db.runTransaction(async (tx) => {
      const term = (await tx.get(ref)).data() as PositionTermRecord | undefined;
      if (!term || term.positionId !== positionId) throw new ConflictException('no such term for that office');
      if (term.status !== 'active') throw new ConflictException('that term has already ended');
      if (term.accountId === requestedBy) throw new ForbiddenException('you cannot request a change to your own term');
      const payload: PositionModifyPayload = { change: 'end_term', termId, positionId };
      return this.approvals.createRequest(tx, { action: 'position.modify', subject: termId, payload, reason, requestedBy });
    });
  }
}
