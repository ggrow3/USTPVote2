import { Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, Post } from '@nestjs/common';
import {
  checkMailRequest,
  mailAddressKey,
  mailAddressState,
  MY_EMAIL_DAYS,
  MY_EMAIL_SHOWN,
  type AdminTestView,
  type MailRequestKind,
  type MailRequestRecord,
  type MemberMailFlag,
  type MyEmailView,
  type MyMailState,
} from 'ustp-domain';
import { Ctx, requireAccount } from '../auth/decorators.js';
import { DirectoryService } from '../auth/directory.service.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { ElectionReader } from '../elections/election-reader.js';
import { Firebase } from '../infra/firebase.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { MailPreferences } from './mail-preferences.js';
import { MailRepository } from './mail.repository.js';
import { NoticeSettingsService } from './notice-settings.js';

/**
 * A member's own email (design §10.12): the emails sent to them in the last 90 days and what became of each, whether
 * their address can be mailed, and their requests for a test email or to try the address again, which the worker does
 * on its next tick. Also, for Membership Admins, which members cannot be emailed and why, never their messages.
 */
@Injectable()
export class MyEmailService {
  constructor(
    private readonly firebase: Firebase,
    private readonly mail: MailRepository,
    private readonly directory: DirectoryService,
    private readonly elections: ElectionReader,
    private readonly members: MemberDirectory,
    private readonly settings: NoticeSettingsService,
    private readonly preferences: MailPreferences,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Whether an account's address can be mailed, for `GET /v1/me`. */
  async state(accountId: string): Promise<MyMailState> {
    const [mailbox, preference] = await Promise.all([this.directory.mailboxes([accountId]).then((m) => m.get(accountId)), this.preferences.find(accountId)]);
    const email = mailbox?.email ?? null;
    const suppression = email ? await this.mail.suppression(mailAddressKey(email)) : null;
    return mailAddressState({ primaryEmail: email, emailVerified: mailbox?.verified ?? false }, suppression, preference);
  }

  async view(ctx: RequestContext): Promise<MyEmailView> {
    const accountId = requireAccount(ctx);
    const since = new Date(Date.now() - MY_EMAIL_DAYS * 86_400_000).toISOString();
    const [mailbox, state, messages, requests, settings, preference] = await Promise.all([
      this.directory.mailboxes([accountId]).then((m) => m.get(accountId)),
      this.state(accountId),
      this.mail.messagesOf(accountId, since, MY_EMAIL_SHOWN),
      this.mail.requestsOf(accountId),
      this.settings.current(),
      this.preferences.find(accountId),
    ]);
    const titles = new Map<string, string>();
    for (const id of new Set(messages.flatMap((m) => (m.electionId ? [m.electionId] : [])))) {
      const election = await this.elections.find(id);
      if (election) titles.set(id, election.title);
    }
    const day = Date.now() - 86_400_000;
    return {
      address: mailbox?.email ?? null,
      ...state,
      unsubscribedAt: preference?.unsubscribedAt ?? null,
      stoppedAt: preference?.stoppedAt ?? null,
      requestsEnabled: this.config.mailTransport !== 'off' && settings.allEmails && settings.emails.memberTests,
      messages: messages.map((m) => ({
        messageId: m.messageId,
        kind: m.kind,
        electionTitle: (m.electionId && titles.get(m.electionId)) || null,
        status: m.status,
        sentAt: m.sentAt,
        deliveredAt: m.deliveredAt,
        bouncedAt: m.bouncedAt,
        complainedAt: m.complainedAt,
      })),
      requests: requests
        .filter((r) => Date.parse(r.requestedAt) > day)
        .map(({ requestId, kind, requestedAt, status, doneAt, outcome, messageId }) => ({ requestId, kind, requestedAt, status, doneAt, outcome, messageId })),
    };
  }

  /** Who a System Admin's test can go to, the caller first, and how their last one went. */
  async adminTestView(ctx: RequestContext): Promise<AdminTestView> {
    const accountId = requireAccount(ctx);
    const [holders, requests] = await Promise.all([this.directory.roleHolders('system_admin'), this.mail.requestsOf(accountId)]);
    const mailboxes = await this.directory.mailboxes(holders.map((h) => h.accountId));
    const systemAdmins = holders
      .map((h) => ({ accountId: h.accountId, name: h.name, email: mailboxes.get(h.accountId)?.email ?? null }))
      .sort((a, b) => Number(b.accountId === accountId) - Number(a.accountId === accountId));
    const last = requests.find((r) => r.kind === 'admin_test');
    if (!last) return { systemAdmins, last: null };
    const to = last.to ?? last.accountId;
    const message = last.messageId ? await this.mail.message(last.messageId) : null;
    return {
      systemAdmins,
      last: {
        toName: holders.find((h) => h.accountId === to)?.name ?? null,
        status: last.status,
        outcome: last.outcome,
        doneAt: last.doneAt,
        delivery: message?.status ?? null,
      },
    };
  }

  /** Queues a System Admin's test for the worker, to them or another System Admin and nobody else (design §10.12). */
  async requestAdminTest(ctx: RequestContext, to: string | undefined): Promise<AdminTestView> {
    const recipient = to ?? requireAccount(ctx);
    const holders = await this.directory.roleHolders('system_admin');
    if (!holders.some((h) => h.accountId === recipient)) throw new ForbiddenException('a test email goes only to a System Admin');
    await this.request(ctx, 'admin_test', recipient);
    return this.adminTestView(ctx);
  }

  /** Queues a test email, or trying the address again, for the worker; one at a time, a few a day. */
  async request(ctx: RequestContext, kind: MailRequestKind, to?: string): Promise<MyEmailView> {
    const accountId = requireAccount(ctx);
    const [state, settings] = await Promise.all([this.state(to ?? accountId), this.settings.current()]);
    await this.firebase.db.runTransaction(async (tx) => {
      const theirs = await this.mail.requestsOf(accountId, tx);
      const now = new Date();
      assertCheck(
        checkMailRequest({
          kind,
          state: state.state,
          mailing: this.config.mailTransport !== 'off',
          enabled: kind === 'admin_test' || (settings.allEmails && settings.emails.memberTests),
          theirs,
          now,
        }),
      );
      const ref = this.mail.requestRef();
      const record: MailRequestRecord = {
        requestId: ref.id,
        accountId,
        ...(to && to !== accountId && { to }),
        kind,
        requestedAt: now.toISOString(),
        status: 'pending',
        claimedAt: null,
        doneAt: null,
        outcome: null,
        messageId: null,
      };
      this.mail.createRequest(tx, record);
    });
    return this.view(ctx);
  }

  /** The member's own choice to get no email from the party, or to get it again. Takes effect on the worker's next send. */
  async setUnsubscribed(ctx: RequestContext, unsubscribed: boolean): Promise<MyEmailView> {
    await this.preferences.setUnsubscribed(requireAccount(ctx), unsubscribed);
    return this.view(ctx);
  }

  /**
   * Members who cannot be emailed, and why: an admin stopped it, they unsubscribed, an address that bounced for good or
   * was marked as spam (while it is still their address), one never confirmed, or none. Only accounts with a member
   * record.
   */
  async flags(): Promise<MemberMailFlag[]> {
    const [unconfirmed, suppressions, stopped] = await Promise.all([
      this.directory.unverifiedMailboxes(),
      this.mail.suppressionsOfAccounts(),
      this.mail.stoppedPreferences(),
    ]);
    const owners = [...new Set(suppressions.map((s) => s.accountId!))];
    const mailboxes = await this.directory.mailboxes(owners);
    const flags = new Map<string, MemberMailFlag>();
    for (const s of suppressions) {
      const email = mailboxes.get(s.accountId!)?.email;
      if (email && mailAddressKey(email) === s.addressKey) flags.set(s.accountId!, { accountId: s.accountId!, state: s.reason, since: s.since });
    }
    for (const u of unconfirmed) {
      if (!flags.has(u.accountId)) flags.set(u.accountId, { accountId: u.accountId, state: u.email ? 'unverified' : 'no_address', since: null });
    }
    for (const p of stopped) {
      const { state, since } = mailAddressState({ primaryEmail: null, emailVerified: false }, null, p);
      if (state !== 'ok') flags.set(p.accountId, { accountId: p.accountId, state, since });
    }
    const ids = [...flags.keys()];
    const members = await this.members.findMany(ids);
    return ids.filter((_, i) => members[i]).map((id) => flags.get(id)!);
  }
}

/** The member's own email (design §10.12). */
@Controller('v1/me/email')
export class MyEmailController {
  constructor(private readonly email: MyEmailService) {}

  @Get()
  view(@Ctx() ctx: RequestContext) {
    return this.email.view(ctx);
  }

  /** A test email to the caller's own address, on the worker's next tick. */
  @Post('test')
  @HttpCode(202)
  test(@Ctx() ctx: RequestContext) {
    return this.email.request(ctx, 'test');
  }

  /** Try an address that bounced or was marked as spam again, then a test email to it. */
  @Post('retry')
  @HttpCode(202)
  retry(@Ctx() ctx: RequestContext) {
    return this.email.request(ctx, 'retry');
  }

  /** No more email from the party. */
  @Post('unsubscribe')
  @HttpCode(200)
  unsubscribe(@Ctx() ctx: RequestContext) {
    return this.email.setUnsubscribed(ctx, true);
  }

  /** Email from the party again, unless an admin has stopped it. */
  @Post('resubscribe')
  @HttpCode(200)
  resubscribe(@Ctx() ctx: RequestContext) {
    return this.email.setUnsubscribed(ctx, false);
  }
}
