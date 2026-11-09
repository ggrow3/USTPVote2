import { Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, Post } from '@nestjs/common';
import {
  checkMailRequest,
  foldName,
  mailAddressKey,
  mailAddressState,
  mayGetAdminTest,
  MY_EMAIL_DAYS,
  MY_EMAIL_SHOWN,
  TEST_RECIPIENT_SEARCH_LIMIT,
  TEST_RECIPIENT_STATUSES,
  type AdminTestView,
  type MailRequestKind,
  type MailRequestRecord,
  type MemberMailFlag,
  type MyEmailView,
  type MyMailState,
  type TestRecipient,
  placeText,
  type MemberRecord,
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

  /** Who a System Admin's test can go to without searching (the System Admins, the caller first), and how their last one went. */
  async adminTestView(ctx: RequestContext): Promise<AdminTestView> {
    const accountId = requireAccount(ctx);
    const [admins, requests] = await Promise.all([this.systemAdmins(), this.mail.requestsOf(accountId)]);
    const systemAdmins = [...admins].sort((a, b) => Number(b.accountId === accountId) - Number(a.accountId === accountId));
    const last = requests.find((r) => r.kind === 'admin_test');
    if (!last) return { systemAdmins, last: null };
    const to = last.to ?? last.accountId;
    const [message, toName] = await Promise.all([last.messageId ? this.mail.message(last.messageId) : null, this.nameOf(to, admins)]);
    return {
      systemAdmins,
      last: { toName, status: last.status, outcome: last.outcome, doneAt: last.doneAt, delivery: message?.status ?? null },
    };
  }

  /**
   * Who a test can go to whose name holds `text`, or whose email address it is (design §10.12): System Admins whose
   * name or address holds it first, then members, best matches first. Addresses are shown, since this is for System
   * Admins checking where the test goes.
   */
  async adminTestRecipients(text: string): Promise<TestRecipient[]> {
    const query = foldName(text.trim());
    const [admins, matches, owner] = await Promise.all([
      this.systemAdmins(),
      this.members.searchIn(TEST_RECIPIENT_STATUSES, text, TEST_RECIPIENT_SEARCH_LIMIT),
      text.includes('@') ? this.directory.accountWithEmail(text) : Promise.resolve(null),
    ]);
    const adminIds = new Set(admins.map((a) => a.accountId));
    const [ownerMember] = owner ? await this.members.findMany([owner]) : [null];
    const ids = [...new Set([...(owner ? [owner] : []), ...matches.map((m) => m.accountId)])];
    const [mailboxes, records] = await Promise.all([this.directory.mailboxes(ids), this.members.findMany(ids)]);
    const members = new Map(records.flatMap((r) => (r ? [[r.accountId, r] as const] : [])));
    const found = new Map<string, TestRecipient>();
    for (const a of admins) {
      if (a.accountId === owner || foldName(a.name).includes(query) || (a.email && foldName(a.email).includes(query))) found.set(a.accountId, a);
    }
    if (owner && !found.has(owner) && ownerMember && mayGetAdminTest({ systemAdmin: false, memberStatus: ownerMember.status })) {
      found.set(owner, this.recipient(owner, ownerMember, mailboxes.get(owner)?.email ?? null, false));
    }
    for (const m of matches) {
      if (found.has(m.accountId)) continue;
      const record = members.get(m.accountId);
      if (record) found.set(m.accountId, this.recipient(m.accountId, record, mailboxes.get(m.accountId)?.email ?? null, adminIds.has(m.accountId)));
    }
    return [...found.values()].slice(0, TEST_RECIPIENT_SEARCH_LIMIT);
  }

  /** Queues a System Admin's test for the worker, to them, another System Admin or a member, and nobody else (design §10.12). */
  async requestAdminTest(ctx: RequestContext, to: string | undefined): Promise<AdminTestView> {
    const recipient = to ?? requireAccount(ctx);
    const [admins, [member]] = await Promise.all([this.systemAdmins(), this.members.findMany([recipient])]);
    if (!mayGetAdminTest({ systemAdmin: admins.some((a) => a.accountId === recipient), memberStatus: member?.status ?? null })) {
      throw new ForbiddenException('a test email goes only to a System Admin or a member');
    }
    await this.request(ctx, 'admin_test', recipient);
    return this.adminTestView(ctx);
  }

  /** The System Admins, each as someone a test can go to. */
  private async systemAdmins(): Promise<TestRecipient[]> {
    const holders = await this.directory.roleHolders('system_admin');
    const ids = holders.map((h) => h.accountId);
    const [mailboxes, records] = await Promise.all([this.directory.mailboxes(ids), this.members.findMany(ids)]);
    return holders.map((h, i) => ({
      accountId: h.accountId,
      name: h.name,
      email: mailboxes.get(h.accountId)?.email ?? null,
      systemAdmin: true,
      memberStatus: records[i]?.status ?? null,
      place: (records[i] && placeText(records[i]!)) || null,
    }));
  }

  private recipient(accountId: string, member: MemberRecord, email: string | null, systemAdmin: boolean): TestRecipient {
    return { accountId, name: member.preferredName || member.legalName, email, systemAdmin, memberStatus: member.status, place: placeText(member) || null };
  }

  /** The name of the one a test went to: as a System Admin, else as a member. */
  private async nameOf(accountId: string, admins: readonly TestRecipient[]): Promise<string | null> {
    const admin = admins.find((a) => a.accountId === accountId);
    if (admin) return admin.name;
    const [member] = await this.members.findMany([accountId]);
    return member ? member.preferredName || member.legalName : null;
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
