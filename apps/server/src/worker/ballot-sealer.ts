import { randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { FieldPath, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { GENESIS_HASH, type BallotPart } from 'ustp-audit';
import {
  buildSealedBlock,
  Collections,
  ElectionCollections,
  evenChunks,
  MAX_BALLOTS_PER_SEALED_BLOCK,
  sealedBlockHash,
  sealedCommitments,
  sequenceId,
  type ElectionRecord,
  type ParticipationRecord,
  type PoolEntryRecord,
  type SealableBallot,
  type SealedBlockRecord,
} from 'ustp-domain';
import { BALLOT_POOL_KEYS, decryptBallot, type BallotPoolKeys } from '../infra/ballot-pool.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';

/** Pool entries decrypted at once (one Cloud KMS call each). */
const DECRYPT_CONCURRENCY = 16;

/**
 * The sealer (design §7.2, §7.4). Firestore keeps a commit time on every document, and a ballot's pool entry shares its
 * commit with the voter's participation record, so the pool must not outlive the election: the sealer moves ballots
 * into published sealed blocks.
 *
 * - Secret, open: once the pool holds at least 2k ballots, seal a CSPRNG-chosen n - k of them and leave k behind, so
 *   every block, the last one included, holds at least k ballots.
 * - Secret, closed: seal everything left.
 * - Roll-call: nothing is secret, so all participation is sealed once, at close.
 *
 * Each block is one transaction: it re-reads the chosen pool entries (a concurrent tick that sealed any of them makes
 * this one give up), creates `sealed_blocks/{index}` (only once per index), deletes those entries and ledgers
 * `ballots.sealed`. When a closed election has nothing left, `election.sealed` records the final count.
 */
@Injectable()
export class BallotSealer {
  private readonly logger = new Logger(BallotSealer.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    @Inject(BALLOT_POOL_KEYS) private readonly keys: BallotPoolKeys,
  ) {}

  /** Seals what every open or closed election allows; returns the number of ballots sealed. */
  async sealAll(): Promise<number> {
    const snap = await this.firebase.db.collection(Collections.elections).where('state', 'in', ['open', 'closed']).get();
    let sealed = 0;
    for (const doc of snap.docs) {
      const election = doc.data() as ElectionRecord;
      if (election.sealedAt) continue;
      sealed += election.secrecy === 'secret' ? await this.sealPool(doc.ref, election) : await this.sealRollCall(doc.ref, election);
      if (election.state === 'closed') await this.finish(doc.ref);
    }
    return sealed;
  }

  private async sealPool(ref: DocumentReference, election: ElectionRecord): Promise<number> {
    const pool = (await ref.collection(ElectionCollections.ballotPool).get()).docs;
    const k = election.kAnonymity;
    let chosen: QueryDocumentSnapshot[];
    if (election.state === 'open') {
      if (pool.length < 2 * k) return 0;
      chosen = shuffle(pool).slice(0, pool.length - k);
    } else {
      chosen = pool;
    }
    // Chunks of at least k: a chunk is over half the cap whenever there is more than one.
    let sealed = 0;
    for (const chunk of evenChunks(chosen, Math.max(MAX_BALLOTS_PER_SEALED_BLOCK, 2 * k))) {
      const ballots = await mapLimited(chunk, DECRYPT_CONCURRENCY, async (doc): Promise<SealableBallot> => {
        const plaintext = await decryptBallot(this.keys, election.electionId, doc.data() as PoolEntryRecord);
        return { parts: JSON.parse(plaintext.toString()) as BallotPart[] };
      });
      if (!(await this.commit(ref, election.electionId, ballots, { poolRefs: chunk.map((d) => d.ref) }))) break;
      sealed += chunk.length;
    }
    return sealed;
  }

  /** Participation is frozen once closed, so the chunks are the same on every attempt; existing blocks are skipped. */
  private async sealRollCall(ref: DocumentReference, election: ElectionRecord): Promise<number> {
    if (election.state !== 'closed') return 0;
    const participation = await ref.collection(ElectionCollections.participation).orderBy(FieldPath.documentId()).get();
    const ballots = participation.docs
      .map((d) => d.data() as ParticipationRecord)
      .filter((p) => p.parts?.length)
      .map((p): SealableBallot => ({ accountId: p.accountId, parts: p.parts! }));
    const chunks = evenChunks(ballots, MAX_BALLOTS_PER_SEALED_BLOCK);
    const existing = (await ref.collection(ElectionCollections.sealedBlocks).select('index').get()).size;
    let sealed = 0;
    for (let i = existing; i < chunks.length; i++) {
      if (!(await this.commit(ref, election.electionId, chunks[i]!, { index: i + 1 }))) break;
      sealed += chunks[i]!.length;
    }
    return sealed;
  }

  private async commit(
    ref: DocumentReference,
    electionId: string,
    ballots: readonly SealableBallot[],
    expect: { readonly poolRefs?: readonly DocumentReference[]; readonly index?: number },
  ): Promise<boolean> {
    const blocks = ref.collection(ElectionCollections.sealedBlocks);
    return this.firebase.db.runTransaction(async (tx) => {
      const [election, lastSnap, entries] = await Promise.all([
        tx.get(ref),
        tx.get(blocks.orderBy('index', 'desc').limit(1)),
        expect.poolRefs?.length ? tx.getAll(...expect.poolRefs) : Promise.resolve([]),
      ]);
      if ((election.data() as ElectionRecord).sealedAt) return false;
      if (entries.some((e) => !e.exists)) return false; // a concurrent tick sealed some of these
      const last = lastSnap.docs[0]?.data() as SealedBlockRecord | undefined;
      const index = (last?.index ?? 0) + 1;
      if (expect.index !== undefined && expect.index !== index) return false;

      const block = buildSealedBlock({
        electionId,
        index,
        prevSealedHash: last?.sealedHash ?? GENESIS_HASH,
        ballots,
        sealedAt: new Date().toISOString(),
      });
      const sealedHash = sealedBlockHash(block);
      const [ledgerSeq] = await this.ledger.record(tx, [
        {
          type: 'ballots.sealed',
          actor: 'system',
          subject: electionId,
          payload: {
            electionId,
            index,
            ballotCount: block.ballotCount,
            merkleRoot: block.merkleRoot,
            sealedHash,
            prevSealedHash: block.prevSealedHash,
          },
        },
      ]);
      const record: SealedBlockRecord = { ...block, sealedHash, commitments: sealedCommitments(block.contests), ledgerSeq: ledgerSeq! };
      tx.create(blocks.doc(sequenceId(index)), record);
      for (const entry of expect.poolRefs ?? []) tx.delete(entry);
      return true;
    });
  }

  /** Marks a closed election sealed once its pool is empty (and, for roll-call, every ballot is in a block). */
  private async finish(ref: DocumentReference): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const election = (await tx.get(ref)).data() as ElectionRecord;
      if (election.state !== 'closed' || election.sealedAt) return;
      const [pool, blocks, voted] = await Promise.all([
        tx.get(ref.collection(ElectionCollections.ballotPool).limit(1)),
        tx.get(ref.collection(ElectionCollections.sealedBlocks).select('index', 'ballotCount', 'sealedHash')),
        tx.get(ref.collection(ElectionCollections.participation).count()),
      ]);
      if (!pool.empty) return;
      const sealedBlocks = blocks.docs.map((d) => d.data() as Pick<SealedBlockRecord, 'index' | 'ballotCount' | 'sealedHash'>);
      const ballots = sealedBlocks.reduce((sum, b) => sum + b.ballotCount, 0);
      if (ballots !== voted.data().count) {
        // Roll-call ballots still to seal reach this on the way; for secret ballots it would mean a lost ballot.
        if (election.secrecy === 'secret') {
          this.logger.error(`${election.electionId}: ${voted.data().count} voted but ${ballots} ballots were sealed`);
        }
        return;
      }
      const last = sealedBlocks.sort((a, b) => b.index - a.index)[0];
      await this.ledger.record(tx, [
        {
          type: 'election.sealed',
          actor: 'system',
          subject: election.electionId,
          payload: { electionId: election.electionId, blocks: sealedBlocks.length, ballots, lastSealedHash: last?.sealedHash ?? GENESIS_HASH },
        },
      ]);
      const now = new Date().toISOString();
      tx.update(ref, { sealedAt: now, updatedAt: now });
    });
  }
}

/** Fisher–Yates with the CSPRNG: which ballots stay behind must not be predictable. */
function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}
