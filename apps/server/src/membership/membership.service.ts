import { ConflictException, Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { sha256Hex } from 'ustp-audit';
import {
  Collections,
  type BylawsRecord,
  type BylawsVersionSummary,
  type ElectionRecord,
  type PublishBylawsInput,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';

/**
 * Bylaws versions (design §5.2, §6.6). Members and applications are `Members` and `MembershipApplications`; the bylaws
 * move to a context of their own next (docs/DOMAIN-MODEL.md §6, step 2).
 */
@Injectable()
export class MembershipService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
  ) {}

  /** The newest published version; read in `tx` when given, so it cannot change before the transaction commits. */
  async currentBylaws(tx?: Transaction): Promise<BylawsRecord | null> {
    const snap = await (tx ? tx.get(this.currentBylawsQuery()) : this.currentBylawsQuery().get());
    return (snap.docs[0]?.data() as BylawsRecord | undefined) ?? null;
  }

  /** A published version by name, or null. */
  async bylawsRecord(version: string, tx?: Transaction): Promise<BylawsRecord | null> {
    const ref = this.firebase.db.collection(Collections.bylawsVersions).doc(version);
    const snap = await (tx ? tx.get(ref) : ref.get());
    return (snap.data() as BylawsRecord | undefined) ?? null;
  }

  /** Every published version without its text, newest first. */
  async bylawsVersions(): Promise<BylawsVersionSummary[]> {
    const snap = await this.firebase.db
      .collection(Collections.bylawsVersions)
      .orderBy('publishedAt', 'desc')
      .select('version', 'title', 'contentHash', 'publishedAt', 'publishedBy', 'amends', 'changeNote')
      .get();
    return snap.docs.map((d) => d.data() as BylawsVersionSummary);
  }

  async bylawsVersion(version: string): Promise<BylawsRecord | null> {
    const snap = await this.firebase.db.collection(Collections.bylawsVersions).doc(version).get();
    return (snap.data() as BylawsRecord | undefined) ?? null;
  }

  /**
   * Publishes a new version. `amends` must name the version that is current when publishing (null for the first), so
   * a draft started from an older version cannot silently replace an amendment someone else published meanwhile.
   */
  async publishBylaws(ctx: RequestContext, input: PublishBylawsInput): Promise<BylawsRecord> {
    const actor = requireAccount(ctx);
    const amends = input.amends ?? null;
    const record: BylawsRecord = {
      version: input.version,
      title: input.title,
      text: input.text,
      contentHash: sha256Hex(input.text),
      publishedAt: new Date().toISOString(),
      publishedBy: actor,
      amends,
      changeNote: input.changeNote || null,
    };
    const ref = this.firebase.db.collection(Collections.bylawsVersions).doc(input.version);
    return this.firebase.db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) throw new ConflictException(`bylaws version ${input.version} already exists`);
      const current = (await tx.get(this.currentBylawsQuery())).docs[0]?.data() as BylawsRecord | undefined;
      if ((current?.version ?? null) !== amends) {
        throw new ConflictException(
          current
            ? `version ${current.version} is the current bylaws; start the new version from it`
            : 'no bylaws have been published yet, so there is nothing to amend',
        );
      }
      // An election amending the current version holds it until certified or cancelled (design §6.6), so the lines
      // members vote on stay the lines in force.
      if (current) {
        const amending = await tx.get(this.firebase.db.collection(Collections.elections).where('amendsBylaws.version', '==', current.version));
        const underWay = amending.docs.map((d) => d.data() as ElectionRecord).find((e) => ['scheduled', 'open', 'closed'].includes(e.state));
        if (underWay) {
          throw new ConflictException(
            `the election "${underWay.title}" amends version ${current.version} and is ${underWay.state}; publish once it is certified or cancelled`,
          );
        }
      }
      await this.ledger.record(tx, [
        {
          type: 'bylaws.published',
          actor,
          subject: null,
          payload: { version: record.version, title: record.title, contentHash: record.contentHash, amends },
        },
      ]);
      tx.create(ref, record);
      return record;
    });
  }

  // --- internals --------------------------------------------------------------------------------------------

  private currentBylawsQuery() {
    return this.firebase.db.collection(Collections.bylawsVersions).orderBy('publishedAt', 'desc').limit(1);
  }
}
