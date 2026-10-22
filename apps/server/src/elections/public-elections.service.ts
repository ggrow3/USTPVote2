import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isHex32 } from 'ustp-audit';
import {
  Collections,
  ElectionCollections,
  sealedInclusionProof,
  type BallotProof,
  type ElectionRecord,
  type ElectionState,
  type PublicElection,
  type RollSnapshotRecord,
  type SealedBlockRecord,
  type SealedBlockSummary,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';
import { ElectionReader } from './election-reader.js';

/** States whose block contents are published: voting is over, so they cannot show a running tally. */
const CONTENTS_PUBLIC: readonly ElectionState[] = ['closed', 'certified'];

/**
 * The published record of an election (design §7.5, §12), readable by anyone once it is past its draft: the frozen
 * definition, the roll's size and root, sealed block summaries, the contents of sealed blocks once voting has closed,
 * and the inclusion proof for any sealed commitment.
 */
@Injectable()
export class PublicElectionsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly reader: ElectionReader,
  ) {}

  async record(electionId: string): Promise<PublicElection> {
    const { election, definition } = await this.reader.load(electionId);
    if (election.state === 'draft') throw new NotFoundException('no such election');
    const [rollSnap, blocksSnap] = await Promise.all([
      election.rollSnapshotId
        ? this.firebase.db.collection(Collections.eligibilitySnapshots).doc(election.rollSnapshotId).get()
        : Promise.resolve(null),
      this.blocks(electionId)
        .select('index', 'ballotCount', 'merkleRoot', 'sealedHash', 'sealedAt', 'ledgerSeq')
        .orderBy('index')
        .get(),
    ]);
    const roll = rollSnap?.data() as RollSnapshotRecord | undefined;
    const sealedBlocks = blocksSnap.docs.map((d) => d.data() as SealedBlockSummary);
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
        cancelledAt: e.cancelledAt,
      },
      definition,
      roll: roll ? { count: roll.count, merkleRoot: roll.merkleRoot, asOf: roll.asOf, signature: roll.signature ?? null } : null,
      sealedBlocks,
      ballotsSealed: sealedBlocks.reduce((sum, b) => sum + b.ballotCount, 0),
    };
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

  private blocks(electionId: string) {
    return this.firebase.db
      .collection(Collections.elections)
      .doc(electionId)
      .collection(ElectionCollections.sealedBlocks);
  }
}
