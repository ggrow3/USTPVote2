import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { ContestSpec } from 'ustp-tally';
import {
  amendingContests,
  amendmentProblems,
  applyAmendment,
  APPROVAL_MAX_AUTH_AGE_SECONDS,
  checkElectionDeletable,
  Collections,
  definitionHash,
  ElectionCollections,
  electionTransitionAuthority,
  PROBLEM_TYPES,
  proposalContentHash,
  resultsSummary,
  rollMerkleRoot,
  sortRoll,
  uuidv7,
  validateDefinition,
  type ApprovalRequestRecord,
  type CancelPayload,
  type CertifyPayload,
  type CandidateInput,
  type CandidateRecord,
  type ContestInput,
  type ContestRecord,
  type CreateElectionInput,
  type ElectionDetail,
  type ElectionRecord,
  type ProposalInput,
  type ProposalSnapshotRecord,
  type ResultsRecord,
  type PersonaRecord,
  type RollApprovalPayload,
  type RollCriteria,
  type RollRequestInput,
  type RollSnapshotRecord,
  type RollView,
  type SchedulePayload,
  type UpdateElectionInput,
} from 'ustp-domain';
import { ApprovalsService } from '../administration/approvals.service.js';
import { requireAccount } from '../auth/decorators.js';
import { actorOf, type RequestContext } from '../auth/principal.js';
import { assertCheck } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { SECRET_STORE, type SecretStore } from '../infra/secret-store.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { MembershipService } from '../membership/membership.service.js';
import { ElectionReader } from './election-reader.js';

/**
 * Election setup (design §6): drafts are freely editable by Election Admins until scheduling, a two-person action
 * that freezes the definition by its hash. An Election Admin who is a candidate may not act on that election (Q12).
 */
@Injectable()
export class ElectionsService {
  private readonly logger = new Logger(ElectionsService.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly approvals: ApprovalsService,
    private readonly reader: ElectionReader,
    private readonly membership: MembershipService,
    private readonly members: MemberDirectory,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  // --- proposals --------------------------------------------------------------------------------------------

  /**
   * Captures a proposal text. A bylaws amendment (design §6.6) must be written against the current version and fit it
   * line for line; its lines are part of the content hash.
   */
  async createProposal(ctx: RequestContext, input: ProposalInput): Promise<ProposalSnapshotRecord> {
    const capturedBy = requireAccount(ctx);
    const ref = this.db.collection(Collections.proposalSnapshots).doc();
    const amendment = input.amendment ?? null;
    const record: ProposalSnapshotRecord = {
      snapshotId: ref.id,
      title: input.title,
      body: input.body,
      source: input.source || null,
      ...(amendment && { amendment }),
      contentHash: proposalContentHash(input.title, input.body, amendment),
      capturedAt: new Date().toISOString(),
      capturedBy,
    };
    if (!amendment) {
      await ref.create(record);
      return record;
    }
    return this.db.runTransaction(async (tx) => {
      const [base, current] = await Promise.all([
        this.membership.bylawsRecord(amendment.base.version, tx),
        this.membership.currentBylaws(tx),
      ]);
      if (!base) throw new BadRequestException(`there is no bylaws version ${amendment.base.version}`);
      if (!current || current.version !== base.version) {
        throw new ConflictException(`version ${base.version} is no longer the current bylaws; write the amendment against version ${current?.version}`);
      }
      const applied = applyAmendment(base, amendment);
      if (!applied.ok) throw new BadRequestException(`the amendment does not fit version ${base.version}: ${applied.problems.join('; ')}`);
      tx.create(ref, record);
      return record;
    });
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
      poolKeyVersion: null,
      openedAt: null,
      closedAt: null,
      sealedAt: null,
      certifiedAt: null,
      poolKeyDestroyedAt: null,
    };
    await this.db.collection(Collections.elections).doc(record.electionId).create(record);
    return record;
  }

