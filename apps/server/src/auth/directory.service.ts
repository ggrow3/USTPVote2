import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { Collections, type AccountRecord, type IdentityRecord, type Role, type RoleAssignmentRecord } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/** Lookups every request needs: which account a login belongs to and which roles that account holds. */
@Injectable()
export class DirectoryService {
  constructor(private readonly firebase: Firebase) {}

  async accountIdForUid(uid: string): Promise<string | null> {
    const snap = await this.firebase.db.collection(Collections.accountIdentities).doc(uid).get();
    return snap.exists ? (snap.data() as IdentityRecord).accountId : null;
  }

  /** A test persona's account (design §10.4). */
  async isPersona(accountId: string): Promise<boolean> {
    return (await this.firebase.db.collection(Collections.testingPersonas).doc(accountId).get()).exists;
  }

  /** Active (unrevoked) roles. Pass a transaction to read them consistently with other transactional reads. */
  async activeRoles(accountId: string, tx?: Transaction): Promise<Role[]> {
    const query = this.firebase.db
      .collection(Collections.roleAssignments)
      .where('accountId', '==', accountId)
      .where('revokedAt', '==', null);
    const snap = tx ? await tx.get(query) : await query.get();
    return snap.docs.map((d) => (d.data() as RoleAssignmentRecord).role).sort();
  }

  /**
   * Each account's mailbox, by accountId, for election notices (design §6.8); an account that does not exist is
   * missing from the map. Only the notice sender reads addresses, and only to send.
   */
  async mailboxes(accountIds: readonly string[]): Promise<Map<string, Mailbox>> {
    const db = this.firebase.db;
    const refs = accountIds.map((id) => db.collection(Collections.accounts).doc(id));
    const snaps = refs.length ? await db.getAll(...refs) : [];
    const found = new Map<string, Mailbox>();
    for (const snap of snaps) {
      const account = snap.data() as AccountRecord | undefined;
      if (account) found.set(account.accountId, { email: account.primaryEmail, verified: account.emailVerified });
    }
    return found;
  }

  /**
   * The account an email address belongs to, for a delivery report about mail Identity Platform sent (design §6.8): the
   * account whose primary email it is, else the one with a login of that address. Null when none, or more than one, has
   * it.
   */
  async accountWithEmail(address: string): Promise<string | null> {
    const email = address.trim().toLowerCase();
    const db = this.firebase.db;
    const [accounts, identities] = await Promise.all([
      db.collection(Collections.accounts).where('primaryEmail', '==', email).select().limit(2).get(),
      db.collection(Collections.accountIdentities).where('email', '==', email).select('accountId').limit(2).get(),
    ]);
    if (accounts.size === 1) return accounts.docs[0]!.id;
    const owners = new Set(identities.docs.map((d) => d.get('accountId') as string));
    return owners.size === 1 ? [...owners][0]! : null;
  }

  /** Each account's display name, by accountId, where it has one (never its email); for naming staff who need no membership. */
  async displayNames(accountIds: readonly string[]): Promise<Map<string, string>> {
    const db = this.firebase.db;
    const snaps = accountIds.length ? await db.getAll(...accountIds.map((id) => db.collection(Collections.accounts).doc(id))) : [];
    const found = new Map<string, string>();
    for (const snap of snaps) {
      const account = snap.data() as AccountRecord | undefined;
      if (account?.displayName) found.set(account.accountId, account.displayName);
    }
    return found;
  }

  /** Who holds a role now, by name (or email, for an account without one), in name order. */
  async roleHolders(role: Role): Promise<{ accountId: string; name: string }[]> {
    const db = this.firebase.db;
    const snap = await db.collection(Collections.roleAssignments).where('role', '==', role).where('revokedAt', '==', null).get();
    const ids = [...new Set(snap.docs.map((d) => (d.data() as RoleAssignmentRecord).accountId))];
    const accounts = ids.length ? await db.getAll(...ids.map((id) => db.collection(Collections.accounts).doc(id))) : [];
    return accounts
      .flatMap((s) => {
        const a = s.data() as AccountRecord | undefined;
        return a ? [{ accountId: a.accountId, name: a.displayName || a.primaryEmail || a.accountId }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Every account's active roles, by accountId. Role holders are the few admins, so one query reads them all. */
  async allActiveRoles(): Promise<Map<string, Role[]>> {
    const snap = await this.firebase.db.collection(Collections.roleAssignments).where('revokedAt', '==', null).get();
    const byAccount = new Map<string, Role[]>();
    for (const doc of snap.docs) {
      const { accountId, role } = doc.data() as RoleAssignmentRecord;
      byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), role].sort());
    }
    return byAccount;
  }
}

/** An account's primary email address and whether it is verified. */
export interface Mailbox {
  readonly email: string | null;
  readonly verified: boolean;
}

export function roleAssignmentId(accountId: string, role: Role): string {
  return `${accountId}_${role}`;
}
