import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { Collections, type ReferralCodeRecord, type ReferralLinkRecord } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/** Members' referral codes (design §5.18): `referral_codes/{code}` and `referral_links/{accountId}`. The only code that knows their paths. */
@Injectable()
export class ReferralRepository {
  constructor(private readonly firebase: Firebase) {}

  private codeRef(code: string) {
    return this.firebase.db.collection(Collections.referralCodes).doc(code);
  }

  private linkRef(accountId: string) {
    return this.firebase.db.collection(Collections.referralLinks).doc(accountId);
  }

  async code(code: string, tx?: Transaction): Promise<ReferralCodeRecord | null> {
    const snap = tx ? await tx.get(this.codeRef(code)) : await this.codeRef(code).get();
    return (snap.data() as ReferralCodeRecord | undefined) ?? null;
  }

  async link(accountId: string, tx?: Transaction): Promise<ReferralLinkRecord | null> {
    const snap = tx ? await tx.get(this.linkRef(accountId)) : await this.linkRef(accountId).get();
    return (snap.data() as ReferralLinkRecord | undefined) ?? null;
  }

  /** A member's new code: both records at once, refused by Firestore if the code is taken meanwhile. */
  create(tx: Transaction, link: ReferralLinkRecord): void {
    tx.create(this.codeRef(link.code), { code: link.code, accountId: link.accountId, createdAt: link.createdAt } satisfies ReferralCodeRecord);
    tx.create(this.linkRef(link.accountId), link);
  }

  /** Deletes the account's code and link records, for deleting the account (design §4). */
  async deleteOf(accountId: string): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const link = await this.link(accountId, tx);
      if (!link) return;
      tx.delete(this.linkRef(accountId));
      tx.delete(this.codeRef(link.code));
    });
  }
}
