import { Injectable } from '@nestjs/common';
import { Collections, type PublicBillRecord } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/**
 * The bills context's port for the others (design §3.3): the title of a bill on the public Legislation page, read
 * only. The Discord bot (§10.18) names a bill when the team first shows it.
 */
@Injectable()
export class PublicBillTitles {
  constructor(private readonly firebase: Firebase) {}

  /** The bill's title as the public page has it; null when the bill is not (or no longer) shown. */
  async title(billId: string): Promise<string | null> {
    const bill = (await this.firebase.db.collection(Collections.billPublic).doc(billId).get()).data() as PublicBillRecord | undefined;
    return bill?.title ?? null;
  }
}
