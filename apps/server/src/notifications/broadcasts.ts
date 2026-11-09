import { Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { sha256Hex } from 'ustp-audit';
import { z } from 'zod';
import {
  broadcastAudienceSummary,
  broadcastPreviewSchema,
  broadcastRejectSchema,
  broadcastSchema,
  broadcastSkip,
  inBroadcastAudience,
  mailAddressKey,
  mailStop,
  type BroadcastAudience,
  type BroadcastDecidedPayload,
  type BroadcastInput,
  type BroadcastRejectInput,
  type BroadcastPreview,
  type BroadcastRecord,
  type BroadcastRequestedPayload,
  type BroadcastSkip,
  type BroadcastSummary,
  type BroadcastsView,
  type MemberMatch,
} from 'ustp-domain';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import { DirectoryService } from '../auth/directory.service.js';
import type { RequestContext } from '../auth/principal.js';
import { parseQuery, ZodPipe } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { InboxNotices } from '../inbox/inbox.service.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { BroadcastRepository } from './broadcast.repository.js';
import { MailRepository } from './mail.repository.js';
import { NoticeSettingsService } from './notice-settings.js';

/** The latest emails shown. */
const BROADCASTS_SHOWN = 20;
const MEMBER_SEARCH_LIMIT = 20;

/**
 * Who an audience comes to now (design §10.12): the Active members it takes in, and among them those who opted in and can
 * be mailed. Read by the api for the count an admin sees, and again by the worker when it prepares the send.
 */
@Injectable()
export class BroadcastAudienceReader {
  constructor(
    private readonly members: MemberDirectory,
    private readonly directory: DirectoryService,
    private readonly mail: MailRepository,
  ) {}

  async resolve(audience: BroadcastAudience): Promise<{ readonly to: readonly string[]; readonly preview: BroadcastPreview }> {
    const found =
      audience.kind === 'picked' ? (await this.members.findMany([...new Set(audience.accountIds)])).flatMap((m) => (m ? [m] : [])) : await this.members.active();
    const members = found.filter((m) => inBroadcastAudience(audience, m));
    const [mailboxes, preferences, suppressions] = await Promise.all([
      this.directory.mailboxes(members.map((m) => m.accountId)),
      this.mail.stoppedPreferences(),
      this.mail.suppressionsOfAccounts(),
    ]);
    const stops = new Map(preferences.map((p) => [p.accountId, mailStop(p)]));
    const suppressed = new Set(suppressions.map((s) => s.addressKey));
    const skipped: Record<BroadcastSkip, number> = { email_stopped: 0, unsubscribed: 0, not_opted_in: 0, no_address: 0, unverified: 0, undeliverable: 0 };
    const to: string[] = [];
    for (const member of members) {
      const mailbox = mailboxes.get(member.accountId);
      const skip = broadcastSkip({
        member,
        mailbox,
        stop: stops.get(member.accountId) ?? null,
        suppressed: !!mailbox?.email && suppressed.has(mailAddressKey(mailbox.email)),
      });
      if (skip) skipped[skip]++;
      else to.push(member.accountId);
    }
    return { to, preview: { matched: members.length, willGet: to.length, skipped } };
  }
}

/** What Membership and System Admins do about emails to members (design §10.12); the worker sends them. */
@Injectable()
export class BroadcastsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly broadcasts: BroadcastRepository,
    private readonly audience: BroadcastAudienceReader,
    private readonly directory: DirectoryService,
    private readonly members: MemberDirectory,
    private readonly settings: NoticeSettingsService,
    private readonly notices: InboxNotices,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async preview(audience: BroadcastAudience): Promise<BroadcastPreview> {
    return (await this.audience.resolve(audience)).preview;
  }

  searchMembers(name: string): Promise<MemberMatch[]> {
    return this.members.searchActive(name, MEMBER_SEARCH_LIMIT);
  }

  /** Why no email can be sent now, in the admin's words; null when one can. `except` is the email being approved. */
  private async blocked(except?: string): Promise<string | null> {
    if (this.config.mailTransport === 'off') return 'this deployment sends no email';
    const settings = await this.settings.current();
    if (!settings.allEmails) return 'all email is switched off, which a System Admin can change under Settings on this page';
    if (!(settings.contact ?? this.config.noticeContact)) return 'no contact for questions is set, which a System Admin can do under Settings on this page';
    return openText((await this.broadcasts.open()).filter((b) => b.broadcastId !== except));
  }

  /**
   * Queues an email for the worker, ledgered. Only where it could go: this deployment sends mail, all email is on, a
   * contact for questions is set, it comes to somebody, and no other is still going out.
   */
  async create(ctx: RequestContext, input: BroadcastInput): Promise<BroadcastSummary> {
    const actor = requireAccount(ctx);
    const blocked = await this.blocked();
    if (blocked) throw new ConflictException(blocked);
    const { preview } = await this.audience.resolve(input.audience);
    if (!preview.willGet) throw new ConflictException('nobody in that choice can get this email');
    // With approval switched on (design §10.12), it waits for a System Admin, who may be the one who wrote it.
    const approvalRequired = (await this.settings.current()).broadcastApproval;
    const ref = this.broadcasts.ref();
    const record: BroadcastRecord = {
      broadcastId: ref.id,
      subject: input.subject,
      body: input.body,
      audience: input.audience,
      status: approvalRequired ? 'awaiting_approval' : 'preparing',
      createdBy: actor,
      createdAt: new Date().toISOString(),
      preview: null,
      completedAt: null,
      approval: approvalRequired ? { status: 'waiting', decidedBy: null, decidedAt: null, reason: null } : null,
    };
    await this.firebase.db.runTransaction(async (tx) => {
      const open = openText(await this.broadcasts.open(tx));
      if (open) throw new ConflictException(open);
      const payload: BroadcastRequestedPayload = {
        broadcastId: ref.id,
        subject: input.subject,
        bodyHash: sha256Hex(input.body),
        audience: broadcastAudienceSummary(input.audience),
        willGet: preview.willGet,
        approvalRequired,
      };
      await this.ledger.record(tx, [{ type: 'notice.broadcast_requested', actor, subject: null, payload: { ...payload } }]);
      tx.create(ref, record);
    });
    if (approvalRequired) {
      const [admins, names] = await Promise.all([this.directory.roleHolders('system_admin'), this.namesOf([actor])]);
      const who = names.get(actor) ?? 'An admin';
      await this.notices.notify(
        admins.map((a) => a.accountId).filter((id) => id !== actor),
        { kind: 'broadcast_approval', ref: ref.id, title: `${who} wants to email ${preview.willGet} ${preview.willGet === 1 ? 'member' : 'members'}: “${input.subject}”. It waits for a System Admin’s approval.`, link: '/admin?tab=email' },
      );
    }
    return this.summary(record, new Map(), ctx);
  }

  /**
   * A System Admin approves an email waiting for it, the one who wrote it included: it goes out as any other, once it
   * still could (email on, a contact, no other going out). Ledgered; whoever wrote it is told.
   */
  async approve(ctx: RequestContext, broadcastId: string): Promise<BroadcastSummary> {
    const actor = requireAccount(ctx);
    const blocked = await this.blocked(broadcastId);
    if (blocked) throw new ConflictException(blocked);
    const record = await this.decide(actor, broadcastId, (current, at) => ({
      ...current,
      status: 'preparing',
      approval: { status: 'approved', decidedBy: actor, decidedAt: at, reason: null },
    }));
    if (record.createdBy !== actor) {
      await this.notices.notify([record.createdBy], {
        kind: 'broadcast_decided',
        ref: broadcastId,
        title: `Your email “${record.subject}” was approved and is going out`,
        link: '/admin?tab=email',
      });
    }
    return this.summary(record, await this.namesOf([record.createdBy, actor]), ctx);
  }

  /** A System Admin rejects an email waiting for approval, saying why: nobody gets it. Ledgered; whoever wrote it is told. */
  async reject(ctx: RequestContext, broadcastId: string, reason: string): Promise<BroadcastSummary> {
    const actor = requireAccount(ctx);
    const record = await this.decide(
      actor,
      broadcastId,
      (current, at) => ({ ...current, status: 'rejected', completedAt: at, approval: { status: 'rejected', decidedBy: actor, decidedAt: at, reason } }),
      reason,
    );
    if (record.createdBy !== actor) {
      await this.notices.notify([record.createdBy], {
        kind: 'broadcast_decided',
        ref: broadcastId,
        title: `Your email “${record.subject}” was not approved: ${reason}`,
        link: '/admin?tab=email',
      });
    }
    return this.summary(record, await this.namesOf([record.createdBy, actor]), ctx);
  }

  private async decide(
    actor: string,
    broadcastId: string,
    next: (current: BroadcastRecord, at: string) => BroadcastRecord,
    reason?: string,
  ): Promise<BroadcastRecord> {
    const record = await this.firebase.db.runTransaction(async (tx) => {
      const [current, open] = await Promise.all([this.broadcasts.find(broadcastId, tx), this.broadcasts.open(tx)]);
      if (!current) throw new NotFoundException('no such email');
      if (current.status !== 'awaiting_approval') throw new ConflictException('this email is not waiting for approval');
      const others = openText(open.filter((b) => b.broadcastId !== broadcastId));
      if (!reason && others) throw new ConflictException(others);
      const decided = next(current, new Date().toISOString());
      const payload: BroadcastDecidedPayload = { broadcastId, subject: current.subject, ...(reason && { reason }) };
      await this.ledger.record(tx, [{ type: reason ? 'notice.broadcast_rejected' : 'notice.broadcast_approved', actor, subject: null, payload: { ...payload } }]);
      tx.set(this.broadcasts.ref(broadcastId), decided);
      return decided;
    });
    // Decided: the other System Admins' notifications about it have nothing left to ask.
    await this.notices.readAboutAll('broadcast_approval', broadcastId);
    return record;
  }

  /** Stops one going out: what has gone has gone, and the rest stay unsent. Ledgered. */
  async cancel(ctx: RequestContext, broadcastId: string): Promise<BroadcastSummary> {
    const actor = requireAccount(ctx);
    const record = await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.broadcasts.find(broadcastId, tx);
      if (!current) throw new NotFoundException('no such email');
      if (current.status === 'done' || current.status === 'cancelled' || current.status === 'rejected') throw new ConflictException('this email has finished already');
      const withdrawn = current.status === 'awaiting_approval';
      const next: BroadcastRecord = { ...current, status: 'cancelled', completedAt: new Date().toISOString() };
      await this.ledger.record(tx, [{ type: 'notice.broadcast_cancelled', actor, subject: null, payload: { broadcastId, ...(withdrawn && { beforeApproval: true }) } }]);
      tx.set(this.broadcasts.ref(broadcastId), next);
      return next;
    });
    await this.notices.readAboutAll('broadcast_approval', broadcastId);
    return this.summary(record, new Map(), ctx);
  }

  async view(ctx: RequestContext): Promise<BroadcastsView> {
    const [blocked, settings, broadcasts] = await Promise.all([this.blocked(), this.settings.current(), this.list(ctx)]);
    return {
      blocked,
      contact: settings.contact ?? this.config.noticeContact,
      approvalRequired: settings.broadcastApproval,
      canApprove: ctx.roles.includes('system_admin'),
      broadcasts,
    };
  }

  /** Display names, else addresses, of the admins named. */
  private async namesOf(accountIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(accountIds)];
    const names = await this.directory.displayNames(ids);
    const mailboxes = await this.directory.mailboxes(ids.filter((id) => !names.has(id)));
    for (const [id, box] of mailboxes) if (box.email) names.set(id, box.email);
    return names;
  }

  private async list(ctx: RequestContext): Promise<BroadcastSummary[]> {
    const records = await this.broadcasts.latest(BROADCASTS_SHOWN);
    const names = await this.namesOf(records.flatMap((r) => [r.createdBy, ...(r.approval?.decidedBy ? [r.approval.decidedBy] : [])]));
    return Promise.all(records.map((r) => this.summary(r, names, ctx)));
  }

  private async summary(record: BroadcastRecord, names: ReadonlyMap<string, string>, ctx: RequestContext): Promise<BroadcastSummary> {
    const { createdBy, audience, approval, ...rest } = record;
    const waiting = record.status === 'awaiting_approval';
    const [counts, willGetNow] = await Promise.all([
      this.broadcasts.counts(record.broadcastId),
      waiting ? this.audience.resolve(audience).then((r) => r.preview.willGet) : Promise.resolve(null),
    ]);
    return {
      ...rest,
      audience: broadcastAudienceSummary(audience),
      createdByName: names.get(createdBy) ?? null,
      counts,
      approval: approval
        ? { status: approval.status, decidedAt: approval.decidedAt, reason: approval.reason, decidedByName: approval.decidedBy ? (names.get(approval.decidedBy) ?? null) : null }
        : null,
      mine: createdBy === ctx.accountId,
      willGetNow,
    };
  }
}

