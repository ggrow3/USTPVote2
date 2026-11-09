import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  inboxAssignSchema,
  inboxQuerySchema,
  inboxStatusSchema,
  memberReplySchema,
  startMemberConversationSchema,
  startTeamConversationSchema,
  teamReplySchema,
  type InboxAssignInput,
  type InboxQuery,
  type InboxStatusInput,
  type MemberReplyInput,
  type StartMemberConversationInput,
  type StartTeamConversationInput,
  type TeamReplyInput,
} from 'ustp-domain';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { parseQuery, ZodPipe } from '../common/validation.js';
import { MembershipInboxService } from './membership-inbox.service.js';

const id = z.string().trim().min(1).max(64);

/** The membership inbox, for the Membership Admins, who are the membership team (design §10.13). */
@Controller('v1/admin/inbox')
@Roles('membership_admin')
export class TeamInboxController {
  constructor(private readonly inbox: MembershipInboxService) {}

  @Get()
  page(@Ctx() ctx: RequestContext, @Query(new ZodPipe(inboxQuerySchema)) query: InboxQuery) {
    return this.inbox.page(requireAccount(ctx), query);
  }

  /** The Membership Admins, to give a conversation to. */
  @Get('team')
  team() {
    return this.inbox.team();
  }

  @Post()
  @HttpCode(201)
  start(@Ctx() ctx: RequestContext, @Body(new ZodPipe(startMemberConversationSchema)) body: StartMemberConversationInput) {
    return this.inbox.start(requireAccount(ctx), body);
  }

  @Get(':threadId')
  thread(@Ctx() ctx: RequestContext, @Param('threadId') threadId: string) {
    return this.inbox.thread(requireAccount(ctx), parseQuery(id, threadId, 'threadId'));
  }

  @Post(':threadId/messages')
  @HttpCode(201)
  reply(@Ctx() ctx: RequestContext, @Param('threadId') threadId: string, @Body(new ZodPipe(teamReplySchema)) body: TeamReplyInput) {
    return this.inbox.reply(requireAccount(ctx), parseQuery(id, threadId, 'threadId'), body);
  }

  @Post(':threadId/status')
  @HttpCode(200)
  status(@Ctx() ctx: RequestContext, @Param('threadId') threadId: string, @Body(new ZodPipe(inboxStatusSchema)) body: InboxStatusInput) {
    return this.inbox.setStatus(requireAccount(ctx), parseQuery(id, threadId, 'threadId'), body.status);
  }

  @Post(':threadId/assign')
  @HttpCode(200)
  assign(@Ctx() ctx: RequestContext, @Param('threadId') threadId: string, @Body(new ZodPipe(inboxAssignSchema)) body: InboxAssignInput) {
    return this.inbox.assign(requireAccount(ctx), parseQuery(id, threadId, 'threadId'), body.accountId);
  }
}

/**
 * A member's conversations with the membership team (design §10.13): any account with a member record, whatever its
 * status, starts one and answers in its own; nobody else's is there.
 */
@Controller('v1/membership-team')
export class MyTeamInboxController {
  constructor(private readonly inbox: MembershipInboxService) {}

  @Get()
  threads(@Ctx() ctx: RequestContext) {
    return this.inbox.myThreads(requireAccount(ctx));
  }

  @Post()
  @HttpCode(201)
  start(@Ctx() ctx: RequestContext, @Body(new ZodPipe(startTeamConversationSchema)) body: StartTeamConversationInput) {
    return this.inbox.write(requireAccount(ctx), body);
  }

  @Get(':threadId')
  thread(@Ctx() ctx: RequestContext, @Param('threadId') threadId: string) {
    return this.inbox.myThread(requireAccount(ctx), parseQuery(id, threadId, 'threadId'));
  }

  @Post(':threadId')
  @HttpCode(201)
  reply(@Ctx() ctx: RequestContext, @Param('threadId') threadId: string, @Body(new ZodPipe(memberReplySchema)) body: MemberReplyInput) {
    return this.inbox.write(requireAccount(ctx), { threadId: parseQuery(id, threadId, 'threadId'), body: body.body });
  }

  @Post(':threadId/read')
  @HttpCode(204)
  async markRead(@Ctx() ctx: RequestContext, @Param('threadId') threadId: string) {
    await this.inbox.markRead(requireAccount(ctx), parseQuery(id, threadId, 'threadId'));
  }
}
