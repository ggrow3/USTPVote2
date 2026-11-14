import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Query, Transaction } from 'firebase-admin/firestore';
import {
  checkCanDeleteAccount,
  checkRoleChange,
  Collections,
  DEFAULT_ACCOUNT_PREFERENCES,
  isSignInProvider,
  secondFactorScope,
  uuidv7,
  type AccountPreferences,
  type AccountPreferencesInput,
  type AccountRecord,
  type AccountSummary,
  type Actor,
  type IdentityRecord,
  type LedgerEvent,
  type MeResponse,
  type Role,
  type RoleAssignmentRecord,
} from 'ustp-domain';
import { requireAccount, requireOwnAccount } from '../auth/decorators.js';
import { DirectoryService, roleAssignmentId } from '../auth/directory.service.js';
import { MfaPolicyService } from '../auth/mfa-policy.js';
import { actorOf, principalFromToken, type Principal, type RequestContext } from '../auth/principal.js';
import { SignInMethodsService } from '../auth/sign-in-methods.service.js';
import { assertCheck } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ElectionReader } from '../elections/election-reader.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { Members } from '../membership/members.service.js';
import { InboxRecords } from '../inbox/inbox.service.js';
import { DiscordLinkRecords } from '../discord/discord-links.js';
import { MailRecords } from '../notifications/mail-records.js';
import { ReferralCodes } from '../referrals/referrals.js';
import { EmailVerifiedSync } from './email-verified-sync.js';

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
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly directory: DirectoryService,
    private readonly signInMethods: SignInMethodsService,
    private readonly members: MemberDirectory,
    private readonly membership: Members,
    private readonly elections: ElectionReader,
    private readonly mfaPolicy: MfaPolicyService,
    private readonly mailRecords: MailRecords,
    private readonly inboxRecords: InboxRecords,
    private readonly emailSync: EmailVerifiedSync,
    private readonly referrals: ReferralCodes,
    private readonly discordLinks: DiscordLinkRecords,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async me(ctx: RequestContext): Promise<MeResponse> {
    const accountId = ctx.accountId;
    const signedInWithMfa = ctx.principal.mfa;
    const testing = { enabled: this.config.testingMode, operator: ctx.operator };
    const policy = await this.mfaPolicy.current();
    /** Where this caller needs a second factor (design §4); nowhere when the deployment switches MFA off (emulators only). */
    const mfa = (roles: readonly Role[]): MeResponse['mfa'] => {
      const scope = this.config.adminMfaRequired ? secondFactorScope(roles, policy) : 'none';
      return { required: scope !== 'none', everywhere: scope === 'everywhere', signedInWithMfa };
    };
    if (!accountId) return { account: null, identities: [], member: null, roles: [], mfa: mfa([]), testing, mail: null };
    const db = this.firebase.db;
    const [account, identities, member, roles, mail] = await Promise.all([
      db.collection(Collections.accounts).doc(accountId).get(),
      db.collection(Collections.accountIdentities).where('accountId', '==', accountId).get(),
      this.members.find(accountId),
      this.directory.activeRoles(accountId),
      this.mailRecords.state(accountId),
    ]);
    return {
      account: (account.data() as AccountRecord | undefined) ?? null,
      identities: identities.docs.map((d) => d.data() as IdentityRecord),
      member,
      roles,
      mfa: mfa(roles),
      testing,
      mail,
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
      onDeletionList: this.onDeletionList(a),
    }));
  }

  /**
   * Deletes an account (design §4): one System Admin, at once, only an account on the deployment's deletion list that
   * no election has on its roll or among those who voted. Its logins go first, from Identity Platform, so a failure
   * later leaves an account nobody can sign in to, which deleting again finishes. Then one transaction ledgers
   * `role.revoked` for each active role, `identity.unlinked` for each login and `account.deleted`, and deletes the
   * account, its logins, its role assignments, the requests about it and its membership (member record, status history,
   * applications); last, its sign-ins, page visits and course records. Ledger entries about it stay.
   */
  async delete(ctx: RequestContext, accountId: string, reason: string): Promise<void> {
    const deletedBy = requireAccount(ctx);
    const actor = actorOf(ctx, this.config.adminMfaRequired);
    const db = this.firebase.db;

    const before = await this.deletable(actor, accountId);
    const uids = before.identities.map((i) => i.uid);
    const removed = uids.length ? await this.firebase.auth.deleteUsers(uids) : null;
    if (removed?.failureCount) {
      const why = removed.errors.map((e) => e.error.message).join('; ');
      this.logger.warn(`account ${accountId}: Identity Platform kept ${removed.failureCount} of its logins: ${why}`);
      throw new ServiceUnavailableException('could not delete its logins from Identity Platform; nothing else was deleted, so try again');
    }

    const later = await db.runTransaction(async (tx) => {
      const found = await this.deletable(actor, accountId, tx);
      await this.erase(tx, found, deletedBy, reason);
      // A login linked since the first look is deleted from Identity Platform below.
      return found.identities.map((i) => i.uid).filter((uid) => !uids.includes(uid));
    });

    if (later.length) {
      await this.firebase.auth.deleteUsers(later).catch((e: unknown) => {
        this.logger.warn(`account ${accountId} deleted, but not its logins ${later.join(', ')}: ${e instanceof Error ? e.message : String(e)}`);
      });
    }
    // Records about what the account did, too many for the transaction; a failure leaves them to expire or be found.
    await this.forgetActivity(accountId, [...uids, ...later]).catch((e: unknown) => {
      this.logger.warn(`account ${accountId} deleted, but not all its activity: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  /**
   * The part of deleting an account done in one transaction (design §4), after the caller's own reads: ledgers
   * `role.revoked` for each active role, `identity.unlinked` for each of `identities` and `account.deleted`, all by
   * `deletedBy`, and deletes the account, those logins, its role assignments, the requests about it and its membership.
   * Its Identity Platform users and its activity (`forgetActivity`) are the caller's to delete, outside the transaction.
   * Test voters are deleted through this too (design §10.4).
   */
  async erase(
    tx: Transaction,
    found: { readonly account: AccountRecord; readonly identities: readonly IdentityRecord[] },
    deletedBy: string,
    reason: string,
  ): Promise<void> {
    const db = this.firebase.db;
    const { accountId } = found.account;
    const [assignments, requests, forgetMembership] = await Promise.all([
      tx.get(db.collection(Collections.roleAssignments).where('accountId', '==', accountId)),
      tx.get(db.collection(Collections.approvalRequests).where('subject', '==', accountId)),
      this.membership.forgetting(tx, accountId),
    ]);
    const active = assignments.docs.map((d) => d.data() as RoleAssignmentRecord).filter((r) => r.revokedAt === null);
    const first = [...found.identities].sort((a, b) => (a.linkedAt < b.linkedAt ? -1 : a.linkedAt > b.linkedAt ? 1 : 0))[0];
    await this.ledger.record(tx, [
      ...active.map((r) => ({ type: 'role.revoked' as const, actor: deletedBy, subject: accountId, payload: { role: r.role, reason } })),
      ...found.identities.map((i) => ({
        type: 'identity.unlinked' as const,
        actor: deletedBy,
        subject: accountId,
        payload: { uid: i.uid, provider: i.provider, reason },
      })),
      {
        type: 'account.deleted',
        actor: deletedBy,
        subject: accountId,
        payload: { email: found.account.primaryEmail, uid: first?.uid ?? null, reason },
      },
    ]);
    tx.delete(db.collection(Collections.accounts).doc(accountId));
    for (const i of found.identities) tx.delete(db.collection(Collections.accountIdentities).doc(i.uid));
    for (const doc of [...assignments.docs, ...requests.docs]) tx.delete(doc.ref);
    forgetMembership();
  }

  private onDeletionList(account: AccountRecord): boolean {
    return account.primaryEmail !== null && this.config.deletableAccountEmails.includes(account.primaryEmail);
  }

  /**
   * The account and its logins, if the actor may delete it now (`checkCanDeleteAccount`): it exists, is on the
   * deletion list, and no election has it on its roll or among those who voted. Read in `tx` when given.
   */
  private async deletable(
    actor: Actor,
    accountId: string,
    tx?: Transaction,
  ): Promise<{ readonly account: AccountRecord; readonly identities: IdentityRecord[] }> {
    const db = this.firebase.db;
    const accountRef = db.collection(Collections.accounts).doc(accountId);
    const logins = db.collection(Collections.accountIdentities).where('accountId', '==', accountId);
    const [account, inElections, identities] = await Promise.all([
      tx ? tx.get(accountRef) : accountRef.get(),
      this.elections.inAnyElection(accountId, tx),
      tx ? tx.get(logins) : logins.get(),
    ]);
    if (!account.exists) throw new NotFoundException('no such account');
    const record = account.data() as AccountRecord;
    const subject = { accountId, onDeletionList: this.onDeletionList(record), inElections };
    assertCheck(checkCanDeleteAccount(actor, subject), ForbiddenException);
    return { account: record, identities: identities.docs.map((d) => d.data() as IdentityRecord) };
  }

  /**
   * A deleted account's sign-ins (by account, and by login for those seen before it had one), page visits, its
   * courses' progress, attempts, certificates and messages, the welcome email of an added member (§5.13), and the
   * records of the email sent to it (§6.8), its notifications and messages (§10.13), its referral code (§5.18), and its
   * link to a Discord account (§10.18).
   */
  async forgetActivity(accountId: string, uids: readonly string[]): Promise<void> {
    const db = this.firebase.db;
    const collections = [
      Collections.signIns,
      Collections.pageVisits,
      Collections.courseProgress,
      Collections.courseAttempts,
      Collections.courseCertificates,
      Collections.courseThreads,
      Collections.courseMessages,
      Collections.welcomeEmails,
    ];
    const found = await Promise.all([
      ...collections.map((c) => db.collection(c).where('accountId', '==', accountId).select().get()),
      ...uids.map((uid) => db.collection(Collections.signIns).where('uid', '==', uid).select().get()),
    ]);
    const writer = db.bulkWriter();
    // A sign-in can be found both by account and by login.
    const refs = new Map(found.flatMap((snap) => snap.docs.map((d) => [d.ref.path, d.ref] as const)));
    for (const ref of refs.values()) void writer.delete(ref);
    await Promise.all([
      writer.close(),
      this.mailRecords.forgetAccount(accountId),
      this.inboxRecords.forgetAccount(accountId),
      this.referrals.forgetAccount(accountId),
      // The link loses its account now; the worker takes the Member role away on Discord and deletes it (§10.18).
      this.discordLinks.forgetAccount(accountId),
    ]);
  }

  /**
   * Mints the caller's account on first sign-in. Idempotent: a uid that already has an account gets it back.
   * A first sign-in whose address a Membership Admin added as a member (design §5.13) gets that account instead, once
   * the address is verified, since that proves the person controls it; until then nothing is minted, so the membership
   * stays theirs to reach. Each call also applies the bootstrap System Admin grant once the email is verified (password
   * sign-ups start unverified), but only to an account that has never held the role, so a revocation is never undone,
   * and only when the grant keeps to the role rules (design §10.1): an account that is an Auditor or already holds two
   * roles is left as it is until a System Admin brings it within them. A call from a login whose address is now verified
   * marks the account's primary email verified, if it is that address.
   */
  async create(ctx: RequestContext): Promise<{ readonly created: boolean; readonly accountId: string; readonly claimed?: true }> {
    const { principal } = ctx;
    this.emailSync.startOnce();
    const db = this.firebase.db;
    const bootstrapEligible =
      principal.emailVerified && principal.email !== null && this.config.bootstrapSystemAdmins.includes(principal.email);

    return db.runTransaction(async (tx) => {
      const identityRef = db.collection(Collections.accountIdentities).doc(principal.uid);
      const existing = await tx.get(identityRef);
      const added = existing.exists ? null : await this.addedAccount(tx, principal);
      const accountId = existing.exists ? (existing.data() as IdentityRecord).accountId : (added?.accountId ?? uuidv7());
      /** The account is already there: this login's, or the one a Membership Admin added. */
      const known = existing.exists || added !== null;
      const roleRef = db.collection(Collections.roleAssignments).doc(roleAssignmentId(accountId, 'system_admin'));
      let bootstrap = bootstrapEligible && !(known && (await tx.get(roleRef)).exists);
      if (bootstrap && known) {
        const fits = checkRoleChange(await this.directory.activeRoles(accountId, tx), 'grant', 'system_admin');
        if (!fits.ok) {
          this.logger.warn(`bootstrap System Admin grant for account ${accountId} skipped: ${fits.reason}`);
          bootstrap = false;
        }
      }
      if (existing.exists && !bootstrap) {
        await this.confirmEmail(tx, accountId, principal);
        return { created: false, accountId };
      }

      const now = new Date().toISOString();
      const events: LedgerEvent[] = [];
      if (added) {
        const payload = { uid: principal.uid, provider: principal.provider, claimed: true };
        events.push({ type: 'identity.linked', actor: accountId, subject: accountId, payload });
      }
      if (bootstrap) {
        const payload = { role: 'system_admin', reason: 'BOOTSTRAP_SYSTEM_ADMIN_EMAILS' };
        events.push({ type: 'role.granted', actor: 'bootstrap', subject: accountId, payload });
      }
      if (events.length) await this.ledger.record(tx, events);
      if (added) {
        const claimed: Partial<AccountRecord> = { claimedAt: now, emailVerified: true, displayName: added.displayName ?? principal.name };
        tx.update(db.collection(Collections.accounts).doc(accountId), claimed);
        tx.create(identityRef, identityRecord(principal, accountId, now));
      } else if (!existing.exists) {
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
      return added ? { created: false, accountId, claimed: true as const } : { created: !existing.exists, accountId };
    });
  }

  /**
   * Marks the account's primary email verified once its login says the address is (design §4): a password sign-up
   * starts unverified and confirms the address afterwards, and election email goes only to a verified address (§6.8).
   */
  private async confirmEmail(tx: Transaction, accountId: string, principal: Principal): Promise<void> {
    if (!principal.emailVerified || !principal.email) return;
    const ref = this.firebase.db.collection(Collections.accounts).doc(accountId);
    const account = (await tx.get(ref)).data() as AccountRecord | undefined;
    if (account && !account.emailVerified && account.primaryEmail?.toLowerCase() === principal.email.toLowerCase()) {
      tx.update(ref, { emailVerified: true });
    }
  }

  /**
   * The account a Membership Admin added for the caller's address and nobody has signed in to yet (design §5.13), read
   * in `tx`. Only a verified address may have it: a sign-in that merely names the address is refused (403) and gets no
   * account of its own, so the person confirms the address and comes back.
   */
  private async addedAccount(tx: Transaction, principal: Principal): Promise<AccountRecord | null> {
    if (!principal.email) return null;
    const waiting = await tx.get(
      this.firebase.db.collection(Collections.accounts).where('primaryEmail', '==', principal.email).where('claimedAt', '==', null).limit(1),
    );
    const account = (waiting.docs[0]?.data() as AccountRecord | undefined) ?? null;
    if (account && !principal.emailVerified) {
      throw new ForbiddenException(
        'A Membership Admin has added this email address as a member. Confirm the address first (open the confirmation email, ' +
          'or sign in with an emailed link), and your membership is yours.',
      );
    }
    return account;
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
