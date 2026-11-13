import { Injectable } from '@nestjs/common';
import { bylawsInForce, Collections, definitionHash, positionsHash, type BylawsRecord, type ElectionCheckBasis, type PositionRecord } from 'ustp-domain';
import { ElectionReader, type LoadedElection } from '../elections/election-reader.js';
import { Firebase } from '../infra/firebase.js';

export interface ElectionCheckMaterial extends LoadedElection {
  readonly positions: PositionRecord[];
  /** The current published bylaws, or null before the first version. */
  readonly bylaws: BylawsRecord | null;
  /** What a check run now would compare; null without bylaws. */
  readonly basis: ElectionCheckBasis | null;
}

/**
 * Reads what the election setup check compares (design §6.9): the election as it stands, the offices its contests fill
 * and the current bylaws, with the basis a check records, so the api can tell whether anything changed since one ran
 * and the worker records exactly what it compared. Used by both, so the two read them alike.
 */
@Injectable()
export class ElectionCheckMaterials {
  constructor(
    private readonly firebase: Firebase,
    private readonly reader: ElectionReader,
  ) {}

  async load(electionId: string): Promise<ElectionCheckMaterial> {
    const [loaded, bylaws] = await Promise.all([this.reader.load(electionId), this.currentBylaws()]);
    const positions = await this.reader.positions(loaded.contests);
    const basis = bylaws
      ? {
          definitionHash: definitionHash(loaded.definition),
          bylaws: { version: bylaws.version, contentHash: bylaws.contentHash },
          positionsHash: positionsHash(positions),
        }
      : null;
    return { ...loaded, positions, bylaws, basis };
  }

  /**
   * The bylaws in force: the newest published version, as `MembershipService.currentBylaws` reads it (the worker has
   * no membership service), unless it is blank (design §5.2).
   */
  private async currentBylaws(): Promise<BylawsRecord | null> {
    const snap = await this.firebase.db.collection(Collections.bylawsVersions).orderBy('publishedAt', 'desc').limit(1).get();
    return bylawsInForce(snap.docs[0]?.data() as BylawsRecord | undefined);
  }
}
