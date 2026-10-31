import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  roomActionSchema,
  roomActionUpdateSchema,
  roomAskSchema,
  roomAssistantSchema,
  roomConsentSchema,
  roomDecisionSchema,
  roomHistoryQuerySchema,
  roomMessageSchema,
  roomReactionSchema,
  roomSignalsSchema,
  roomUpdatesQuerySchema,
  roomVoiceJoinSchema,
  roomVoiceLeaveQuerySchema,
  roomVoiceUpdateSchema,
  voteSchema,
  type RoomActionInput,
  type RoomActionUpdate,
  type RoomAskInput,
  type RoomAssistantInput,
  type RoomConsentInput,
  type RoomDecisionInput,
  type RoomHistoryQuery,
  type RoomMessageInput,
  type RoomReactionInput,
  type RoomSignalsInput,
  type RoomUpdatesQuery,
  type RoomVoiceJoinInput,
  type RoomVoiceLeaveQuery,
  type RoomVoiceUpdateInput,
  type VoteValue,
} from 'ustp-domain';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { RoomService, type RoomCaller } from './room.service.js';

const member = (ctx: RequestContext): RoomCaller => ({ accountId: requireAccount(ctx), moderator: false });
const moderator = (ctx: RequestContext): RoomCaller => ({ accountId: requireAccount(ctx), moderator: true });

/**
 * The members' room (design §5.10). The door (`GET`, accepting the terms, leaving) is open to anyone signed in, who is
 * told whether they may enter; everything else is for Active members who accepted the current terms.
 */
@Controller('v1/room')
export class RoomController {
  constructor(private readonly room: RoomService) {}

  @Get()
  status(@Ctx() ctx: RequestContext) {
    return this.room.status(member(ctx));
  }

  @Post('consent')
  @HttpCode(200)
  accept(@Ctx() ctx: RequestContext, @Body(new ZodPipe(roomConsentSchema)) body: RoomConsentInput) {
    return this.room.accept(member(ctx), body);
  }

  /** `/leave-room`. */
  @Delete('consent')
  leave(@Ctx() ctx: RequestContext) {
    return this.room.leave(member(ctx));
  }

  @Get('messages')
  history(@Ctx() ctx: RequestContext, @Query(new ZodPipe(roomHistoryQuerySchema)) query: RoomHistoryQuery) {
    return this.room.history(member(ctx), query.before);
  }

  /** Long-polled: answers when something changes after `since`, or after 25 seconds. */
  @Get('updates')
  updates(@Ctx() ctx: RequestContext, @Query(new ZodPipe(roomUpdatesQuerySchema)) query: RoomUpdatesQuery) {
    return this.room.updates(member(ctx), query.since, query.wait === '1', query.voice);
  }

  @Post('messages')
  post(@Ctx() ctx: RequestContext, @Body(new ZodPipe(roomMessageSchema)) body: RoomMessageInput) {
    return this.room.post(member(ctx), body);
  }

  /** The caller's own message. */
  @Delete('messages/:messageId')
  deleteMessage(@Ctx() ctx: RequestContext, @Param('messageId') messageId: string) {
    return this.room.deleteMessage(member(ctx), messageId);
  }

  /** The caller's vote on a message: up, down, or 0 to take it back. */
  @Put('messages/:messageId/vote')
  vote(@Ctx() ctx: RequestContext, @Param('messageId') messageId: string, @Body(new ZodPipe(voteSchema)) body: { value: VoteValue }) {
    return this.room.vote(member(ctx), messageId, body.value);
  }

  /** The caller's emoji reaction on a message, added (`on`) or taken back. */
  @Put('messages/:messageId/reactions')
  react(@Ctx() ctx: RequestContext, @Param('messageId') messageId: string, @Body(new ZodPipe(roomReactionSchema)) body: RoomReactionInput) {
    return this.room.react(member(ctx), messageId, body);
  }

  /** `/ask`: the question is posted at once; the answer follows as the assistant's message. */
  @Post('ask')
  ask(@Ctx() ctx: RequestContext, @Body(new ZodPipe(roomAskSchema)) body: RoomAskInput) {
    return this.room.ask(member(ctx), body);
  }

  /** `/decide`. */
  @Post('decisions')
  decide(@Ctx() ctx: RequestContext, @Body(new ZodPipe(roomDecisionSchema)) body: RoomDecisionInput) {
    return this.room.decide(member(ctx), body);
  }

  /** `/todo`. */
  @Post('actions')
  addAction(@Ctx() ctx: RequestContext, @Body(new ZodPipe(roomActionSchema)) body: RoomActionInput) {
    return this.room.addAction(member(ctx), body);
  }

