import { Injectable, Logger } from '@nestjs/common';
import { Collections } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/** Identity Platform looks up at most this many users at once. */
const LOOKUP_BATCH = 100;

/**
 * Marks verified the accounts whose login confirmed their address before `POST /v1/accounts` began recording it (design
 * §4), so election email reaches them without waiting for their next sign-in (§6.8). It runs in the background once per
 * api instance, on the first sign-in the instance sees (not at start, so an instance with no database to reach, such as
 * the image's smoke test, never tries); once they are caught up it finds only accounts whose address is still
 * unconfirmed, and changes nothing. An added member nobody has signed in to yet is left alone: their first sign-in does
 * it (§5.13). The api may read Identity Platform's users already, to check revocation.
 */
@Injectable()
export class EmailVerifiedSync {
  private readonly logger = new Logger(EmailVerifiedSync.name);
  private started = false;

  constructor(private readonly firebase: Firebase) {}

  /** Starts the catch-up in the background, the first time only. */
  startOnce(): void {
    if (this.started) return;
    this.started = true;
    void this.run().catch((e: unknown) => this.logger.warn(`checking unverified addresses failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  /** Returns how many accounts it marked verified. */
  async run(): Promise<number> {
    const accounts = this.firebase.db.collection(Collections.accounts);
    const snap = await accounts.where('emailVerified', '==', false).select('primaryEmail', 'claimedAt').get();
    const owners = new Map<string, string>();
    for (const doc of snap.docs) {
      const email = doc.get('primaryEmail') as string | null;
      if (email && doc.get('claimedAt') !== null) owners.set(email.toLowerCase(), doc.id);
    }
    const emails = [...owners.keys()];
    let marked = 0;
    for (let i = 0; i < emails.length; i += LOOKUP_BATCH) {
      const { users } = await this.firebase.auth.getUsers(emails.slice(i, i + LOOKUP_BATCH).map((email) => ({ email })));
      for (const user of users) {
        const accountId = user.emailVerified && user.email ? owners.get(user.email.toLowerCase()) : undefined;
        if (!accountId) continue;
        await accounts.doc(accountId).update({ emailVerified: true });
        marked++;
      }
    }
    if (marked) this.logger.log(`marked ${marked} account(s) whose login had confirmed the address as verified`);
    return marked;
  }
}
