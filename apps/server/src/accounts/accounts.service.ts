import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  Collections,
  isSignInProvider,
  uuidv7,
  type AccountRecord,
  type IdentityRecord,
  type MemberRecord,
  type Role,
  type RoleAssignmentRecord,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import { DirectoryService, roleAssignmentId } from '../auth/directory.service.js';
import { principalFromToken, type Principal, type RequestContext } from '../auth/principal.js';
import { SignInMethodsService } from '../auth/sign-in-methods.service.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';

/** A second sign-in used to link a login method must be this fresh. */
const LINK_MAX_AUTH_AGE_SECONDS = 5 * 60;

export interface MeResponse {
  readonly account: AccountRecord | null;
  readonly identities: readonly IdentityRecord[];
  readonly member: MemberRecord | null;
  readonly roles: readonly Role[];
}

/** USTP accounts and the logins linked to them (design §4). */
@Injectable()
export class AccountsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly directory: DirectoryService,
    private readonly signInMethods: SignInMethodsService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async me(ctx: RequestContext): Promise<MeResponse> {
    const accountId = ctx.accountId;
    if (!accountId) return { account: null, identities: [], member: null, roles: [] };
    const db = this.firebase.db;
    const [account, identities, member, roles] = await Promise.all([
      db.collection(Collections.accounts).doc(accountId).get(),
      db.collection(Collections.accountIdentities).where('accountId', '==', accountId).get(),
      db.collection(Collections.members).doc(accountId).get(),
      this.directory.activeRoles(accountId),
    ]);
    return {
      account: (account.data() as AccountRecord | undefined) ?? null,
      identities: identities.docs.map((d) => d.data() as IdentityRecord),
      member: (member.data() as MemberRecord | undefined) ?? null,
      roles,
    };
  }

  /** Mints the caller's account on first sign-in. Idempotent: a uid that already has an account gets it back. */
  async create(ctx: RequestContext): Promise<{ readonly created: boolean; readonly accountId: string }> {
    const { principal } = ctx;
    const db = this.firebase.db;
    const bootstrap =
      principal.emailVerified && principal.email !== null && this.config.bootstrapSystemAdmins.includes(principal.email);

    return db.runTransaction(async (tx) => {
      const identityRef = db.collection(Collections.accountIdentities).doc(principal.uid);
      const existing = await tx.get(identityRef);
      if (existing.exists) return { created: false, accountId: (existing.data() as IdentityRecord).accountId };

      const accountId = uuidv7();
      const now = new Date().toISOString();
      if (bootstrap) {
        await this.ledger.record(tx, [
          {
            type: 'role.granted',
            actor: 'bootstrap',
            subject: accountId,
            payload: { role: 'system_admin', reason: 'BOOTSTRAP_SYSTEM_ADMIN_EMAILS' },
          },
        ]);
      }
      const account: AccountRecord = {
        accountId,
        displayName: principal.name,
        primaryEmail: principal.email,
        emailVerified: principal.emailVerified,
        createdAt: now,
      };
      tx.create(db.collection(Collections.accounts).doc(accountId), account);
      tx.create(identityRef, identityRecord(principal, accountId, now));
      if (bootstrap) {
        const role: RoleAssignmentRecord = {
          accountId,
          role: 'system_admin',
          grantedAt: now,
          grantedBy: 'bootstrap',
          approvedBy: null,
          approvalId: null,
          revokedAt: null,
          revokedBy: null,
        };
        tx.create(db.collection(Collections.roleAssignments).doc(roleAssignmentId(accountId, 'system_admin')), role);
      }
      return { created: true, accountId };
    });
  }

  /** Links another login to the caller's account; `idToken` proves the caller controls it right now. */
  async link(ctx: RequestContext, idToken: string): Promise<IdentityRecord> {
    const accountId = requireAccount(ctx);
    let other: Principal;
    try {
      other = principalFromToken(await this.firebase.auth.verifyIdToken(idToken, true));
    } catch {
      throw new BadRequestException('the second sign-in is invalid or expired');
    }
    if (other.uid === ctx.principal.uid) throw new BadRequestException('that is the login you are already using');
    if (!(await this.signInMethods.isEnabled(other.provider))) {
      throw new ForbiddenException(`sign-in with ${other.provider} is not enabled`);
    }
    if (Date.now() / 1000 - other.authTime > LINK_MAX_AUTH_AGE_SECONDS) {
      throw new BadRequestException('sign in with the new method again, then retry');
    }

    const db = this.firebase.db;
    return db.runTransaction(async (tx) => {
      const ref = db.collection(Collections.accountIdentities).doc(other.uid);
      const snap = await tx.get(ref);
      if (snap.exists) {
        const owner = (snap.data() as IdentityRecord).accountId;
        throw new ConflictException(owner === accountId ? 'already linked to your account' : 'that login belongs to another account');
      }
      await this.ledger.record(tx, [
        { type: 'identity.linked', actor: accountId, subject: accountId, payload: { uid: other.uid, provider: other.provider } },
      ]);
      const record = identityRecord(other, accountId, new Date().toISOString());
      tx.create(ref, record);
      return record;
    });
  }

  async unlink(ctx: RequestContext, uid: string): Promise<void> {
    const accountId = requireAccount(ctx);
    const db = this.firebase.db;
    await db.runTransaction(async (tx) => {
      const mine = await tx.get(db.collection(Collections.accountIdentities).where('accountId', '==', accountId));
      const target = mine.docs.find((d) => d.id === uid);
      if (!target) throw new NotFoundException('no such login on your account');
      if (mine.size <= 1) throw new ConflictException('you cannot remove your only login method');
      const { provider } = target.data() as IdentityRecord;
      await this.ledger.record(tx, [{ type: 'identity.unlinked', actor: accountId, subject: accountId, payload: { uid, provider } }]);
      tx.delete(target.ref);
    });
  }
}

function identityRecord(principal: Principal, accountId: string, linkedAt: string): IdentityRecord {
  if (!isSignInProvider(principal.provider)) throw new ForbiddenException(`unsupported sign-in provider ${principal.provider}`);
  return { uid: principal.uid, accountId, provider: principal.provider, email: principal.email, linkedAt };
}
