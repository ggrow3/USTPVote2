import { randomBytes } from 'node:crypto';
import { ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, NotFoundException, Param, Post, Redirect } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  isUnsubscribeToken,
  UNSUBSCRIBE_PATH,
  type MailPreferenceRecord,
  type MailRestoreInput,
  type MailStopInput,
  type MailStopRow,
  type MemberEmailStoppedPayload,
  type UnsubscribeStatus,
} from 'ustp-domain';
import { Public, requireAccount } from '../auth/decorators.js';
import { DirectoryService } from '../auth/directory.service.js';
import type { RequestContext } from '../auth/principal.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { MailRepository } from './mail.repository.js';

/**
 * Who gets none of the site's email (design §10.12): members who unsubscribed, by an email's link or on their Account
 * page, and members a Membership or System Admin stopped email to, which is ledgered and shown to the member. `Mailer`
 * is what holds to it.
 */
@Injectable()
export class MailPreferences {
  constructor(
    private readonly firebase: Firebase,
    private readonly mail: MailRepository,
    private readonly ledger: LedgerService,
    private readonly directory: DirectoryService,
    private readonly members: MemberDirectory,
  ) {}

  find(accountId: string): Promise<MailPreferenceRecord | null> {
    return this.mail.preference(accountId);
  }

  /** The account's link token, made the first time an email goes to it. */
  async token(accountId: string): Promise<string> {
    const found = await this.mail.preference(accountId);
    if (found) return found.token;
    return this.firebase.db.runTransaction(async (tx) => {
      const current = await this.load(tx, accountId);
      this.mail.setPreference(tx, current);
      return current.token;
    });
  }

  /** The record as it stands, or a new one with its token, which the caller saves. */
  private async load(tx: Transaction, accountId: string): Promise<MailPreferenceRecord> {
    return (
      (await this.mail.preference(accountId, tx)) ?? {
        accountId,
        token: randomBytes(32).toString('base64url'),
        unsubscribedAt: null,
        stoppedAt: null,
        stoppedBy: null,
      }
    );
  }

  /** The member's own choice: on their Account page, or by an email's link. Keeps the first date while it stands. */
  async setUnsubscribed(accountId: string, unsubscribed: boolean): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.load(tx, accountId);
      if (!!current.unsubscribedAt === unsubscribed) return this.mail.setPreference(tx, current);
      this.mail.setPreference(tx, { ...current, unsubscribedAt: unsubscribed ? new Date().toISOString() : null });
    });
  }

  /** Whether a link's account has unsubscribed; null for a link that is no one's. */
  async linkStatus(token: string): Promise<UnsubscribeStatus | null> {
    const found = await this.mail.preferenceByToken(token);
    return found && { unsubscribed: !!found.unsubscribedAt };
  }

  /** Unsubscribes a link's account; false for a link that is no one's. Saying so again changes nothing. */
  async unsubscribeLink(token: string): Promise<boolean> {
    const found = await this.mail.preferenceByToken(token);
    if (!found) return false;
    await this.setUnsubscribed(found.accountId, true);
    return true;
  }

  /** Everyone who gets no email because of this, latest first, for Membership and System Admins. */
  async stops(): Promise<MailStopRow[]> {
    const records = await this.mail.stoppedPreferences();
    const ids = records.map((r) => r.accountId);
    const everyone = [...new Set([...ids, ...records.flatMap((r) => (r.stoppedBy ? [r.stoppedBy] : []))])];
    const [mailboxes, names, members] = await Promise.all([this.directory.mailboxes(everyone), this.directory.displayNames(everyone), this.members.findMany(ids)]);
    return records
      .map((r, i) => ({
        accountId: r.accountId,
        name: members[i]?.preferredName || members[i]?.legalName || names.get(r.accountId) || null,
        email: mailboxes.get(r.accountId)?.email ?? null,
        unsubscribedAt: r.unsubscribedAt,
        stoppedAt: r.stoppedAt,
        // An admin may have no member record: their name on the account, or else their address.
        stoppedBy: r.stoppedBy ? (names.get(r.stoppedBy) ?? mailboxes.get(r.stoppedBy)?.email ?? null) : null,
      }))
      .sort((a, b) => (b.stoppedAt ?? b.unsubscribedAt ?? '').localeCompare(a.stoppedAt ?? a.unsubscribedAt ?? ''));
  }

  /** An admin stops email to a member, by their address or ID. Not their own: they can unsubscribe on their Account page. */
  async stop(ctx: RequestContext, input: MailStopInput): Promise<void> {
    const accountId = input.accountId ?? (await this.directory.accountWithEmail(input.email!));
    if (!accountId || !(await this.directory.mailboxes([accountId])).has(accountId)) throw new NotFoundException('no member has that email address');
    await this.setStopped(ctx, accountId, true, input.reason);
  }

  /** An admin lets email go to the member again; their own unsubscribing, if any, still stands. */
  restore(ctx: RequestContext, accountId: string, input: MailRestoreInput): Promise<void> {
    return this.setStopped(ctx, accountId, false, input.reason);
  }

  private async setStopped(ctx: RequestContext, accountId: string, stopped: boolean, reason: string): Promise<void> {
    const actor = requireAccount(ctx);
    if (accountId === actor) throw new ForbiddenException('nobody stops or restores their own email here; use your Account page');
    await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.load(tx, accountId);
      if (!!current.stoppedAt === stopped) {
        throw new ConflictException(stopped ? 'email to this member is stopped already' : 'email to this member is not stopped');
      }
      const payload: MemberEmailStoppedPayload = { stopped, reason };
      await this.ledger.record(tx, [{ type: 'member.email_stopped', actor, subject: accountId, payload: { ...payload } }]);
      this.mail.setPreference(tx, { ...current, stoppedAt: stopped ? new Date().toISOString() : null, stoppedBy: stopped ? actor : null });
    });
  }
}

/**
 * An email's unsubscribe link (design §10.12), for anyone holding it and no sign-in. A GET never changes anything, since
 * mail scanners open links by themselves: it goes to the web page, whose button makes the POST. Mail clients' own
 * Unsubscribe button makes the POST directly (`List-Unsubscribe-Post`, RFC 8058).
 */
@Controller('v1/public/unsubscribe')
@Public()
export class UnsubscribeController {
  constructor(
    private readonly preferences: MailPreferences,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  @Get(':token')
  @Redirect()
  open(@Param('token') token: string) {
    const known = isUnsubscribeToken(token) ? `?token=${encodeURIComponent(token)}` : '';
    return { url: `${this.config.webOrigin ?? ''}${UNSUBSCRIBE_PATH}${known}`, statusCode: 302 };
  }

  @Get(':token/status')
  async status(@Param('token') token: string): Promise<UnsubscribeStatus> {
    const status = isUnsubscribeToken(token) ? await this.preferences.linkStatus(token) : null;
    if (!status) throw new NotFoundException('this unsubscribe link is not valid');
    return status;
  }

  /** Any body is ignored: mail clients send `List-Unsubscribe=One-Click` as a form. */
  @Post(':token')
  @HttpCode(200)
  async unsubscribe(@Param('token') token: string): Promise<UnsubscribeStatus> {
    if (!isUnsubscribeToken(token) || !(await this.preferences.unsubscribeLink(token))) throw new NotFoundException('this unsubscribe link is not valid');
    return { unsubscribed: true };
  }
}
