import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  checkNewMember,
  Collections,
  existingEmailReason,
  memberAddition,
  planMemberImport,
  skipCounts,
  uuidv7,
  type AccountRecord,
  type AddMemberInput,
  type ExistingEmail,
  type MemberImportPlan,
  type MemberImportResult,
  type MemberImportRow,
  type MemberRecord,
  type PlannedMemberRow,
  type SkippedMemberRow,
  type WelcomeAgain,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { Firebase } from '../infra/firebase.js';
import { WelcomeEmails } from '../notifications/welcome-emails.js';
import { MemberRepository } from './member.repository.js';
import { Members } from './members.service.js';
import { MembershipService } from './membership.service.js';

/** Members added in one transaction: each writes its account, member record, history, ledger entry and welcome email. */
const PER_TRANSACTION = 25;

/** Firestore's largest `in` filter. */
const IN_LIMIT = 30;

/**
 * Members a Membership Admin adds (design §5.13), on the form or from a CSV file: Active at once, with an account
 * that has no login yet. The rules are `ustp-domain`'s (`planMemberImport`, `memberAddition`); here they meet what is
 * already stored, which is read again in each adding transaction, so an address that signed up since the preview is
 * skipped rather than given a second account. The member signs in later with a verified address (`AccountsService`).
 */
@Injectable()
export class MemberAdditions {
  constructor(
    private readonly firebase: Firebase,
    private readonly members: Members,
    private readonly repository: MemberRepository,
    private readonly membership: MembershipService,
    private readonly welcomes: WelcomeEmails,
  ) {}

  /** What importing these rows would do now; writes nothing. */
  async preview(rows: readonly MemberImportRow[]): Promise<MemberImportPlan> {
    return planMemberImport(rows, await this.existing(rows.map((r) => r.email)));
  }

  /** Adds one member from the form; its problems are field errors (400), an address already on the site 409. */
  async addOne(ctx: RequestContext, input: AddMemberInput): Promise<MemberImportResult> {
    const { reason, ...text } = input;
    const checked = checkNewMember(text);
    if (!checked.ok) {
      throw new BadRequestException({
        message: 'invalid request',
        errors: checked.problems.map((p) => ({ path: p.field ?? '', message: p.message })),
      });
    }
    const result = await this.add(ctx, [{ ...text, line: 1 }], reason);
    const skipped = result.skipped[0];
    if (skipped) throw new ConflictException(`${skipped.email} ${skipped.reasons.join('; ')}`);
    return result;
  }

  /** Imports a file's rows: adds those the plan adds, and says why it skipped the rest. */
  import(ctx: RequestContext, rows: readonly MemberImportRow[], reason: string): Promise<MemberImportResult> {
    return this.add(ctx, rows, reason);
  }

  /**
   * Queues an added member's welcome email again (design §5.13), or, where the deployment sends no mail, gives the
   * address for the admin's browser to ask Identity Platform for its link. Only before the member has signed in.
   */
  async welcomeAgain(ctx: RequestContext, accountId: string): Promise<WelcomeAgain> {
    const actor = requireAccount(ctx);
    const db = this.firebase.db;
    return db.runTransaction(async (tx) => {
      const account = (await tx.get(db.collection(Collections.accounts).doc(accountId))).data() as AccountRecord | undefined;
      if (!account?.addedAt || !account.primaryEmail) throw new NotFoundException('no member added by a Membership Admin has this account');
      if (account.claimedAt) throw new ConflictException('this member has signed in already, so needs no welcome email');
      const latest = await this.welcomes.latest(tx, accountId);
      this.welcomes.again(tx, latest, accountId, actor);
      return { welcome: this.welcomes.delivery, email: account.primaryEmail };
    });
  }

