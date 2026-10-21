import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { ContestSpec } from 'ustp-tally';
import {
  Collections,
  definitionHash,
  ElectionCollections,
  electionTransitionAuthority,
  proposalContentHash,
  rollMerkleRoot,
  sortRoll,
  uuidv7,
  validateDefinition,
  type ApprovalRequestRecord,
  type CancelPayload,
  type CandidateInput,
  type CandidateRecord,
  type ContestInput,
  type ContestRecord,
  type CreateElectionInput,
  type ElectionDetail,
  type ElectionRecord,
  type MemberRecord,
  type ProposalInput,
  type ProposalSnapshotRecord,
  type RollApprovalPayload,
  type RollSnapshotRecord,
  type RollView,
  type SchedulePayload,
  type UpdateElectionInput,
} from 'ustp-domain';
import { ApprovalsService } from '../administration/approvals.service.js';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ElectionReader } from './election-reader.js';

/**
 * Election setup (design §6): drafts are freely editable by Election Admins until scheduling, a two-person action
 * that freezes the definition by its hash. An Election Admin who is a candidate may not act on that election (Q12).
 */
@Injectable()
export class ElectionsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly approvals: ApprovalsService,
    private readonly reader: ElectionReader,
  ) {}

  // --- proposals --------------------------------------------------------------------------------------------

  async createProposal(ctx: RequestContext, input: ProposalInput): Promise<ProposalSnapshotRecord> {
    const ref = this.db.collection(Collections.proposalSnapshots).doc();
    const record: ProposalSnapshotRecord = {
      snapshotId: ref.id,
      title: input.title,
      body: input.body,
      source: input.source || null,
      contentHash: proposalContentHash(input.title, input.body),
      capturedAt: new Date().toISOString(),
      capturedBy: requireAccount(ctx),
    };
    await ref.create(record);
    return record;
  }

  async listProposals(): Promise<ProposalSnapshotRecord[]> {
    const snap = await this.db.collection(Collections.proposalSnapshots).orderBy('capturedAt', 'desc').limit(200).get();
    return snap.docs.map((d) => d.data() as ProposalSnapshotRecord);
  }

  // --- elections --------------------------------------------------------------------------------------------

  async create(ctx: RequestContext, input: CreateElectionInput): Promise<ElectionRecord> {
    assertWindow(input.opensAt, input.closesAt);
    const now = new Date().toISOString();
    const record: ElectionRecord = {
      electionId: uuidv7(),
      title: input.title,
      description: input.description,
      secrecy: input.secrecy,
      opensAt: input.opensAt,
      closesAt: input.closesAt,
      kAnonymity: input.kAnonymity,
      state: 'draft',
      createdBy: requireAccount(ctx),
      createdAt: now,
      updatedAt: now,
      definitionHash: null,
      rollSnapshotId: null,
      tieBreakSeedCommitment: null,
      tieBreakSeedRef: null,
      scheduledAt: null,
      cancelledAt: null,
    };
    await this.db.collection(Collections.elections).doc(record.electionId).create(record);
    return record;
  }

  async list(): Promise<ElectionRecord[]> {
    const snap = await this.db.collection(Collections.elections).orderBy('createdAt', 'desc').limit(100).get();
    return snap.docs.map((d) => d.data() as ElectionRecord);
  }

  async detail(electionId: string): Promise<ElectionDetail> {
    const [loaded, roll, pending] = await Promise.all([
      this.reader.load(electionId),
      this.latestRoll(electionId),
      this.db
        .collection(Collections.approvalRequests)
        .where('subject', '==', electionId)
        .where('status', '==', 'pending')
        .get(),
    ]);
    const { election, contests, candidates, proposals, definition } = loaded;
    return {
      election,
      contests,
      candidates,
      proposals,
      definitionHash: definitionHash(definition),
      problems: election.state === 'draft' ? validateDefinition(definition) : [],
      roll: roll && withoutList(roll),
      pending: pending.docs.map((d) => d.data() as ApprovalRequestRecord),
    };
  }

  // --- roll, scheduling, cancellation (design §6.1, §6.3) ----------------------------------------------------

  /** Snapshots every Active member now and asks an Auditor to approve the resulting roll. */
  async requestRoll(ctx: RequestContext, electionId: string, reason: string): Promise<Omit<RollSnapshotRecord, 'accountIds'>> {
    const requestedBy = requireAccount(ctx);
    this.approvals.assertCanRequest(ctx, 'roll.approve');
    return this.db.runTransaction(async (tx) => {
      await this.editable(tx, ctx, electionId);
      const active = await tx.get(this.db.collection(Collections.members).where('status', '==', 'active'));
      const accountIds = sortRoll(active.docs.map((d) => d.id));
      if (accountIds.length === 0) throw new ConflictException('there are no Active members to put on the roll');
      const merkleRoot = rollMerkleRoot(electionId, accountIds);
      const snapshotRef = this.db.collection(Collections.eligibilitySnapshots).doc();
      const approvalId = this.approvals.allocateId();
      const payload: RollApprovalPayload = { electionId, snapshotId: snapshotRef.id, merkleRoot, count: accountIds.length };
      await this.approvals.createRequest(tx, { id: approvalId, action: 'roll.approve', subject: electionId, payload, reason, requestedBy });
      const snapshot: RollSnapshotRecord = {
        snapshotId: snapshotRef.id,
        electionId,
        criteria: { status: 'active' },
        asOf: new Date().toISOString(),
        accountIds,
        count: accountIds.length,
        merkleRoot,
        status: 'pending',
        requestedBy,
        requestedAt: new Date().toISOString(),
        approvalId,
        decidedBy: null,
        decidedAt: null,
      };
      tx.create(snapshotRef, snapshot);
      return withoutList(snapshot);
    });
  }

  /** The latest roll with names, for the Auditor deciding whether to approve it. */
  async roll(electionId: string): Promise<RollView> {
    const snapshot = await this.latestRoll(electionId);
    if (!snapshot) throw new NotFoundException('no voter roll yet');
    const entries: { accountId: string; legalName: string; state: string }[] = [];
    for (let i = 0; i < snapshot.accountIds.length; i += 300) {
      const refs = snapshot.accountIds.slice(i, i + 300).map((id) => this.db.collection(Collections.members).doc(id));
      for (const s of await this.db.getAll(...refs)) {
        const m = s.data() as MemberRecord | undefined;
        entries.push({ accountId: s.id, legalName: m?.legalName ?? '(no member record)', state: m?.state ?? '' });
      }
    }
    return { snapshot: withoutList(snapshot), entries };
  }

  /** Asks an Auditor to freeze exactly the current definition and approved roll. */
  async requestSchedule(ctx: RequestContext, electionId: string, reason: string): Promise<ApprovalRequestRecord> {
    const requestedBy = requireAccount(ctx);
    this.approvals.assertCanRequest(ctx, 'election.schedule');
    return this.db.runTransaction(async (tx) => {
      await this.editable(tx, ctx, electionId);
      const { election, definition } = await this.reader.load(electionId, tx);
      const problems = validateDefinition(definition);
      if (problems.length) throw new ConflictException(`not ready to schedule: ${problems.join('; ')}`);
      if (!election.rollSnapshotId) throw new ConflictException('get a voter roll approved first');
      const roll = (await tx.get(this.db.collection(Collections.eligibilitySnapshots).doc(election.rollSnapshotId))).data() as
        | RollSnapshotRecord
        | undefined;
      if (roll?.status !== 'approved') throw new ConflictException('get a voter roll approved first');
      const payload: SchedulePayload = {
        electionId,
        definitionHash: definitionHash(definition),
        rollSnapshotId: roll.snapshotId,
        rollMerkleRoot: roll.merkleRoot,
      };
      return this.approvals.createRequest(tx, { action: 'election.schedule', subject: electionId, payload, reason, requestedBy });
    });
  }

  /** A draft is cancelled at once; a scheduled or open election needs an Auditor's approval. */
  async cancel(
    ctx: RequestContext,
    electionId: string,
    reason: string,
  ): Promise<{ readonly cancelled: boolean; readonly request: ApprovalRequestRecord | null }> {
    const actor = requireAccount(ctx);
    const current = (await this.electionRef(electionId).get()).data() as ElectionRecord | undefined;
    if (!current) throw new NotFoundException('no such election');
    const authority = electionTransitionAuthority(current.state, 'cancelled');
    if (!authority || authority === 'system') throw new ConflictException(`a ${current.state} election cannot be cancelled`);

    if (authority === 'single') {
      await this.db.runTransaction(async (tx) => {
        await this.editable(tx, ctx, electionId);
        await this.ledger.record(tx, [
          { type: 'election.cancelled', actor, subject: electionId, payload: { electionId, fromState: 'draft', reason } },
        ]);
        const now = new Date().toISOString();
        tx.update(this.electionRef(electionId), { state: 'cancelled', cancelledAt: now, updatedAt: now });
      });
      return { cancelled: true, request: null };
    }

    this.approvals.assertCanRequest(ctx, 'election.cancel');
    const request = await this.db.runTransaction(async (tx) => {
      const election = (await tx.get(this.electionRef(electionId))).data() as ElectionRecord;
      if (election.state !== current.state) throw new ConflictException('the election changed state; try again');
      if (await this.reader.isCandidate(tx, electionId, actor)) {
        throw new ForbiddenException('you are a candidate in this election, so you cannot administer it');
      }
      const payload: CancelPayload = { electionId, fromState: election.state };
      return this.approvals.createRequest(tx, { action: 'election.cancel', subject: electionId, payload, reason, requestedBy: actor });
    });
    return { cancelled: false, request };
  }

  private async latestRoll(electionId: string): Promise<RollSnapshotRecord | null> {
    const snap = await this.db
      .collection(Collections.eligibilitySnapshots)
      .where('electionId', '==', electionId)
      .orderBy('requestedAt', 'desc')
      .limit(1)
      .get();
    return (snap.docs[0]?.data() as RollSnapshotRecord | undefined) ?? null;
  }

  async update(ctx: RequestContext, electionId: string, input: UpdateElectionInput): Promise<ElectionRecord> {
    return this.db.runTransaction(async (tx) => {
      const election = await this.editable(tx, ctx, electionId);
      const next: ElectionRecord = { ...election, ...input, updatedAt: new Date().toISOString() };
      assertWindow(next.opensAt, next.closesAt);
      tx.set(this.electionRef(electionId), next);
      return next;
    });
  }

  // --- contests ---------------------------------------------------------------------------------------------

  async addContest(ctx: RequestContext, electionId: string, input: ContestInput): Promise<ContestRecord> {
    return this.db.runTransaction(async (tx) => {
      await this.editable(tx, ctx, electionId);
      const contests = await tx.get(this.electionRef(electionId).collection(ElectionCollections.contests));
      if (input.kind === 'proposal') await this.assertProposalExists(tx, input.proposalSnapshotId);
      const ref = this.electionRef(electionId).collection(ElectionCollections.contests).doc();
      const order = Math.max(0, ...contests.docs.map((d) => (d.data() as ContestRecord).order)) + 1;
      const record = contestRecord(ref.id, order, input, []);
      tx.create(ref, record);
      return record;
    });
  }

  async updateContest(ctx: RequestContext, electionId: string, contestId: string, input: ContestInput): Promise<ContestRecord> {
    return this.db.runTransaction(async (tx) => {
      await this.editable(tx, ctx, electionId);
      const ref = this.electionRef(electionId).collection(ElectionCollections.contests).doc(contestId);
      const current = await this.contest(tx, ref);
      const candidateIds = current.spec.kind === 'proposal' ? [] : current.spec.candidates;
      if (input.kind === 'proposal' && candidateIds.length > 0) {
        throw new ConflictException('remove the candidates before turning this into a proposal contest');
      }
      if (input.kind === 'proposal') await this.assertProposalExists(tx, input.proposalSnapshotId);
      const record = contestRecord(contestId, current.order, input, [...candidateIds]);
      tx.set(ref, record);
      return record;
    });
  }

  async removeContest(ctx: RequestContext, electionId: string, contestId: string): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      await this.editable(tx, ctx, electionId);
      const ref = this.electionRef(electionId).collection(ElectionCollections.contests).doc(contestId);
      await this.contest(tx, ref);
      const candidates = await tx.get(
        this.electionRef(electionId).collection(ElectionCollections.candidates).where('contestId', '==', contestId),
      );
      candidates.docs.forEach((d) => tx.delete(d.ref));
      tx.delete(ref);
    });
  }

  // --- candidates -------------------------------------------------------------------------------------------

  async addCandidate(ctx: RequestContext, electionId: string, contestId: string, input: CandidateInput): Promise<CandidateRecord> {
    const actor = requireAccount(ctx);
    if (input.accountId === actor) throw new ForbiddenException('you cannot add yourself as a candidate in an election you administer');
    return this.db.runTransaction(async (tx) => {
      await this.editable(tx, ctx, electionId);
      const contestRef = this.electionRef(electionId).collection(ElectionCollections.contests).doc(contestId);
      const contest = await this.contest(tx, contestRef);
      if (contest.spec.kind === 'proposal') throw new ConflictException('proposal contests have no candidates');
      if (input.accountId && !(await tx.get(this.db.collection(Collections.accounts).doc(input.accountId))).exists) {
        throw new BadRequestException('no account with that ID');
      }
      const ref = this.electionRef(electionId).collection(ElectionCollections.candidates).doc();
      const record: CandidateRecord = {
        candidateId: ref.id,
        contestId,
        name: input.name,
        statement: input.statement || null,
        accountId: input.accountId ?? null,
      };
      tx.create(ref, record);
      tx.set(contestRef, { ...contest, spec: { ...contest.spec, candidates: [...contest.spec.candidates, ref.id] } });
      return record;
    });
  }

  async removeCandidate(ctx: RequestContext, electionId: string, contestId: string, candidateId: string): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      await this.editable(tx, ctx, electionId);
      const contestRef = this.electionRef(electionId).collection(ElectionCollections.contests).doc(contestId);
      const contest = await this.contest(tx, contestRef);
      const ref = this.electionRef(electionId).collection(ElectionCollections.candidates).doc(candidateId);
      const candidate = await tx.get(ref);
      if (!candidate.exists || (candidate.data() as CandidateRecord).contestId !== contestId || contest.spec.kind === 'proposal') {
        throw new NotFoundException('no such candidate in this contest');
      }
      tx.delete(ref);
      tx.set(contestRef, {
        ...contest,
        spec: { ...contest.spec, candidates: contest.spec.candidates.filter((id) => id !== candidateId) },
      });
    });
  }

  // --- internals --------------------------------------------------------------------------------------------

  private get db() {
    return this.firebase.db;
  }

  private electionRef(electionId: string) {
    return this.db.collection(Collections.elections).doc(electionId);
  }

  /** Reads the election inside `tx` and checks the caller may still edit it. */
  private async editable(tx: Transaction, ctx: RequestContext, electionId: string): Promise<ElectionRecord> {
    const actor = requireAccount(ctx);
    const snap = await tx.get(this.electionRef(electionId));
    if (!snap.exists) throw new NotFoundException('no such election');
    const election = snap.data() as ElectionRecord;
    if (election.state !== 'draft') throw new ConflictException(`the election is ${election.state}; only drafts can be edited`);
    if (await this.reader.isCandidate(tx, electionId, actor)) {
      throw new ForbiddenException('you are a candidate in this election, so you cannot administer it');
    }
    return election;
  }

  private async contest(tx: Transaction, ref: DocumentReference): Promise<ContestRecord> {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new NotFoundException('no such contest');
    return snap.data() as ContestRecord;
  }

  private async assertProposalExists(tx: Transaction, snapshotId: string): Promise<void> {
    if (!(await tx.get(this.db.collection(Collections.proposalSnapshots).doc(snapshotId))).exists) {
      throw new BadRequestException('no such proposal text');
    }
  }
}

