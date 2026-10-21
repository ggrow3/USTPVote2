import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FieldPath, type Transaction } from 'firebase-admin/firestore';
import { sha256Hex } from 'ustp-audit';
import {
  checkStatusChange,
  Collections,
  type ApplicationRecord,
  type ApplicationStatus,
  type BylawsRecord,
  type CreateApplicationInput,
  type DecisionInput,
  type MemberRecord,
  type MemberStatus,
  type MemberStatusInput,
  type PublishBylawsInput,
  type StatusHistoryRecord,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';

interface StatusChange {
  readonly accountId: string;
  /** Current record, or null for a first application. */
  readonly current: MemberRecord | null;
  readonly to: MemberStatus;
  readonly actor: string;
  readonly reason: string | null;
  readonly applicationId: string | null;
  /** Profile fields to set alongside the status (applications). */
  readonly profile?: Pick<MemberRecord, 'legalName' | 'preferredName' | 'state' | 'bylawsVersion'>;
}

/** Bylaws, membership applications and member status (design §5). */
@Injectable()
export class MembershipService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
  ) {}

  async currentBylaws(): Promise<BylawsRecord | null> {
    const snap = await this.currentBylawsQuery().get();
    return (snap.docs[0]?.data() as BylawsRecord | undefined) ?? null;
  }

  async publishBylaws(ctx: RequestContext, input: PublishBylawsInput): Promise<BylawsRecord> {
    const actor = requireAccount(ctx);
    const record: BylawsRecord = {
      version: input.version,
      title: input.title,
      text: input.text,
      contentHash: sha256Hex(input.text),
      publishedAt: new Date().toISOString(),
      publishedBy: actor,
    };
    const ref = this.firebase.db.collection(Collections.bylawsVersions).doc(input.version);
    return this.firebase.db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) throw new ConflictException(`bylaws version ${input.version} already exists`);
      await this.ledger.record(tx, [
        {
          type: 'bylaws.published',
          actor,
          subject: null,
          payload: { version: record.version, title: record.title, contentHash: record.contentHash },
        },
      ]);
      tx.create(ref, record);
      return record;
    });
  }

  /** Applying requires agreeing to the *current* bylaws, identified by version and content hash. */
  async submitApplication(ctx: RequestContext, input: CreateApplicationInput): Promise<ApplicationRecord> {
    const accountId = requireAccount(ctx);
    if (!ctx.principal.emailVerified) throw new ForbiddenException('verify your email address before applying');
    const db = this.firebase.db;

    return db.runTransaction(async (tx) => {
      const bylaws = (await tx.get(this.currentBylawsQuery())).docs[0]?.data() as BylawsRecord | undefined;
      if (!bylaws) throw new ConflictException('no bylaws have been published yet');
      if (bylaws.version !== input.bylawsVersion || bylaws.contentHash !== input.bylawsHash) {
        throw new ConflictException('the bylaws have changed; review the current version and agree again');
      }
      const current = await this.readMember(tx, accountId);
      assertCheck(checkStatusChange({ from: current?.status ?? null, to: 'applicant', initiatedBy: 'member' }));

      const ref = db.collection(Collections.applications).doc();
      const now = new Date().toISOString();
      const application: ApplicationRecord = {
        applicationId: ref.id,
        accountId,
        status: 'pending',
        submittedAt: now,
        bylawsVersion: bylaws.version,
        bylawsHash: bylaws.contentHash,
        legalName: input.legalName,
        preferredName: input.preferredName || null,
        state: input.state,
        statement: input.statement || null,
        decidedBy: null,
        decidedAt: null,
        decisionReason: null,
      };
      await this.changeStatus(tx, {
        accountId,
        current,
        to: 'applicant',
        actor: accountId,
        reason: null,
        applicationId: ref.id,
        profile: {
          legalName: application.legalName,
          preferredName: application.preferredName,
          state: application.state,
          bylawsVersion: application.bylawsVersion,
        },
      });
      tx.create(ref, application);
      return application;
    });
  }

  async myApplications(ctx: RequestContext): Promise<ApplicationRecord[]> {
    const accountId = requireAccount(ctx);
    const snap = await this.firebase.db
      .collection(Collections.applications)
      .where('accountId', '==', accountId)
      .orderBy('submittedAt', 'desc')
      .limit(20)
      .get();
    return snap.docs.map((d) => d.data() as ApplicationRecord);
  }

  async resign(ctx: RequestContext, reason: string | undefined): Promise<MemberRecord> {
    const accountId = requireAccount(ctx);
    return this.firebase.db.runTransaction(async (tx) => {
      const current = await this.readMember(tx, accountId);
      if (!current) throw new NotFoundException('you are not a member');
      assertCheck(checkStatusChange({ from: current.status, to: 'resigned', initiatedBy: 'member' }));
      return this.changeStatus(tx, {
        accountId,
        current,
        to: 'resigned',
        actor: accountId,
        reason: reason || null,
        applicationId: null,
      });
    });
  }

  // --- Membership Admin -------------------------------------------------------------------------------------

  async listApplications(status: ApplicationStatus, limit: number): Promise<ApplicationRecord[]> {
    const snap = await this.firebase.db
      .collection(Collections.applications)
      .where('status', '==', status)
      .orderBy('submittedAt')
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as ApplicationRecord);
  }

  async decideApplication(ctx: RequestContext, applicationId: string, input: DecisionInput): Promise<ApplicationRecord> {
    const actor = requireAccount(ctx);
    const db = this.firebase.db;
    return db.runTransaction(async (tx) => {
      const ref = db.collection(Collections.applications).doc(applicationId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundException('no such application');
      const application = snap.data() as ApplicationRecord;
      if (application.accountId === actor) throw new ForbiddenException('you cannot decide your own application');
      if (application.status !== 'pending') throw new ConflictException(`application is already ${application.status}`);
      const current = await this.readMember(tx, application.accountId);
      if (current?.status !== 'applicant') throw new ConflictException('the applicant is no longer awaiting a decision');

      const to = input.decision === 'approve' ? 'active' : 'rejected';
      assertCheck(checkStatusChange({ from: 'applicant', to, initiatedBy: 'admin', reason: input.reason }));
      await this.changeStatus(tx, {
        accountId: application.accountId,
        current,
        to,
        actor,
        reason: input.reason,
        applicationId,
      });
      const decided: ApplicationRecord = {
        ...application,
        status: input.decision === 'approve' ? 'approved' : 'rejected',
        decidedBy: actor,
        decidedAt: new Date().toISOString(),
        decisionReason: input.reason,
      };
      tx.set(ref, decided);
      return decided;
    });
  }

  /** Any other status change (suspend, reinstate, lapse…). Applications go through decideApplication. */
  async setStatus(ctx: RequestContext, accountId: string, input: MemberStatusInput): Promise<MemberRecord> {
    const actor = requireAccount(ctx);
    if (accountId === actor) throw new ForbiddenException('you cannot change your own membership status');
    if (input.to === 'applicant') throw new ConflictException('members re-apply themselves');
    return this.firebase.db.runTransaction(async (tx) => {
      const current = await this.readMember(tx, accountId);
      if (!current) throw new NotFoundException('no such member');
      if (current.status === 'applicant') throw new ConflictException('decide the pending application instead');
      assertCheck(checkStatusChange({ from: current.status, to: input.to, initiatedBy: 'admin', reason: input.reason }));
      return this.changeStatus(tx, { accountId, current, to: input.to, actor, reason: input.reason, applicationId: null });
    });
  }

  async listMembers(status: MemberStatus | undefined, after: string | undefined, limit: number): Promise<MemberRecord[]> {
    let query = this.firebase.db.collection(Collections.members).orderBy(FieldPath.documentId()).limit(limit);
    if (status) query = query.where('status', '==', status);
    if (after) query = query.startAfter(after);
    return (await query.get()).docs.map((d) => d.data() as MemberRecord);
  }

  async history(accountId: string): Promise<StatusHistoryRecord[]> {
    const snap = await this.firebase.db
      .collection(Collections.memberStatusHistory)
      .where('accountId', '==', accountId)
      .orderBy('ledgerSeq', 'desc')
      .limit(100)
      .get();
    return snap.docs.map((d) => d.data() as StatusHistoryRecord);
  }

  // --- internals --------------------------------------------------------------------------------------------

  private currentBylawsQuery() {
    return this.firebase.db.collection(Collections.bylawsVersions).orderBy('publishedAt', 'desc').limit(1);
  }

  private async readMember(tx: Transaction, accountId: string): Promise<MemberRecord | null> {
    const snap = await tx.get(this.firebase.db.collection(Collections.members).doc(accountId));
    return (snap.data() as MemberRecord | undefined) ?? null;
  }

  /**
   * The one way a member's status changes: ledger entry, member record and history entry in the same
   * transaction (design §5.1). Call after the transaction's other reads.
   */
  private async changeStatus(tx: Transaction, change: StatusChange): Promise<MemberRecord> {
    const from = change.current?.status ?? null;
    const [ledgerSeq] = await this.ledger.record(tx, [
      {
        type: 'member.status_changed',
        actor: change.actor,
        subject: change.accountId,
        payload: { from, to: change.to, reason: change.reason, applicationId: change.applicationId },
      },
    ]);
    const now = new Date().toISOString();
    const profile = change.profile ?? change.current;
    if (!profile) throw new Error('a first status change must carry profile fields');
    const member: MemberRecord = {
      accountId: change.accountId,
      status: change.to,
      legalName: profile.legalName,
      preferredName: profile.preferredName,
      state: profile.state,
      bylawsVersion: profile.bylawsVersion,
      memberSince: change.current?.memberSince ?? (change.to === 'active' ? now : null),
      statusChangedAt: now,
    };
    const history: StatusHistoryRecord = {
      accountId: change.accountId,
      from,
      to: change.to,
      reason: change.reason,
      actor: change.actor,
      at: now,
      ledgerSeq: ledgerSeq!,
      applicationId: change.applicationId,
    };
    const db = this.firebase.db;
    tx.set(db.collection(Collections.members).doc(change.accountId), member);
    tx.create(db.collection(Collections.memberStatusHistory).doc(), history);
    return member;
  }
}
