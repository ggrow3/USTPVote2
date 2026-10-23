import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { Collections, type IdentityRecord, type Role, type RoleAssignmentRecord } from 'ustp-domain';
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

export function roleAssignmentId(accountId: string, role: Role): string {
  return `${accountId}_${role}`;
}