function withoutList(snapshot: RollSnapshotRecord): Omit<RollSnapshotRecord, 'accountIds'> {
  const { accountIds: _list, ...rest } = snapshot;
  return rest;
}

function assertWindow(opensAt: string, closesAt: string): void {
  if (Date.parse(closesAt) <= Date.parse(opensAt)) throw new BadRequestException('voting must close after it opens');
}

/** Builds the stored contest, with a tally spec whose id is the contest id. */
function contestRecord(contestId: string, order: number, input: ContestInput, candidateIds: string[]): ContestRecord {
  let spec: ContestSpec;
  switch (input.kind) {
    case 'proposal':
      spec = { kind: 'proposal', id: contestId, passRule: input.passRule, ...(input.quorum && { quorum: input.quorum }) };
      break;
    case 'choose_n':
      spec = {
        kind: 'choose_n',
        id: contestId,
        candidates: candidateIds,
        seats: input.seats,
        maxSelections: input.maxSelections,
        ...(input.supportFloor && { supportFloor: input.supportFloor }),
      };
      break;
    case 'irv':
      spec = { kind: 'irv', id: contestId, candidates: candidateIds, ...(input.maxRanks !== undefined && { maxRanks: input.maxRanks }) };
      break;
  }
  return {
    contestId,
    order,
    title: input.title,
    description: input.description,
    spec,
    proposalSnapshotId: input.kind === 'proposal' ? input.proposalSnapshotId : null,
  };
}