  private async add(ctx: RequestContext, rows: readonly MemberImportRow[], reason: string): Promise<MemberImportResult> {
    const actor = requireAccount(ctx);
    const plan = await this.preview(rows);
    const result: { added: MemberImportResult['added'][number][]; skipped: SkippedMemberRow[] } = {
      added: [],
      skipped: plan.rows.filter((r) => !r.add).map(skippedRow),
    };
    const adding = plan.rows.filter((r) => r.add);
    for (let i = 0; i < adding.length; i += PER_TRANSACTION) {
      const done = await this.addSome(actor, adding.slice(i, i + PER_TRANSACTION), reason);
      result.added.push(...done.added);
      result.skipped.push(...done.skipped);
    }
    result.skipped.sort((a, b) => a.line - b.line);
    return { ...result, skippedBy: skipCounts(result.skipped), welcome: this.welcomes.delivery };
  }

  /** Adds up to PER_TRANSACTION planned rows in one transaction, skipping any address taken since the plan. */
  private async addSome(actor: string, rows: readonly PlannedMemberRow[], reason: string) {
    const db = this.firebase.db;
    return db.runTransaction(async (tx) => {
      const bylaws = await this.membership.currentBylaws(tx);
      if (!bylaws) throw new ConflictException('publish the bylaws before adding members (Admin › Bylaws)');
      const taken = await this.existing(
        rows.map((r) => r.email),
        tx,
      );
      const at = new Date().toISOString();
      const fresh = rows.filter((r) => !taken.has(r.email));
      const additions = fresh.map((row) => {
        const accountId = uuidv7();
        return { row, accountId, transition: memberAddition({ accountId, member: row.member!, actor, reason, bylawsVersion: bylaws.version, at }) };
      });
      await this.members.recordAll(
        tx,
        additions.map((a) => a.transition),
      );
      for (const { row, accountId } of additions) {
        const member = row.member!;
        const account: AccountRecord = {
          accountId,
          displayName: member.preferredName ?? member.legalName,
          primaryEmail: member.email,
          emailVerified: false,
          createdAt: at,
          addedAt: at,
          addedBy: actor,
          claimedAt: null,
        };
        tx.create(db.collection(Collections.accounts).doc(accountId), account);
        this.welcomes.queue(tx, accountId, actor, at);
      }
      return {
        added: additions.map(({ row, accountId }) => ({ line: row.line, email: row.email, legalName: row.legalName, accountId })),
        skipped: rows
          .filter((r) => taken.has(r.email))
          .map((r): SkippedMemberRow => ({
            line: r.line,
            email: r.email,
            legalName: r.legalName,
            reasons: [existingEmailReason(taken.get(r.email)!)],
            cause: 'on_site',
          })),
      };
    });
  }

  /** Which of these addresses are on the site already, and how (by lowercase email); read in `tx` when given. */
  private async existing(emails: readonly string[], tx?: Transaction): Promise<Map<string, ExistingEmail>> {
    const db = this.firebase.db;
    const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const accounts: AccountRecord[] = [];
    for (let i = 0; i < wanted.length; i += IN_LIMIT) {
      const query = db.collection(Collections.accounts).where('primaryEmail', 'in', wanted.slice(i, i + IN_LIMIT));
      const snap = tx ? await tx.get(query) : await query.get();
      accounts.push(...snap.docs.map((d) => d.data() as AccountRecord));
    }
    const ids = accounts.map((a) => a.accountId);
    const members = tx ? await this.repository.getAll(tx, ids) : await this.repository.findMany(ids);
    const found = new Map<string, ExistingEmail>();
    accounts.forEach((account, i) => {
      const member: MemberRecord | null = members[i] ?? null;
      const email = account.primaryEmail!;
      // An address with a membership is reported as one, whichever of its accounts comes first.
      if (member) found.set(email, { kind: 'member', status: member.status, waiting: account.claimedAt === null });
      else if (!found.has(email)) found.set(email, { kind: 'login' });
    });
    return found;
  }
}

function skippedRow(row: PlannedMemberRow): SkippedMemberRow {
  return { line: row.line, email: row.email, legalName: row.legalName, reasons: row.reasons, cause: row.cause! };
}
