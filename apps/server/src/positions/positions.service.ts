import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  Collections,
  planAppointment,
  type AppointmentInput,
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
import { accepted } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { appointmentContext } from './appointment-context.js';

/**
 * Offices and terms (design §6.4). A Membership or Election Admin defines or changes an office at once; appointing a
 * member to it (`position.appoint`) and ending a term (`position.modify`) are requests an Auditor approves.
 */
@Injectable()
export class PositionsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly approvals: ApprovalsService,
    private readonly ledger: LedgerService,
    private readonly members: MemberDirectory,
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

  /** Defines a new office, or changes an existing one to exactly this, at once. Terms already running are untouched. */
  async define(ctx: RequestContext, input: PositionInput): Promise<PositionRecord> {
    const definedBy = requireAccount(ctx);
    const { reason, ...position } = input;
    const record: PositionRecord = { ...position, definedAt: new Date().toISOString(), approvalId: null };
    return this.firebase.db.runTransaction(async (tx) => {
      await this.ledger.record(tx, [
        { type: 'position.defined', actor: definedBy, subject: position.positionId, payload: { ...position, reason } },
      ]);
      tx.set(this.firebase.db.collection(Collections.positions).doc(position.positionId), record);
      return record;
    });
  }

  /**
   * Asks an Auditor to appoint an Active member to a free seat of the office, without an election. The appointee may
   * neither ask nor approve: they are the request's subject.
   */
  async requestAppointment(ctx: RequestContext, positionId: string, input: AppointmentInput): Promise<ApprovalRequestRecord> {
    const requestedBy = requireAccount(ctx);
    const { reason, ...appointment } = input;
    this.approvals.assertCanRequest(ctx, 'position.appoint', appointment.accountId);
    return this.firebase.db.runTransaction(async (tx) => {
      const context = await appointmentContext(tx, this.firebase, this.members, positionId, appointment.accountId);
      const payload = accepted(planAppointment(positionId, appointment, context, new Date().toISOString()));
      return this.approvals.createRequest(tx, { action: 'position.appoint', subject: payload.accountId, payload, reason, requestedBy });
    });
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
