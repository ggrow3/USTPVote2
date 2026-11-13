import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  billNoteSchema,
  isBillTopic,
  publicBillSchema,
  billRecentSchema,
  billSearchSchema,
  billSettingsSchema,
  billWatchQuerySchema,
  watchBillSchema,
  type BillNoteInput,
  type BillRecentInput,
  type BillSearchInput,
  type BillSettingsInput,
  type BillWatchQuery,
  type PublicBillInput,
  type WatchBillInput,
} from 'ustp-domain';
import { Ctx, Public, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { BillsService } from './bills.service.js';
import { PublicBills } from './public-bills.js';

/**
 * The legislative team's Bills tool (design §5.14), for the teams a System Admin names and System Admins: bills in
 * Congress found and sorted (GovInfo's search, Congress.gov's lists), one bill's details, actions, summaries and text,
 * and the watchlist the team shares with its tags and notes. Everyone else gets 403, except from `access`.
 */
@Controller('v1/bills')
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  /** Whether the caller has the tool (the menu's Bills link), and the current Congress. */
  @Get('access')
  access(@Ctx() ctx: RequestContext) {
    return this.bills.access(ctx);
  }

  @Get('search')
  search(@Ctx() ctx: RequestContext, @Query(new ZodPipe(billSearchSchema)) query: BillSearchInput) {
    return this.bills.search(ctx, query);
  }

  @Get('recent')
  recent(@Ctx() ctx: RequestContext, @Query(new ZodPipe(billRecentSchema)) query: BillRecentInput) {
    return this.bills.recent(ctx, query);
  }

  @Get('watchlist')
  watchlist(@Ctx() ctx: RequestContext, @Query(new ZodPipe(billWatchQuerySchema)) query: BillWatchQuery) {
    return this.bills.watchlist(ctx, query);
  }

  /** Adds a bill to the watchlist (`basedOn: null`) or changes its tags (`basedOn` its version). */
  @Put('watchlist/:billId')
  watch(@Ctx() ctx: RequestContext, @Param('billId') billId: string, @Body(new ZodPipe(watchBillSchema)) body: WatchBillInput) {
    return this.bills.watch(ctx, billId, body);
  }

  /** Takes a bill off the watchlist, with its notes. */
  @Delete('watchlist/:billId')
  unwatch(@Ctx() ctx: RequestContext, @Param('billId') billId: string) {
    return this.bills.unwatch(ctx, billId);
  }

  /** Shows a watched bill on the public Legislation page (`basedOn: null`) or changes what the public sees of it. */
  @Put('watchlist/:billId/public')
  savePublic(@Ctx() ctx: RequestContext, @Param('billId') billId: string, @Body(new ZodPipe(publicBillSchema)) body: PublicBillInput) {
    return this.bills.savePublic(ctx, billId, body);
  }

  /** Takes a bill off the public Legislation page. */
  @Delete('watchlist/:billId/public')
  withdrawPublic(@Ctx() ctx: RequestContext, @Param('billId') billId: string) {
    return this.bills.withdrawPublic(ctx, billId);
  }

  @Post('watchlist/:billId/notes')
  addNote(@Ctx() ctx: RequestContext, @Param('billId') billId: string, @Body(new ZodPipe(billNoteSchema)) body: BillNoteInput) {
    return this.bills.addNote(ctx, billId, body);
  }

  @Put('notes/:noteId')
  editNote(@Ctx() ctx: RequestContext, @Param('noteId') noteId: string, @Body(new ZodPipe(billNoteSchema)) body: BillNoteInput) {
    return this.bills.editNote(ctx, noteId, body);
  }

  @Delete('notes/:noteId')
  deleteNote(@Ctx() ctx: RequestContext, @Param('noteId') noteId: string) {
    return this.bills.deleteNote(ctx, noteId);
  }

  @Get(':congress/:type/:number')
  detail(@Ctx() ctx: RequestContext, @Param('congress') congress: string, @Param('type') type: string, @Param('number') number: string) {
    return this.bills.detail(ctx, congress, type, number);
  }

  @Get(':congress/:type/:number/text/:version')
  text(
    @Ctx() ctx: RequestContext,
    @Param('congress') congress: string,
    @Param('type') type: string,
    @Param('number') number: string,
    @Param('version') version: string,
  ) {
    return this.bills.text(ctx, congress, type, number, version);
  }
}

/** Admin › Bills (design §5.14): which teams have the tool, and which key it uses. */
@Controller('v1/admin/bills')
@Roles('system_admin', 'site_admin')
export class BillsAdminController {
  constructor(private readonly bills: BillsService) {}

  @Get()
  settings() {
    return this.bills.settings();
  }

  @Put()
  save(@Ctx() ctx: RequestContext, @Body(new ZodPipe(billSettingsSchema)) body: BillSettingsInput) {
    return this.bills.saveSettings(ctx, body);
  }
}

/**
 * The public Legislation page and scorecard (design §5.14, "Legislation and the scorecard"), for anyone: the bills the
 * legislative team shows, and how each member of Congress voted on them against the party's positions. Served from the
 * copy the worker keeps; nothing of the team's watchlist, tags, notes or names.
 */
@Controller('v1/public')
@Public()
export class PublicBillsController {
  constructor(private readonly bills: PublicBills) {}

  @Get('bills')
  list(@Query('topic') topic?: string) {
    if (topic !== undefined && topic !== '' && !isBillTopic(topic)) throw new BadRequestException('topic is science, ai or longevity');
    return this.bills.list(topic ? (topic as Parameters<PublicBills['list']>[0]) : null);
  }

  @Get('bills/:billId')
  bill(@Param('billId') billId: string) {
    return this.bills.bill(billId);
  }

  @Get('scorecard')
  scorecard() {
    return this.bills.scorecard();
  }

  @Get('scorecard/:memberId')
  member(@Param('memberId') memberId: string) {
    return this.bills.member(memberId);
  }
}
