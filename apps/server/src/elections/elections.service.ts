import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { ContestSpec } from 'ustp-tally';
import {
  buildDefinition,
  Collections,
  definitionHash,
  ElectionCollections,
  proposalContentHash,
  uuidv7,
  validateDefinition,
  type CandidateInput,
  type CandidateRecord,
  type ContestInput,
  type ContestRecord,
  type CreateElectionInput,
  type ElectionDetail,
  type ElectionRecord,
  type ProposalInput,
  type ProposalSnapshotRecord,
  type UpdateElectionInput,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { Firebase } from '../infra/firebase.js';

/**
 * Election setup (design §6): drafts are freely editable by Election Admins; scheduling (M2b) freezes the
 * definition by its hash. An Election Admin who is a candidate may not edit that election (open question Q12).
 */
@Injectable()
export class ElectionsService {
  constructor(private readonly firebase: Firebase) {}

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
    };
    await this.db.collection(Collections.elections).doc(record.electionId).create(record);
    return record;
  }

  async list(): Promise<ElectionRecord[]> {
    const snap = await this.db.collection(Collections.elections).orderBy('createdAt', 'desc').limit(100).get();
    return snap.docs.map((d) => d.data() as ElectionRecord);
  }

  async detail(electionId: string): Promise<ElectionDetail> {
    const electionRef = this.electionRef(electionId);
    const [electionSnap, contestSnap, candidateSnap] = await Promise.all([
      electionRef.get(),
      electionRef.collection(ElectionCollections.contests).get(),
      electionRef.collection(ElectionCollections.candidates).get(),
    ]);
    if (!electionSnap.exists) throw new NotFoundException('no such election');
    const election = electionSnap.data() as ElectionRecord;
    const contests = contestSnap.docs.map((d) => d.data() as ContestRecord).sort((a, b) => a.order - b.order);
    const candidates = candidateSnap.docs.map((d) => d.data() as CandidateRecord);
    const snapshotIds = [...new Set(contests.map((c) => c.proposalSnapshotId).filter((id): id is string => !!id))];
    const proposals = snapshotIds.length
      ? (await this.db.getAll(...snapshotIds.map((id) => this.db.collection(Collections.proposalSnapshots).doc(id))))
          .filter((s) => s.exists)
          .map((s) => s.data() as ProposalSnapshotRecord)
      : [];
    const definition = buildDefinition(election, contests, candidates, proposals);
    return {
      election,
      contests,
      candidates,
      proposals,
      definitionHash: definitionHash(definition),
      problems: validateDefinition(definition),
    };
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
    const standing = await tx.get(
      this.electionRef(electionId).collection(ElectionCollections.candidates).where('accountId', '==', actor).limit(1),
    );
    if (!standing.empty) throw new ForbiddenException('you are a candidate in this election, so you cannot administer it');
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
