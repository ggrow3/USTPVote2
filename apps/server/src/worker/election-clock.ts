import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DocumentReference } from 'firebase-admin/firestore';
import { Collections, definitionHash, type ElectionRecord } from 'ustp-domain';
import { ElectionReader } from '../elections/election-reader.js';
import { BALLOT_POOL_KEYS, type BallotPoolKeys } from '../infra/ballot-pool.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService, type LedgerEvent } from '../ledger/ledger.service.js';

/**
 * The election clock (design §6.1): prepares each scheduled secret election's ballot-pool key, opens elections at
 * `opensAt` and closes them at `closesAt`. Each transition re-reads the election in a transaction, so overlapping ticks
 * move an election once.
 */
@Injectable()
export class ElectionClock {
  private readonly logger = new Logger(ElectionClock.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly reader: ElectionReader,
    @Inject(BALLOT_POOL_KEYS) private readonly keys: BallotPoolKeys,
  ) {}

  /** Creates the pool key version for scheduled secret elections that have none yet. */
  async preparePoolKeys(): Promise<number> {
    let created = 0;
    for (const { ref, election } of await this.inState('scheduled')) {
      if (election.secrecy !== 'secret' || election.poolKeyVersion) continue;
      const keyVersion = await this.keys.create(election.electionId);
      const applied = await this.firebase.db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data() as ElectionRecord;
        if (current.state !== 'scheduled' || current.poolKeyVersion) return false;
        tx.update(ref, { poolKeyVersion: keyVersion, updatedAt: new Date().toISOString() });
        return true;
      });
      if (applied) created++;
      else this.logger.warn(`unused ballot-pool key version ${keyVersion}: another tick prepared ${election.electionId} first`);
    }
    return created;
  }

  /**
   * Opens scheduled elections whose time has come, once their pool key is ready and their stored definition still
   * hashes to what scheduling froze.
   */
  async openDue(now: Date = new Date()): Promise<number> {
    let opened = 0;
    for (const { ref, election } of await this.inState('scheduled')) {
      if (Date.parse(election.opensAt) > now.getTime()) continue;
      if (election.secrecy === 'secret' && !(election.poolKeyVersion && (await this.keys.isReady(election.poolKeyVersion)))) {
        this.logger.warn(`not opening ${election.electionId} yet: its ballot-pool key is not ready`);
        continue;
      }
      const { definition } = await this.reader.load(election.electionId);
      if (definitionHash(definition) !== election.definitionHash) {
        throw new Error(`not opening ${election.electionId}: its stored definition no longer matches the frozen hash`);
      }
      const event: LedgerEvent = {
        type: 'election.opened',
        actor: 'system',
        subject: election.electionId,
        payload: {
          electionId: election.electionId,
          definitionHash: election.definitionHash,
          opensAt: election.opensAt,
          closesAt: election.closesAt,
          poolKeyVersion: election.poolKeyVersion ?? null,
        },
      };
      if (await this.transition(ref, 'scheduled', 'open', 'openedAt', event)) opened++;
    }
    return opened;
  }

  /** Closes open elections whose voting window has ended. */
  async closeDue(now: Date = new Date()): Promise<number> {
    let closed = 0;
    for (const { ref, election } of await this.inState('open')) {
      if (Date.parse(election.closesAt) > now.getTime()) continue;
      const event: LedgerEvent = {
        type: 'election.closed',
        actor: 'system',
        subject: election.electionId,
        payload: { electionId: election.electionId, closesAt: election.closesAt },
      };
      if (await this.transition(ref, 'open', 'closed', 'closedAt', event)) closed++;
    }
    return closed;
  }

  private async transition(
    ref: DocumentReference,
    from: 'scheduled' | 'open',
    to: 'open' | 'closed',
    stamp: 'openedAt' | 'closedAt',
    event: LedgerEvent,
  ): Promise<boolean> {
    return this.firebase.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as ElectionRecord;
      if (current.state !== from) return false; // cancelled meanwhile, or another tick moved it
      await this.ledger.record(tx, [event]);
      const now = new Date().toISOString();
      tx.update(ref, { state: to, [stamp]: now, updatedAt: now });
      return true;
    });
  }

  private async inState(state: 'scheduled' | 'open') {
    const snap = await this.firebase.db.collection(Collections.elections).where('state', '==', state).get();
    return snap.docs.map((d) => ({ ref: d.ref, election: d.data() as ElectionRecord }));
  }
}
