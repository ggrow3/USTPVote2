import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { isHex32 } from 'ustp-audit';
import {
  adoptedBylaws,
  amendingContests,
  Collections,
  definitionHash,
  ElectionCollections,
  resultsCsv,
  resultsSummary,
  sealedInclusionProof,
  votingCalendar,
  type AmendedBylawsView,
  type BallotProof,
  type ElectionRecord,
  type ElectionState,
  type PublicElection,
  type ResultsRecord,
  type RollSnapshotRecord,
  type SealedBlockRecord,
  type SealedBlockSummary,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';
import { MembershipService } from '../membership/membership.service.js';
import { ElectionReader } from './election-reader.js';

/** States whose block contents are published: voting is over, so they cannot show a running tally. */
const CONTENTS_PUBLIC: readonly ElectionState[] = ['closed', 'certified'];

/**
 * The published record of an election (design §7.5, §9, §12), readable by anyone once it is past its draft: the frozen
 * definition, the roll's size and root, sealed block summaries, the contents of sealed blocks once voting has closed,
 * the inclusion proof for any sealed commitment, the signed results once the worker has tallied them, and the voting
 * window as a calendar event.
 */
@Injectable()
export class PublicElectionsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly reader: ElectionReader,
    private readonly membership: MembershipService,
  ) {}

  /**
   * The bylaws as the election's passed amendments give them (design §6.6), once its results are certified: the base,
   * every amending contest with its outcome (the full proposal for those that passed), the text and its hash, whether
   * the base is still current, and the version published from it, if any.
   */
  async amendedBylaws(electionId: string): Promise<AmendedBylawsView> {
    const { election, definition, proposals } = await this.reader.load(electionId);
    if (election.state === 'draft') throw new NotFoundException('no such election');
    const amending = amendingContests(definition, proposals);
    if (!amending[0]) throw new NotFoundException('this election amends no bylaws');
    const results = (await this.resultsRef(electionId).get()).data() as ResultsRecord | undefined;
    if (results?.status !== 'certified') throw new ConflictException('the amended bylaws follow once the results are certified');
    if (definitionHash(definition) !== election.definitionHash) {
      throw new InternalServerErrorException('the stored election no longer matches its frozen definition');
    }
    const version = amending[0].amendment.base.version;
    const [base, current, adopted] = await Promise.all([
      this.membership.bylawsRecord(version),
      this.membership.currentBylaws(),
      this.firebase.db.collection(Collections.bylawsVersions).where('adoptedIn.electionId', '==', electionId).limit(1).get(),
    ]);
    if (!base) throw new InternalServerErrorException(`bylaws version ${version}, which this election amends, is missing`);
    const result = adoptedBylaws({ definition, proposals, bundle: results.bundle, base });
    if (!result.ok) throw new InternalServerErrorException(result.problems.join('; '));
    const proposalOf = (contestId: string) => {
      const snapshotId = definition.contests.find((c) => c.contestId === contestId)?.proposal?.snapshotId;
      const p = proposals.find((x) => x.snapshotId === snapshotId)!;
      return { snapshotId: p.snapshotId, title: p.title, body: p.body, contentHash: p.contentHash, amendment: p.amendment ?? null };
    };
    return {
      v: 1,
      electionId,
      electionTitle: election.title,
      resultsHash: results.resultsHash,
      certifiedAt: results.certifiedAt ?? election.certifiedAt ?? '',
      base: { version: base.version, title: base.title, contentHash: base.contentHash },
      contests: result.adopted.contests.map((c) => ({
        contestId: c.contestId,
        title: c.title,
        outcome: c.outcome,
        proposal: c.outcome === 'passed' ? proposalOf(c.contestId) : null,
      })),
      text: result.adopted.text,
      contentHash: result.adopted.contentHash,
      changed: result.adopted.changed,
      baseIsCurrent: current?.version === base.version,
      adoptedAs: adopted.docs[0]?.id ?? null,
    };
  }

  async record(electionId: string): Promise<PublicElection> {
    const { election, definition } = await this.reader.load(electionId);
    if (election.state === 'draft') throw new NotFoundException('no such election');
    const [rollSnap, blocksSnap, resultsSnap] = await Promise.all([
      election.rollSnapshotId
        ? this.firebase.db.collection(Collections.eligibilitySnapshots).doc(election.rollSnapshotId).get()
        : Promise.resolve(null),
      this.blocks(electionId)
        .select('index', 'ballotCount', 'merkleRoot', 'sealedHash', 'sealedAt', 'ledgerSeq')
        .orderBy('index')
        .get(),
      this.resultsRef(electionId).get(),
    ]);
    const roll = rollSnap?.data() as RollSnapshotRecord | undefined;
    const sealedBlocks = blocksSnap.docs.map((d) => d.data() as SealedBlockSummary);
    const results = resultsSnap.data() as ResultsRecord | undefined;
    const e = election;
    return {
      election: {
        electionId: e.electionId,
        title: e.title,
        description: e.description,
        secrecy: e.secrecy,
        state: e.state,
        opensAt: e.opensAt,
        closesAt: e.closesAt,
        kAnonymity: e.kAnonymity,
        definitionHash: e.definitionHash,
        tieBreakSeedCommitment: e.tieBreakSeedCommitment,
        openedAt: e.openedAt ?? null,
        closedAt: e.closedAt ?? null,
        sealedAt: e.sealedAt ?? null,
        certifiedAt: e.certifiedAt ?? null,
        poolKeyDestroyedAt: e.poolKeyDestroyedAt ?? null,
        cancelledAt: e.cancelledAt,
      },
      definition,
      roll: roll
        ? {
            snapshotId: roll.snapshotId,
            criteria: roll.criteria,
            count: roll.count,
            merkleRoot: roll.merkleRoot,
            asOf: roll.asOf,
            signature: roll.signature ?? null,
          }
        : null,
      sealedBlocks,
      ballotsSealed: sealedBlocks.reduce((sum, b) => sum + b.ballotCount, 0),
      results: results
        ? resultsSummary(results)
        : null,
    };
  }

  /** The signed results bundle; 404 until the worker has tallied the sealed election. */
  async results(electionId: string): Promise<ResultsRecord> {
    await this.state(electionId);
    const snap = await this.resultsRef(electionId).get();
    if (!snap.exists) throw new NotFoundException('results are published once every ballot is sealed and counted');
    return snap.data() as ResultsRecord;
  }

  /**
   * The results as CSV for spreadsheets (design §9), made from the stored bundle and the frozen definition; served
   * exactly when the bundle is. `origin` is where the web app is served, for the links back to the signed record.
   */
  async resultsCsv(electionId: string, origin: string): Promise<string> {
    const results = await this.results(electionId);
    const { definition } = await this.reader.load(electionId);
    return resultsCsv({ results, definition, origin });
  }

  /**
   * The voting window as an iCalendar event (design §6.1): any election past its draft, since only then is the window
   * frozen and public. Nothing in it depends on the caller.
   */
  async calendar(electionId: string, origin: string): Promise<string> {
    const snap = await this.firebase.db.collection(Collections.elections).doc(electionId).get();
    const election = snap.data() as ElectionRecord | undefined;
    if (!election || election.state === 'draft') throw new NotFoundException('no such election');
    return votingCalendar({ election, origin, now: new Date().toISOString() });
  }

  /** Every sealed block with its parts, once voting has closed. */
  async sealedBlocks(electionId: string): Promise<SealedBlockRecord[]> {
    const state = await this.state(electionId);
    if (!CONTENTS_PUBLIC.includes(state)) {
      throw new ConflictException('sealed ballots are published when voting closes; until then only block summaries are');
    }
    const snap = await this.blocks(electionId).orderBy('index').get();
    return snap.docs.map((d) => d.data() as SealedBlockRecord);
  }

  /** Where a sealed commitment is and the proof it is there; 404 while it waits in the pool. */
  async proof(electionId: string, commitment: string): Promise<BallotProof> {
    if (!isHex32(commitment)) throw new BadRequestException('a commitment is 64 lowercase hex digits');
    await this.state(electionId);
    const snap = await this.blocks(electionId).where('commitments', 'array-contains', commitment).limit(1).get();
    const block = snap.docs[0]?.data() as SealedBlockRecord | undefined;
    const proof = block && sealedInclusionProof(block, commitment);
    if (!block || !proof) throw new NotFoundException('that commitment is not in a sealed block (yet)');
    return {
      electionId,
      commitment,
      blockIndex: block.index,
      merkleRoot: block.merkleRoot,
      sealedHash: block.sealedHash,
      ledgerSeq: block.ledgerSeq,
      proof,
    };
  }

  private async state(electionId: string): Promise<ElectionState> {
    const snap = await this.firebase.db.collection(Collections.elections).doc(electionId).get();
    const state = (snap.data() as ElectionRecord | undefined)?.state;
    if (!state || state === 'draft') throw new NotFoundException('no such election');
    return state;
  }

  private resultsRef(electionId: string) {
    return this.firebase.db.collection(Collections.results).doc(electionId);
  }

  private blocks(electionId: string) {
    return this.firebase.db
      .collection(Collections.elections)
      .doc(electionId)
      .collection(ElectionCollections.sealedBlocks);
  }
}
