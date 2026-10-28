import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Query } from 'firebase-admin/firestore';
import {
  Collections,
  DEFAULT_ACCOUNT_PREFERENCES,
  isSignInProvider,
  uuidv7,
  type AccountPreferences,
  type AccountPreferencesInput,
  type AccountRecord,
  type AccountSummary,
  type IdentityRecord,
  type MeResponse,
  type Role,
  type RoleAssignmentRecord,
} from 'ustp-domain';
import { requireAccount, requireOwnAccount } from '../auth/decorators.js';
import { DirectoryService, roleAssignmentId } from '../auth/directory.service.js';
import { principalFromToken, type Principal, type RequestContext } from '../auth/principal.js';
import { SignInMethodsService } from '../auth/sign-in-methods.service.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';

/** A second sign-in used to link a login method must be this fresh. */
const LINK_MAX_AUTH_AGE_SECONDS = 5 * 60;

/** `GET /v1/admin/accounts` parameters; `after` is the accountId of the previous page's last row. */
export interface AccountQuery {
  /** Lowercase primary-email prefix. */
  readonly email: string | undefined;
  /** Only accounts holding this role, or any role. */
  readonly role: Role | 'any' | undefined;
  readonly after: string | undefined;
  readonly limit: number;
}

/** USTP accounts and the logins linked to them (design §4). */
@Injectable()
export class AccountsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly directory: DirectoryService,
    private readonly signInMethods: SignInMethodsService,
    private readonly members: MemberDirectory,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async me(ctx: RequestContext): Promise<MeResponse> {
    const accountId = ctx.accountId;
    const signedInWithMfa = ctx.principal.mfa;
    const testing = { enabled: this.config.testingMode, operator: ctx.operator };
    if (!accountId) {
      return { account: null, identities: [], member: null, roles: [], mfa: { required: false, signedInWithMfa }, testing };
    }
    const db = this.firebase.db;
    const [account, identities, member, roles] = await Promise.all([
      db.collection(Collections.accounts).doc(accountId).get(),
      db.collection(Collections.accountIdentities).where('accountId', '==', accountId).get(),
      this.members.find(accountId),
      this.directory.activeRoles(accountId),
    ]);
    return {
      account: (account.data() as AccountRecord | undefined) ?? null,
      identities: identities.docs.map((d) => d.data() as IdentityRecord),
      member,
      roles,
      mfa: { required: this.config.adminMfaRequired && roles.length > 0, signedInWithMfa },
      testing,
    };
  }

  /**
   * The caller's own display choices (design §4.1), such as the daily quote and joke. Not ledgered: they decide nothing.
   * A Membership Admin reads them on the member's profile.
   */
  async updatePreferences(ctx: RequestContext, input: AccountPreferencesInput): Promise<AccountPreferences> {
    const ref = this.firebase.db.collection(Collections.accounts).doc(requireAccount(ctx));
    if (!(await ref.get()).exists) throw new NotFoundException('create your account first (POST /v1/accounts)');
    const preferences: AccountPreferences = { ...DEFAULT_ACCOUNT_PREFERENCES, ...input };
    await ref.update({ preferences });
    return preferences;
  }

  /**
   * The People list (design §10.3): accounts by primary email, each with its member status and active roles. With
   * `role`, only role holders, gathered from their assignments instead of by paging through every account.
   */
  async list(query: AccountQuery): Promise<AccountSummary[]> {
    const db = this.firebase.db;
    const accounts = db.collection(Collections.accounts);
    const [roles, cursor] = await Promise.all([this.directory.allActiveRoles(), query.after ? accounts.doc(query.after).get() : null]);
    if (cursor && !cursor.exists) throw new BadRequestException('invalid query parameter after');

    let page: AccountRecord[];
    if (query.role) {
      const wanted = query.role;
      const holders = [...roles].filter(([, held]) => wanted === 'any' || held.includes(wanted)).map(([id]) => id);
      const snaps = holders.length ? await db.getAll(...holders.map((id) => accounts.doc(id))) : [];
      const found = snaps.flatMap((s) => (s.exists ? [s.data() as AccountRecord] : []));
      page = pageOf(found, query.email, (cursor?.data() as AccountRecord | undefined) ?? null, query.limit);
    } else {
      let q: Query = accounts.orderBy('primaryEmail');
      if (query.email) q = q.where('primaryEmail', '>=', query.email).where('primaryEmail', '<', `${query.email}\uf8ff`);
      if (cursor) q = q.startAfter(cursor);
      page = (await q.limit(query.limit).get()).docs.map((d) => d.data() as AccountRecord);
    }

    const members = await this.members.findMany(page.map((a) => a.accountId));
    return page.map((a, i) => ({
      accountId: a.accountId,
      displayName: a.displayName,
      primaryEmail: a.primaryEmail,
      emailVerified: a.emailVerified,
      createdAt: a.createdAt,
      memberStatus: members[i]?.status ?? null,
      roles: roles.get(a.accountId) ?? [],
    }));
  }

  /**
   * Mints the caller's account on first sign-in. Idempotent: a uid that already has an account gets it back.
   * Each call also applies the bootstrap System Admin grant once the email is verified (password sign-ups start
   * unverified), but only to an account that has never held the role, so a revocation is never undone.
   */
  async create(ctx: RequestContext): Promise<{ readonly created: boolean; readonly accountId: string }> {
    const { principal } = ctx;
    const db = this.firebase.db;
    const bootstrapEligible =
      principal.emailVerified && principal.email !== null && this.config.bootstrapSystemAdmins.includes(principal.email);

    return db.runTransaction(async (tx) => {
      const identityRef = db.collection(Collections.accountIdentities).doc(principal.uid);
      const existing = await tx.get(identityRef);
      const accountId = existing.exists ? (existing.data() as IdentityRecord).accountId : uuidv7();
      const roleRef = db.collection(Collections.roleAssignments).doc(roleAssignmentId(accountId, 'system_admin'));
      const bootstrap = bootstrapEligible && !(existing.exists && (await tx.get(roleRef)).exists);
      if (existing.exists && !bootstrap) return { created: false, accountId };

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
      if (!existing.exists) {
        const account: AccountRecord = {
          accountId,
          displayName: principal.name,
          primaryEmail: principal.email,
          emailVerified: principal.emailVerified,
          createdAt: now,
        };
        tx.create(db.collection(Collections.accounts).doc(accountId), account);
        tx.create(identityRef, identityRecord(principal, accountId, now));
      }
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
        tx.create(roleRef, role);
      }
      return { created: !existing.exists, accountId };
    });
  }

  /** Links another login to the caller's account; `idToken` proves the caller controls it right now. */
  async link(ctx: RequestContext, idToken: string): Promise<IdentityRecord> {
    requireOwnAccount(ctx);
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
    requireOwnAccount(ctx);
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

/**
 * The People-list order, as Firestore sorts `orderBy('primaryEmail')`: accounts without an email first, then by
 * email, ties by document ID (the accountId).
 */
export function compareAccounts(a: AccountRecord, b: AccountRecord): number {
  const order = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  if (a.primaryEmail === b.primaryEmail) return order(a.accountId, b.accountId);
  if (a.primaryEmail === null) return -1;
  if (b.primaryEmail === null) return 1;
  return order(a.primaryEmail, b.primaryEmail);
}

/** One page of accounts already in memory, with the same email prefix, order and cursor as the Firestore query. */
export function pageOf(
  accounts: readonly AccountRecord[],
  email: string | undefined,
  after: AccountRecord | null,
  limit: number,
): AccountRecord[] {
  return accounts
    .filter((a) => !email || (a.primaryEmail?.startsWith(email) ?? false))
    .filter((a) => !after || compareAccounts(a, after) > 0)
    .sort(compareAccounts)
    .slice(0, limit);
}

function identityRecord(principal: Principal, accountId: string, linkedAt: string): IdentityRecord {
  if (!isSignInProvider(principal.provider)) throw new ForbiddenException(`unsupported sign-in provider ${principal.provider}`);
  return { uid: principal.uid, accountId, provider: principal.provider, email: principal.email, linkedAt };
}