  async list(): Promise<ElectionRecord[]> {
    const snap = await this.db.collection(Collections.elections).orderBy('createdAt', 'desc').limit(100).get();
    return snap.docs.map((d) => d.data() as ElectionRecord);
  }

  async detail(electionId: string): Promise<ElectionDetail> {
    const [loaded, roll, pending, resultsSnap] = await Promise.all([
      this.reader.load(electionId),
      this.latestRoll(electionId),
      this.db
        .collection(Collections.approvalRequests)
        .where('subject', '==', electionId)
        .where('status', '==', 'pending')
        .get(),
      this.db.collection(Collections.results).doc(electionId).get(),
    ]);
    const { election, contests, candidates, proposals, definition } = loaded;
    const results = resultsSnap.data() as ResultsRecord | undefined;
    const ballotsCast =
      election.state === 'cancelled'
        ? (await this.electionRef(electionId).collection(ElectionCollections.participation).count().get()).data().count
        : null;
    return {
      results: results ? resultsSummary(results) : null,
      ballotsCast,
      election,
      contests,
      candidates,
      proposals,
      definitionHash: definitionHash(definition),
      problems:
        election.state === 'draft'
          ? [...validateDefinition(definition), ...amendmentProblems(amendingContests(definition, proposals), await this.membership.currentBylaws())]
          : [],
      roll: roll && withoutList(roll),
      pending: pending.docs.map((d) => d.data() as ApprovalRequestRecord),
    };
  }

  // --- roll, scheduling, cancellation (design §6.1, §6.3) ----------------------------------------------------

  /**
   * Snapshots every Active member now and asks an Auditor to approve the resulting roll. In testing mode a rehearsal
   * roll (`voters: 'test_voters'`, design §10.4) holds only the Active test voter personas, and says so in its criteria.
   */
  async requestRoll(
    ctx: RequestContext,
    electionId: string,
    reason: string,
    voters: RollRequestInput['voters'] = 'members',
  ): Promise<Omit<RollSnapshotRecord, 'accountIds'>> {
    const requestedBy = requireAccount(ctx);
    this.approvals.assertCanRequest(ctx, 'roll.approve');
    if (voters === 'test_voters' && !this.config.testingMode) {
      throw new ForbiddenException('a rehearsal roll needs testing mode, which is off on this deployment');
    }
    return this.db.runTransaction(async (tx) => {
      await this.editable(tx, ctx, electionId);
      let accountIds = sortRoll(await this.members.activeIds(tx));
      let criteria: RollCriteria = { status: 'active' };
      if (voters === 'test_voters') {
        const personas = await tx.get(this.db.collection(Collections.testingPersonas).where('kind', '==', 'voter'));
        const testVoters = new Set(personas.docs.map((d) => (d.data() as PersonaRecord).accountId));
        accountIds = accountIds.filter((id) => testVoters.has(id));
        if (accountIds.length === 0) throw new ConflictException('there are no Active test voters; add them under Admin → Testing');
        criteria = { status: 'active', testVotersOnly: true };
      } else if (accountIds.length === 0) {
        throw new ConflictException('there are no Active members to put on the roll');
      }
      const merkleRoot = rollMerkleRoot(electionId, accountIds);
      const snapshotRef = this.db.collection(Collections.eligibilitySnapshots).doc();
      const approvalId = this.approvals.allocateId();
      const payload: RollApprovalPayload = {
        electionId,
        snapshotId: snapshotRef.id,
        merkleRoot,
        count: accountIds.length,
        ...(voters === 'test_voters' && { criteria }),
      };
      await this.approvals.createRequest(tx, { id: approvalId, action: 'roll.approve', subject: electionId, payload, reason, requestedBy });
      const snapshot: RollSnapshotRecord = {
        snapshotId: snapshotRef.id,
        electionId,
        criteria,
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
        signature: null,
      };
      tx.create(snapshotRef, snapshot);
      return withoutList(snapshot);
    });
  }

