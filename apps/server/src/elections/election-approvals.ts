import { randomBytes } from 'node:crypto';
import { ConflictException, ForbiddenException, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { seedCommitment } from 'ustp-audit';
import {
  Collections,
  definitionHash,
  electionTransitionAuthority,
  validateDefinition,
  type Actor,
  type ApprovalRequestRecord,
  type CancelPayload,
  type ElectionRecord,
  type RollApprovalPayload,
  type RollSnapshotRecord,
  type SchedulePayload,
} from 'ustp-domain';
import type { ApprovalHandler, PreparedDecision } from '../administration/approval-handler.js';
import { NO_EFFECT } from '../administration/approval-handler.js';
import { Firebase } from '../infra/firebase.js';
import { SECRET_STORE, type SecretStore } from '../infra/secret-store.js';
import { ElectionReader } from './election-reader.js';

interface PreparedSeed {
  readonly seedRef: string;
  readonly commitment: string;
}

/**
 * Executes the two-person election actions (design §6.1, §6.3, §10.2): approving a voter roll, scheduling (which
 * freezes the definition and commits to the tie-break seed) and cancelling a scheduled or open election.
 */
@Injectable()
export class ElectionApprovals implements ApprovalHandler {
  constructor(
    private readonly firebase: Firebase,
    private readonly reader: ElectionReader,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
  ) {}

  /**
   * Scheduling: generate the tie-break seed and store it secretly before the transaction (Secret Manager is not
   * transactional). Each attempt gets its own secret; the election records the one it committed to.
   */
  async beforeApprove(request: ApprovalRequestRecord): Promise<PreparedSeed | undefined> {
    if (request.action !== 'election.schedule') return undefined;
    const { electionId } = request.payload as unknown as SchedulePayload;
    const seed = randomBytes(32).toString('hex');
    const seedRef = await this.secrets.create(`tiebreak-seed-${electionId}`, seed);
    return { seedRef, commitment: seedCommitment(seed) };
  }

  async approve(tx: Transaction, request: ApprovalRequestRecord, approver: Actor, prepared: unknown): Promise<PreparedDecision> {
    switch (request.action) {
      case 'roll.approve':
        return this.approveRoll(tx, request, approver);
      case 'election.schedule':
        if (!prepared) throw new InternalServerErrorException('scheduling needs a prepared seed');
        return this.approveSchedule(tx, request, approver, prepared as PreparedSeed);
      case 'election.cancel':
        return this.approveCancel(tx, request, approver);
      default:
        throw new ConflictException(`${request.action} is not an election action`);
    }
  }

  async reject(tx: Transaction, request: ApprovalRequestRecord): Promise<PreparedDecision> {
    if (request.action !== 'roll.approve') return NO_EFFECT;
    const { snapshotId } = request.payload as unknown as RollApprovalPayload;
    const ref = this.snapshotRef(snapshotId);
    const snapshot = (await tx.get(ref)).data() as RollSnapshotRecord | undefined;
    if (snapshot?.status !== 'pending') return NO_EFFECT;
    return { events: [], apply: () => tx.update(ref, { status: 'rejected', decidedAt: new Date().toISOString() }) };
  }

  private async approveRoll(tx: Transaction, request: ApprovalRequestRecord, approver: Actor): Promise<PreparedDecision> {
    const payload = request.payload as unknown as RollApprovalPayload;
    const election = await this.election(tx, payload.electionId);
    if (election.state !== 'draft') throw new ConflictException('the roll can only change while the election is a draft');
    const ref = this.snapshotRef(payload.snapshotId);
    const snapshot = (await tx.get(ref)).data() as RollSnapshotRecord | undefined;
    if (
      snapshot?.status !== 'pending' ||
      snapshot.electionId !== payload.electionId ||
      snapshot.merkleRoot !== payload.merkleRoot ||
      snapshot.count !== payload.count
    ) {
      throw new ConflictException('the roll no longer matches what was requested');
    }
    await this.assertNotCandidate(tx, payload.electionId, approver.accountId);
    const previous = election.rollSnapshotId && election.rollSnapshotId !== snapshot.snapshotId ? election.rollSnapshotId : null;
    const now = new Date().toISOString();
    return {
      events: [
        {
          type: 'roll.approved',
          actor: approver.accountId,
          subject: payload.electionId,
          payload: { ...payload, asOf: snapshot.asOf, approvalId: request.id },
        },
      ],
      apply: () => {
        tx.update(ref, { status: 'approved', decidedBy: approver.accountId, decidedAt: now });
        if (previous) tx.update(this.snapshotRef(previous), { status: 'superseded' });
        tx.update(this.electionRef(payload.electionId), { rollSnapshotId: snapshot.snapshotId, updatedAt: now });
      },
    };
  }

  private async approveSchedule(
    tx: Transaction,
    request: ApprovalRequestRecord,
    approver: Actor,
    seed: PreparedSeed,
  ): Promise<PreparedDecision> {
    const payload = request.payload as unknown as SchedulePayload;
    const { election, definition } = await this.reader.load(payload.electionId, tx);
    if (election.state !== 'draft') throw new ConflictException(`the election is already ${election.state}`);
    if (definitionHash(definition) !== payload.definitionHash) {
      throw new ConflictException('the election changed after scheduling was requested; request scheduling again');
    }
    const problems = validateDefinition(definition);
    if (problems.length) throw new ConflictException(`not ready to schedule: ${problems.join('; ')}`);
    if (election.rollSnapshotId !== payload.rollSnapshotId) throw new ConflictException('the voter roll changed since the request');
    const roll = (await tx.get(this.snapshotRef(payload.rollSnapshotId))).data() as RollSnapshotRecord | undefined;
    if (roll?.status !== 'approved' || roll.merkleRoot !== payload.rollMerkleRoot) {
      throw new ConflictException('the voter roll is no longer approved');
    }
    await this.assertNotCandidate(tx, payload.electionId, approver.accountId);
    const now = new Date().toISOString();
    return {
      events: [
        {
          type: 'election.scheduled',
          actor: approver.accountId,
          subject: payload.electionId,
          payload: {
            ...payload,
            rollCount: roll.count,
            tieBreakSeedCommitment: seed.commitment,
            opensAt: election.opensAt,
            closesAt: election.closesAt,
            approvalId: request.id,
          },
        },
      ],
      apply: () =>
        tx.update(this.electionRef(payload.electionId), {
          state: 'scheduled',
          definitionHash: payload.definitionHash,
          tieBreakSeedCommitment: seed.commitment,
          tieBreakSeedRef: seed.seedRef,
          scheduledAt: now,
          updatedAt: now,
        }),
    };
  }

  private async approveCancel(tx: Transaction, request: ApprovalRequestRecord, approver: Actor): Promise<PreparedDecision> {
    const payload = request.payload as unknown as CancelPayload;
    const election = await this.election(tx, payload.electionId);
    if (election.state !== payload.fromState || electionTransitionAuthority(election.state, 'cancelled') !== 'two_person') {
      throw new ConflictException(`the election is now ${election.state}; request cancellation again if still needed`);
    }
    await this.assertNotCandidate(tx, payload.electionId, approver.accountId);
    const now = new Date().toISOString();
    return {
      events: [
        {
          type: 'election.cancelled',
          actor: approver.accountId,
          subject: payload.electionId,
          payload: { ...payload, approvalId: request.id, reason: request.reason },
        },
      ],
      apply: () => tx.update(this.electionRef(payload.electionId), { state: 'cancelled', cancelledAt: now, updatedAt: now }),
    };
  }

  private async election(tx: Transaction, electionId: string): Promise<ElectionRecord> {
    const snap = await tx.get(this.electionRef(electionId));
    if (!snap.exists) throw new ConflictException('the election no longer exists');
    return snap.data() as ElectionRecord;
  }

  private async assertNotCandidate(tx: Transaction, electionId: string, accountId: string): Promise<void> {
    if (await this.reader.isCandidate(tx, electionId, accountId)) {
      throw new ForbiddenException('you are a candidate in this election, so you cannot decide this');
    }
  }

  private electionRef(electionId: string) {
    return this.firebase.db.collection(Collections.elections).doc(electionId);
  }

  private snapshotRef(snapshotId: string) {
    return this.firebase.db.collection(Collections.eligibilitySnapshots).doc(snapshotId);
  }
}
