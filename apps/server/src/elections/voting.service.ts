import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { canonicalBytes, type BallotPart } from 'ustp-audit';
import {
  ballotProblems,
  Collections,
  commitmentsOf,
  definitionHash,
  ElectionCollections,
  type BallotView,
  type CastBallotInput,
  type CastResult,
  type ElectionRecord,
  type ElectionState,
  type ParticipationRecord,
  type RollSnapshotRecord,
  type VoterElection,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { BALLOT_POOL_KEYS, encryptBallot, type BallotPoolKeys } from '../infra/ballot-pool.js';
import { Firebase } from '../infra/firebase.js';
import { ElectionReader } from './election-reader.js';

/** States in which voters on the roll can see an election. */
const VISIBLE: readonly ElectionState[] = ['scheduled', 'open', 'closed', 'certified'];

/**
 * Voting (design §7.1, §7.4): what a voter on the roll sees, and casting. The definition and roll are frozen from
 * scheduling on, so they are read outside the cast transaction; the transaction re-reads the election (no ballot is
 * accepted once a close commits) and creates the participation record, which makes a second ballot fail.
 */
@Injectable()
export class VotingService {
  /** Approved rolls never change, so each is read once per instance (design §6.3). */
  private readonly rolls = new Map<string, Promise<ReadonlySet<string>>>();

  constructor(
    private readonly firebase: Firebase,
    private readonly reader: ElectionReader,
    @Inject(BALLOT_POOL_KEYS) private readonly keys: BallotPoolKeys,
  ) {}

  /** Elections the caller is on the roll for, soonest first. */
  async myElections(ctx: RequestContext): Promise<VoterElection[]> {
    const accountId = requireAccount(ctx);
    const snap = await this.firebase.db.collection(Collections.elections).where('state', 'in', VISIBLE).get();
    const mine: VoterElection[] = [];
    for (const doc of snap.docs) {
      const election = doc.data() as ElectionRecord;
      if (await this.onRoll(election, accountId)) mine.push(await this.voterView(election, accountId));
    }
    return mine.sort((a, b) => a.opensAt.localeCompare(b.opensAt));
  }

  async ballot(ctx: RequestContext, electionId: string): Promise<BallotView> {
    const accountId = requireAccount(ctx);
    const { election, definition, proposals } = await this.reader.load(electionId);
    await this.assertVoter(election, accountId);
    const hash = definitionHash(definition);
    if (hash !== election.definitionHash) {
      throw new InternalServerErrorException('the stored election no longer matches its frozen definition');
    }
    return {
      election: await this.voterView(election, accountId),
      definition,
      definitionHash: hash,
      proposals: proposals.map(({ snapshotId, title, body, contentHash }) => ({ snapshotId, title, body, contentHash })),
    };
  }

  async participation(ctx: RequestContext, electionId: string): Promise<{ castAt: string | null }> {
    const accountId = requireAccount(ctx);
    const election = (await this.electionRef(electionId).get()).data() as ElectionRecord | undefined;
    if (!election) throw new NotFoundException('no such election');
    await this.assertVoter(election, accountId);
    return { castAt: await this.castAt(electionId, accountId) };
  }

  async cast(ctx: RequestContext, electionId: string, input: CastBallotInput): Promise<CastResult> {
    const accountId = requireAccount(ctx);
    const { election, definition } = await this.reader.load(electionId);
    await this.assertVoter(election, accountId);
    assertVotingOpen(election);
    if (input.definitionHash !== election.definitionHash) {
      throw new ConflictException('this ballot is not the one frozen for the election; reload it');
    }
    if (definitionHash(definition) !== election.definitionHash) {
      throw new InternalServerErrorException('the stored election no longer matches its frozen definition');
    }
    const parts = input.parts as BallotPart[];
    const problems = ballotProblems(definition, parts);
    if (problems.length) throw new BadRequestException(problems.join('; '));
    const commitments = commitmentsOf(parts);

    const castAt = new Date().toISOString();
    let entry = null;
    if (election.secrecy === 'secret') {
      if (!election.poolKeyVersion) throw new InternalServerErrorException('the election has no ballot-pool key');
      const publicKey = await this.keys.publicKey(election.poolKeyVersion);
      entry = encryptBallot(publicKey, election.poolKeyVersion, electionId, canonicalBytes(parts));
    }
    const record: ParticipationRecord = entry ? { accountId, castAt } : { accountId, castAt, parts };

    const electionRef = this.electionRef(electionId);
    const participationRef = electionRef.collection(ElectionCollections.participation).doc(accountId);
    await this.firebase.db.runTransaction(async (tx) => {
      const [current, existing] = await Promise.all([tx.get(electionRef), tx.get(participationRef)]);
      if (existing.exists) throw new ConflictException('you have already voted in this election');
      assertVotingOpen(current.data() as ElectionRecord);
      tx.create(participationRef, record);
      if (entry) tx.create(electionRef.collection(ElectionCollections.ballotPool).doc(), entry);
    });
    return { electionId, castAt, commitments };
  }

  private async voterView(election: ElectionRecord, accountId: string): Promise<VoterElection> {
    const { electionId, title, description, secrecy, state, opensAt, closesAt } = election;
    return { electionId, title, description, secrecy, state, opensAt, closesAt, castAt: await this.castAt(electionId, accountId) };
  }

  private async castAt(electionId: string, accountId: string): Promise<string | null> {
    const snap = await this.electionRef(electionId).collection(ElectionCollections.participation).doc(accountId).get();
    return (snap.data() as ParticipationRecord | undefined)?.castAt ?? null;
  }

  /** Drafts and cancelled elections do not exist for voters; others answer 403 to anyone not on the roll. */
  private async assertVoter(election: ElectionRecord, accountId: string): Promise<void> {
    if (!VISIBLE.includes(election.state)) throw new NotFoundException('no such election');
    if (!(await this.onRoll(election, accountId))) throw new ForbiddenException('you are not on the voter roll for this election');
  }

  private async onRoll(election: ElectionRecord, accountId: string): Promise<boolean> {
    const snapshotId = election.rollSnapshotId;
    if (!snapshotId) return false;
    let roll = this.rolls.get(snapshotId);
    if (!roll) {
      roll = this.firebase.db
        .collection(Collections.eligibilitySnapshots)
        .doc(snapshotId)
        .get()
        .then((snap) => {
          const snapshot = snap.data() as RollSnapshotRecord | undefined;
          if (snapshot?.status !== 'approved' || snapshot.electionId !== election.electionId) {
            throw new InternalServerErrorException('the election does not point at its approved roll');
          }
          return new Set(snapshot.accountIds);
        });
      roll.catch(() => this.rolls.delete(snapshotId));
      this.rolls.set(snapshotId, roll);
    }
    return (await roll).has(accountId);
  }

  private electionRef(electionId: string) {
    return this.firebase.db.collection(Collections.elections).doc(electionId);
  }
}

function assertVotingOpen(election: ElectionRecord): void {
  const now = Date.now();
  if (election.state !== 'open' || now < Date.parse(election.opensAt) || now >= Date.parse(election.closesAt)) {
    throw new ConflictException(
      election.state === 'scheduled' ? 'voting has not opened yet' : `voting is not open (the election is ${election.state})`,
    );
  }
}