  /** The latest roll with names, for the Auditor deciding whether to approve it. */
  async roll(electionId: string): Promise<RollView> {
    const snapshot = await this.latestRoll(electionId);
    if (!snapshot) throw new NotFoundException('no voter roll yet');
    const members = await this.members.findMany(snapshot.accountIds);
    const entries = snapshot.accountIds.map((accountId, i) => ({
      accountId,
      legalName: members[i]?.legalName ?? '(no member record)',
      state: members[i]?.state ?? '',
    }));
    return { snapshot: withoutList(snapshot), entries };
  }

  /** Asks an Auditor to freeze exactly the current definition and approved roll. */
  async requestSchedule(ctx: RequestContext, electionId: string, reason: string): Promise<ApprovalRequestRecord> {
    const requestedBy = requireAccount(ctx);
    this.approvals.assertCanRequest(ctx, 'election.schedule');
    return this.db.runTransaction(async (tx) => {
      await this.editable(tx, ctx, electionId);
      const { election, definition, proposals } = await this.reader.load(electionId, tx);
      const current = await this.membership.currentBylaws(tx);
      const problems = [...validateDefinition(definition), ...amendmentProblems(amendingContests(definition, proposals), current)];
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

  /**
   * Asks an Auditor to certify exactly the provisional results computed for a closed election (design §6.1, §9). The
   * offices its contests fill must exist, or certification could not create their terms.
   */
  async requestCertify(ctx: RequestContext, electionId: string, reason: string): Promise<ApprovalRequestRecord> {
    const requestedBy = requireAccount(ctx);
    this.approvals.assertCanRequest(ctx, 'election.certify');
    return this.db.runTransaction(async (tx) => {
      const { election, definition } = await this.reader.load(electionId, tx);
      if (election.state !== 'closed') throw new ConflictException(`the election is ${election.state}; only closed elections are certified`);
      if (await this.reader.isCandidate(tx, electionId, requestedBy)) {
        throw new ForbiddenException('you are a candidate in this election, so you cannot administer it');
      }
      const results = (await tx.get(this.db.collection(Collections.results).doc(electionId))).data() as ResultsRecord | undefined;
      if (!results) throw new ConflictException('the results have not been computed yet; they follow within a minute of sealing');
      if (results.status !== 'provisional') throw new ConflictException('the results are already certified');
      const offices = [...new Set(definition.contests.map((c) => c.positionId).filter((id): id is string => !!id))];
      for (const id of offices) {
        if (!(await tx.get(this.db.collection(Collections.positions).doc(id))).exists) {
          throw new ConflictException(`the office ${id} this election fills does not exist; define it first`);
        }
      }
      const payload: CertifyPayload = { electionId, resultsHash: results.resultsHash };
      return this.approvals.createRequest(tx, { action: 'election.certify', subject: electionId, payload, reason, requestedBy });
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

  /**
   * Deletes a cancelled election nobody voted in, permanently (design §6.1): the election and everything stored under
   * it, its voter rolls, any request about it still pending, and its tie-break seed. One Election Admin does it at
   * once, signed in within the last 15 minutes. The ledger keeps every entry about the election and records this one.
   */
  async delete(ctx: RequestContext, electionId: string, reason: string): Promise<void> {
    const actor = actorOf(ctx, this.config.adminMfaRequired);
    if (actor.authAgeSeconds > APPROVAL_MAX_AUTH_AGE_SECONDS) {
      throw new ForbiddenException({ message: 'sign in again to delete an election', type: PROBLEM_TYPES.reauthRequired });
    }
    const ref = this.electionRef(electionId);
    const seedRef = await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundException('no such election');
      const election = snap.data() as ElectionRecord;
      if (await this.reader.isCandidate(tx, electionId, actor.accountId)) {
        throw new ForbiddenException('you are a candidate in this election, so you cannot administer it');
      }
      const ballots = (await tx.get(ref.collection(ElectionCollections.participation).count())).data().count;
      assertCheck(checkElectionDeletable(election, ballots));
      const [children, rolls, pending] = await Promise.all([
        Promise.all(Object.values(ElectionCollections).map((c) => tx.get(ref.collection(c)))),
        tx.get(this.db.collection(Collections.eligibilitySnapshots).where('electionId', '==', electionId)),
        tx.get(this.db.collection(Collections.approvalRequests).where('subject', '==', electionId).where('status', '==', 'pending')),
      ]);
      await this.ledger.record(tx, [
        { type: 'election.deleted', actor: actor.accountId, subject: electionId, payload: { electionId, title: election.title, reason } },
      ]);
      for (const doc of [...children.flatMap((s) => s.docs), ...rolls.docs, ...pending.docs]) tx.delete(doc.ref);
      tx.delete(ref);
      return election.tieBreakSeedRef;
    });
    // Secret Manager is not transactional. The seed of a cancelled election is never read, so a failure here leaves an
    // unused secret behind rather than failing a deletion that has already happened.
    if (seedRef) {
      await this.secrets.delete(seedRef).catch((e: unknown) => {
        this.logger.warn(`election ${electionId} deleted, but not its tie-break seed ${seedRef}: ${e instanceof Error ? e.message : String(e)}`);
      });
    }
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
      else if (input.positionId) await this.assertPositionExists(tx, input.positionId);
      const ref = this.electionRef(electionId).collection(ElectionCollections.contests).doc();
      const order = Math.max(0, ...contests.docs.map((d) => (d.data() as ContestRecord).order)) + 1;
      const record = contestRecord(ref.id, order, input, []);
      await this.assertAmendmentsFit(tx, contests.docs.map((d) => d.data() as ContestRecord), record);
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
      else if (input.positionId) await this.assertPositionExists(tx, input.positionId);
      const record = contestRecord(contestId, current.order, input, [...candidateIds]);
      const others = await tx.get(this.electionRef(electionId).collection(ElectionCollections.contests));
      await this.assertAmendmentsFit(tx, others.docs.map((d) => d.data() as ContestRecord), record);
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

  /**
   * When `contest` puts a bylaws amendment to the vote, it and the election's other amendments must amend the current
   * version and must not conflict (design §6.6). Other contests are not checked here; the editor lists their problems.
   */
  private async assertAmendmentsFit(tx: Transaction, contests: readonly ContestRecord[], contest: ContestRecord): Promise<void> {
    if (!contest.proposalSnapshotId) return;
    const all = [...contests.filter((c) => c.contestId !== contest.contestId), contest];
    const ids = [...new Set(all.map((c) => c.proposalSnapshotId).filter((id): id is string => !!id))];
    const refs = ids.map((id) => this.db.collection(Collections.proposalSnapshots).doc(id));
    const proposals = (await tx.getAll(...refs)).map((s) => s.data() as ProposalSnapshotRecord);
    const amendmentOf = (c: ContestRecord) => proposals.find((p) => p.snapshotId === c.proposalSnapshotId)?.amendment ?? null;
    if (!amendmentOf(contest)) return;
    const amending = all.flatMap((c) => {
      const amendment = amendmentOf(c);
      return amendment ? [{ contestId: c.contestId, title: c.title, amendment }] : [];
    });
    const problems = amendmentProblems(amending, await this.membership.currentBylaws(tx));
    if (problems.length) throw new ConflictException(problems.join('; '));
  }

  private async assertPositionExists(tx: Transaction, positionId: string): Promise<void> {
    if (!(await tx.get(this.db.collection(Collections.positions).doc(positionId))).exists) {
      throw new BadRequestException('no such office');
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
    positionId: input.kind === 'proposal' ? null : (input.positionId ?? null),
  };
}
