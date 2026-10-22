import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DocumentReference } from 'firebase-admin/firestore';
import {
  buildResultsBundle,
  Collections,
  definitionHash,
  ElectionCollections,
  matchesCommitment,
  resultsHash,
  resultsSigningInput,
  type ElectionRecord,
  type ResultsRecord,
  type RollSnapshotRecord,
  type SealedBlockRecord,
} from 'ustp-domain';
import { ElectionReader } from '../elections/election-reader.js';
import { AUDIT_SIGNER, type AuditSigner } from '../infra/audit-signer.js';
import { Firebase } from '../infra/firebase.js';
import { SECRET_STORE, type SecretStore } from '../infra/secret-store.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { LedgerSealer } from './ledger-sealer.js';

/**
 * The tally (design §9). Once an election is closed and every ballot is sealed, the worker reveals its tie-break seed,
 * counts the sealed blocks with `ustp-tally` and writes the provisional results: the bundle, its hash, and a signature
 * by the `audit-signing` key, ledgered as `results.computed`. It runs on every tick, after the sealer, so results
 * follow the last sealed block within the same tick.
 *
 * Idempotent: `results/{electionId}` is created once, in the same transaction as its ledger entry, so overlapping ticks
 * record one result (the loser's signature is simply discarded). A seed that does not match its commitment, a definition
 * that no longer hashes to the frozen one, or sealed blocks that do not verify stop that election's tally and fail the
 * tick loudly; other elections are still tallied.
 */
@Injectable()
export class Tallier {
  private readonly logger = new Logger(Tallier.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly reader: ElectionReader,
    private readonly ledgerSealer: LedgerSealer,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(AUDIT_SIGNER) private readonly signer: AuditSigner,
  ) {}

  /** Tallies every closed, sealed election without results; returns how many were tallied. */
  async tallyAll(): Promise<number> {
    const db = this.firebase.db;
    const closed = (await db.collection(Collections.elections).where('state', '==', 'closed').get()).docs
      .map((d) => ({ ref: d.ref, election: d.data() as ElectionRecord }))
      .filter((e) => e.election.sealedAt);
    if (!closed.length) return 0;
    const existing = await db.getAll(...closed.map((e) => this.resultsRef(e.election.electionId)));
    let computed = 0;
    const failures: string[] = [];
    for (const [i, { ref, election }] of closed.entries()) {
      if (existing[i]!.exists) continue;
      try {
        if (await this.tally(ref, election)) computed++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(`not tallying ${election.electionId}: ${message}`);
        failures.push(`${election.electionId}: ${message}`);
      }
    }
    if (failures.length) throw new Error(failures.join('; '));
    return computed;
  }

  private async tally(ref: DocumentReference, election: ElectionRecord): Promise<boolean> {
    const { electionId } = election;
    const db = this.firebase.db;
    const [{ definition }, rollSnap, blocksSnap, voted] = await Promise.all([
      this.reader.load(electionId),
      db.collection(Collections.eligibilitySnapshots).doc(election.rollSnapshotId ?? '-').get(),
      ref.collection(ElectionCollections.sealedBlocks).orderBy('index').get(),
      ref.collection(ElectionCollections.participation).count().get(),
    ]);
    if (!election.definitionHash || definitionHash(definition) !== election.definitionHash) {
      throw new Error('its stored definition no longer matches the frozen hash');
    }
    const roll = rollSnap.data() as RollSnapshotRecord | undefined;
    if (!roll || roll.status !== 'approved' || roll.electionId !== electionId) throw new Error('it has no approved roll');
    const blocks = blocksSnap.docs.map((d) => d.data() as SealedBlockRecord);
    const ballots = blocks.reduce((n, b) => n + b.ballotCount, 0);
    if (ballots !== voted.data().count) throw new Error(`${voted.data().count} voted but ${ballots} ballots are sealed`);

    const seed = election.tieBreakSeedRef ? await this.secrets.read(election.tieBreakSeedRef) : null;
    if (!seed) throw new Error('its tie-break seed cannot be read');
    if (!matchesCommitment(seed, election.tieBreakSeedCommitment)) {
      throw new Error('its stored tie-break seed does not match the commitment published at scheduling');
    }

    const bundle = buildResultsBundle({
      definition,
      definitionHash: election.definitionHash,
      roll: { snapshotId: roll.snapshotId, merkleRoot: roll.merkleRoot, count: roll.count },
      tieBreakSeed: seed,
      tieBreakSeedCommitment: election.tieBreakSeedCommitment!,
      blocks,
    });
    const hash = resultsHash(bundle);
    const signature = await this.signer.sign(resultsSigningInput(bundle));
    await this.ledgerSealer.recordKey();

    const resultsRef = this.resultsRef(electionId);
    return db.runTransaction(async (tx) => {
      const [current, existing] = await Promise.all([tx.get(ref), tx.get(resultsRef)]);
      const now = current.data() as ElectionRecord;
      if (existing.exists || now.state !== 'closed' || !now.sealedAt) return false; // another tick got here first
      const [ledgerSeq] = await this.ledger.record(tx, [
        {
          type: 'results.computed',
          actor: 'system',
          subject: electionId,
          payload: {
            electionId,
            resultsHash: hash,
            definitionHash: bundle.definitionHash,
            participationCount: bundle.participationCount,
            tallyVersion: bundle.tally.version,
            tieBreakSeed: seed,
          },
        },
      ]);
      const record: ResultsRecord = {
        electionId,
        status: 'provisional',
        bundle,
        resultsHash: hash,
        signature,
        computedAt: new Date().toISOString(),
        ledgerSeq: ledgerSeq!,
      };
      tx.create(resultsRef, record);
      return true;
    });
  }

  private resultsRef(electionId: string) {
    return this.firebase.db.collection(Collections.results).doc(electionId);
  }
}
