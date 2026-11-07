import { Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { sha256Hex } from 'ustp-audit';
import { z } from 'zod';
import {
  broadcastAudienceSummary,
  broadcastPreviewSchema,
  broadcastSchema,
  broadcastSkip,
  inBroadcastAudience,
  mailAddressKey,
  mailStop,
  type BroadcastAudience,
  type BroadcastInput,
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
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async preview(audience: BroadcastAudience): Promise<BroadcastPreview> {
    return (await this.audience.resolve(audience)).preview;
  }

  searchMembers(name: string): Promise<MemberMatch[]> {
    return this.members.searchActive(name, MEMBER_SEARCH_LIMIT);
  }

  /** Why no email can be sent now, in the admin's words; null when one can. */
  private async blocked(): Promise<string | null> {
    if (this.config.mailTransport === 'off') return 'this deployment sends no email';
    const settings = await this.settings.current();
    if (!settings.allEmails) return 'all email is switched off, which a System Admin can change under Settings on this page';
    if (!(settings.contact ?? this.config.noticeContact)) return 'no contact for questions is set, which a System Admin can do under Settings on this page';
    if ((await this.broadcasts.unfinished()).length) return 'another email is still going out; wait for it, or stop it';
    return null;
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
    const ref = this.broadcasts.ref();
    const record: BroadcastRecord = {
      broadcastId: ref.id,
      subject: input.subject,
      body: input.body,
      audience: input.audience,
      status: 'preparing',
      createdBy: actor,
      createdAt: new Date().toISOString(),
      preview: null,
      completedAt: null,
    };
    await this.firebase.db.runTransaction(async (tx) => {
      if ((await this.broadcasts.unfinished(tx)).length) throw new ConflictException('another email is still going out; wait for it, or stop it');
      const payload: BroadcastRequestedPayload = {
        broadcastId: ref.id,
        subject: input.subject,
        bodyHash: sha256Hex(input.body),
        audience: broadcastAudienceSummary(input.audience),
        willGet: preview.willGet,
      };
      await this.ledger.record(tx, [{ type: 'notice.broadcast_requested', actor, subject: null, payload: { ...payload } }]);
      tx.create(ref, record);
    });
    return this.summary(record, new Map());
  }

  /** Stops one going out: what has gone has gone, and the rest stay unsent. Ledgered. */
  async cancel(ctx: RequestContext, broadcastId: string): Promise<BroadcastSummary> {
    const actor = requireAccount(ctx);
    const record = await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.broadcasts.find(broadcastId, tx);
      if (!current) throw new NotFoundException('no such email');
      if (current.status === 'done' || current.status === 'cancelled') throw new ConflictException('this email has finished already');
      const next: BroadcastRecord = { ...current, status: 'cancelled', completedAt: new Date().toISOString() };
      await this.ledger.record(tx, [{ type: 'notice.broadcast_cancelled', actor, subject: null, payload: { broadcastId } }]);
      tx.set(this.broadcasts.ref(broadcastId), next);
      return next;
    });
    return this.summary(record, new Map());
  }

  async view(): Promise<BroadcastsView> {
    const [blocked, settings, broadcasts] = await Promise.all([this.blocked(), this.settings.current(), this.list()]);
    return { blocked, contact: settings.contact ?? this.config.noticeContact, broadcasts };
  }

  private async list(): Promise<BroadcastSummary[]> {
    const records = await this.broadcasts.latest(BROADCASTS_SHOWN);
    const names = await this.directory.displayNames([...new Set(records.map((r) => r.createdBy))]);
    const mailboxes = await this.directory.mailboxes([...new Set(records.map((r) => r.createdBy).filter((id) => !names.has(id)))]);
    for (const [id, box] of mailboxes) if (box.email) names.set(id, box.email);
    return Promise.all(records.map((r) => this.summary(r, names)));
  }

  private async summary(record: BroadcastRecord, names: ReadonlyMap<string, string>): Promise<BroadcastSummary> {
    const { createdBy, audience, ...rest } = record;
    return { ...rest, audience: broadcastAudienceSummary(audience), createdByName: names.get(createdBy) ?? null, counts: await this.broadcasts.counts(record.broadcastId) };
  }
}

/** Emails to members, from Admin › Email (design §10.12). */
@Controller('v1/admin/mail/broadcasts')
@Roles('membership_admin', 'system_admin')
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get()
  view() {
    return this.broadcasts.view();
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
}