  /** An action item the caller owns or added. */
  @Put('actions/:itemId')
  updateAction(@Ctx() ctx: RequestContext, @Param('itemId') itemId: string, @Body(new ZodPipe(roomActionUpdateSchema)) body: RoomActionUpdate) {
    return this.room.updateAction(member(ctx), itemId, body);
  }

  /** `/memory`: all of it; the page searches it. */
  @Get('memory')
  memory(@Ctx() ctx: RequestContext) {
    return this.room.memory(member(ctx));
  }

  /** `/forget`: an item the caller added. */
  @Delete('memory/:itemId')
  @HttpCode(204)
  async forget(@Ctx() ctx: RequestContext, @Param('itemId') itemId: string) {
    await this.room.forget(member(ctx), itemId);
  }

  /** `/joke`: the assistant's lame joke, posted in the room. */
  @Post('joke')
  joke(@Ctx() ctx: RequestContext) {
    return this.room.joke(member(ctx));
  }

  /** Joining the call from this page; the page then calls everyone in it. */
  @Post('voice')
  joinVoice(@Ctx() ctx: RequestContext, @Body(new ZodPipe(roomVoiceJoinSchema)) body: RoomVoiceJoinInput) {
    return this.room.joinVoice(member(ctx), body);
  }

  /** Still in the call, muted or not. */
  @Put('voice')
  @HttpCode(204)
  async updateVoice(@Ctx() ctx: RequestContext, @Body(new ZodPipe(roomVoiceUpdateSchema)) body: RoomVoiceUpdateInput) {
    await this.room.updateVoice(member(ctx), body);
  }

  @Delete('voice')
  @HttpCode(204)
  async leaveVoice(@Ctx() ctx: RequestContext, @Query(new ZodPipe(roomVoiceLeaveQuerySchema)) query: RoomVoiceLeaveQuery) {
    await this.room.leaveVoice(member(ctx), query.sessionId);
  }

  /** Handshakes to others in the call. */
  @Post('voice/signals')
  @HttpCode(204)
  async signal(@Ctx() ctx: RequestContext, @Body(new ZodPipe(roomSignalsSchema)) body: RoomSignalsInput) {
    await this.room.signal(member(ctx), body);
  }
}

/**
 * The room's admins (design §5.10): Membership Admins in the room, with their second factor, delete any message or
 * memory item, change any action item, and switch the assistant off and on. They act from the room itself, so they too
 * must have accepted its terms: nobody reads the room from outside it.
 */
@Controller('v1/admin/room')
@Roles('membership_admin')
export class RoomAdminController {
  constructor(private readonly room: RoomService) {}

  @Delete('messages/:messageId')
  deleteMessage(@Ctx() ctx: RequestContext, @Param('messageId') messageId: string) {
    return this.room.deleteMessage(moderator(ctx), messageId);
  }

  @Put('actions/:itemId')
  updateAction(@Ctx() ctx: RequestContext, @Param('itemId') itemId: string, @Body(new ZodPipe(roomActionUpdateSchema)) body: RoomActionUpdate) {
    return this.room.updateAction(moderator(ctx), itemId, body);
  }

  @Delete('memory/:itemId')
  @HttpCode(204)
  async forget(@Ctx() ctx: RequestContext, @Param('itemId') itemId: string) {
    await this.room.forget(moderator(ctx), itemId);
  }

  /**
   * Admin › Members' room: the room open or closed and its model server on or off, and how the room is doing. These
   * act on the room from the console, so the admin need not be in it.
   */
  @Get('settings')
  @Roles('membership_admin', 'system_admin')
  settings(@Ctx() ctx: RequestContext) {
    return this.room.settings(moderator(ctx));
  }

  /** Opens or closes the room for everyone, ledgered. */
  @Put('settings/open')
  @Roles('membership_admin', 'system_admin')
  setOpen(@Ctx() ctx: RequestContext, @Body(new ZodPipe(roomAssistantSchema)) body: RoomAssistantInput) {
    return this.room.changeSetting(moderator(ctx), 'open', body.on);
  }

  /** Lets the model server run, starting it, or stops anything reaching it, so its GPU scales to zero. Ledgered. */
  @Put('settings/server')
  @Roles('system_admin')
  setServer(@Ctx() ctx: RequestContext, @Body(new ZodPipe(roomAssistantSchema)) body: RoomAssistantInput) {
    return this.room.changeSetting(moderator(ctx), 'server', body.on);
  }

  /** `/assistant on|off`: the kill switch, ledgered. */
  @Put('assistant')
  switchAssistant(@Ctx() ctx: RequestContext, @Body(new ZodPipe(roomAssistantSchema)) body: RoomAssistantInput) {
    return this.room.switchAssistant(moderator(ctx), body.on);
  }
}