/** Why another email keeps a new one from going: one waits for approval, or one is going out. Null when none does. */
function openText(open: readonly BroadcastRecord[]): string | null {
  if (open.some((b) => b.status === 'awaiting_approval')) return 'another email is waiting for a System Admin’s approval; wait for the decision, or withdraw it';
  if (open.length) return 'another email is still going out; wait for it, or stop it';
  return null;
}

/** Emails to members, from Admin › Email (design §10.12). */
@Controller('v1/admin/mail/broadcasts')
@Roles('membership_admin', 'system_admin')
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get()
  view(@Ctx() ctx: RequestContext) {
    return this.broadcasts.view(ctx);
  }

  /** Who a choice of members comes to, before anything is sent. */
  @Post('preview')
  @HttpCode(200)
  preview(@Body(new ZodPipe(broadcastPreviewSchema)) body: { audience: BroadcastAudience }) {
    return this.broadcasts.preview(body.audience);
  }

  /** Active members by name, for picking them by hand. */
  @Get('member-search')
  search(@Query('name') name?: string) {
    return this.broadcasts.searchMembers(parseQuery(z.string().trim().min(1).max(200), name, 'name'));
  }

  @Post()
  @HttpCode(202)
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(broadcastSchema)) body: BroadcastInput) {
    return this.broadcasts.create(ctx, body);
  }

  @Post(':broadcastId/cancel')
  @HttpCode(200)
  cancel(@Ctx() ctx: RequestContext, @Param('broadcastId') broadcastId: string) {
    return this.broadcasts.cancel(ctx, broadcastId);
  }

  /** With approval switched on, a System Admin lets one go (design §10.12). */
  @Post(':broadcastId/approve')
  @HttpCode(200)
  @Roles('system_admin')
  approve(@Ctx() ctx: RequestContext, @Param('broadcastId') broadcastId: string) {
    return this.broadcasts.approve(ctx, broadcastId);
  }

  @Post(':broadcastId/reject')
  @HttpCode(200)
  @Roles('system_admin')
  reject(@Ctx() ctx: RequestContext, @Param('broadcastId') broadcastId: string, @Body(new ZodPipe(broadcastRejectSchema)) body: BroadcastRejectInput) {
    return this.broadcasts.reject(ctx, broadcastId, body.reason);
  }
}
