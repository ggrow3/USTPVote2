import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  closeReportSchema,
  notificationEmailSchema,
  reportMessageSchema,
  sendMessageSchema,
  type CloseReportInput,
  type NotificationEmailInput,
  type ReportMessageInput,
  type SendMessageInput,
} from 'ustp-domain';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { parseQuery, ZodPipe } from '../common/validation.js';
import { MyNotificationsService } from './inbox.service.js';
import { MessagesService } from './messages.service.js';

const id = z.string().trim().min(1).max(200);

/** The caller's own notifications (design §10.13): the bell's count and list, and how they have them by email. */
@Controller('v1/me')
export class MyNotificationsController {
  constructor(private readonly notifications: MyNotificationsService) {}

  @Get('notifications')
  list(@Ctx() ctx: RequestContext) {
    return this.notifications.view(requireAccount(ctx));
  }

  @Get('notifications/unread')
  unread(@Ctx() ctx: RequestContext) {
    return this.notifications.unread(requireAccount(ctx));
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  readAll(@Ctx() ctx: RequestContext) {
    return this.notifications.readAll(requireAccount(ctx));
  }

  @Post('notifications/:notificationId/read')
  @HttpCode(204)
  async read(@Ctx() ctx: RequestContext, @Param('notificationId') notificationId: string) {
    await this.notifications.read(requireAccount(ctx), parseQuery(id, notificationId, 'notificationId'));
  }

  @Get('notification-email')
  email(@Ctx() ctx: RequestContext) {
    return this.notifications.emailView(requireAccount(ctx));
  }

  @Put('notification-email')
  setEmail(@Ctx() ctx: RequestContext, @Body(new ZodPipe(notificationEmailSchema)) body: NotificationEmailInput) {
    return this.notifications.setEmail(requireAccount(ctx), body.notificationEmail);
  }
}

/** Messages between members (design §10.13). Sending needs both to be Active members; reading, only to be in it. */
@Controller('v1/messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  threads(@Ctx() ctx: RequestContext) {
    return this.messages.threads(requireAccount(ctx));
  }

  /** Active members by name, to write to. */
  @Get('people')
  people(@Ctx() ctx: RequestContext, @Query('name') name?: string) {
    return this.messages.people(requireAccount(ctx), parseQuery(z.string().trim().min(1).max(200), name, 'name'));
  }

  /** Someone to write to, by account: their name, and the conversation with them if there is one. */
  @Get('people/:accountId')
  person(@Ctx() ctx: RequestContext, @Param('accountId') accountId: string) {
    return this.messages.person(requireAccount(ctx), parseQuery(id, accountId, 'accountId'));
  }

  @Post()
  @HttpCode(201)
  send(@Ctx() ctx: RequestContext, @Body(new ZodPipe(sendMessageSchema)) body: SendMessageInput) {
    return this.messages.send(requireAccount(ctx), body.to, body.body);
  }

  @Post('blocks/:accountId')
  @HttpCode(204)
  async block(@Ctx() ctx: RequestContext, @Param('accountId') accountId: string) {
    await this.messages.block(requireAccount(ctx), parseQuery(id, accountId, 'accountId'));
  }

  @Delete('blocks/:accountId')
  @HttpCode(204)
  async unblock(@Ctx() ctx: RequestContext, @Param('accountId') accountId: string) {
    await this.messages.unblock(requireAccount(ctx), parseQuery(id, accountId, 'accountId'));
  }

  @Post('reports/:messageId')
  @HttpCode(201)
  report(@Ctx() ctx: RequestContext, @Param('messageId') messageId: string, @Body(new ZodPipe(reportMessageSchema)) body: ReportMessageInput) {
    return this.messages.report(requireAccount(ctx), parseQuery(id, messageId, 'messageId'), body.reason);
  }

  @Get(':threadId')
  thread(@Ctx() ctx: RequestContext, @Param('threadId') threadId: string, @Query('before') before?: string) {
    return this.messages.thread(requireAccount(ctx), parseQuery(id, threadId, 'threadId'), parseQuery(z.iso.datetime().optional(), before, 'before') ?? null);
  }

  @Post(':threadId/read')
  @HttpCode(204)
  async markRead(@Ctx() ctx: RequestContext, @Param('threadId') threadId: string) {
    await this.messages.markRead(requireAccount(ctx), parseQuery(id, threadId, 'threadId'));
  }
}

/** Reported messages, for Membership Admins (design §10.13). */
@Controller('v1/admin/message-reports')
@Roles('membership_admin')
export class MessageReportsController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list() {
    return this.messages.reports();
  }

  @Post(':reportId/close')
  @HttpCode(204)
  async close(@Ctx() ctx: RequestContext, @Param('reportId') reportId: string, @Body(new ZodPipe(closeReportSchema)) body: CloseReportInput) {
    await this.messages.closeReport(requireAccount(ctx), parseQuery(id, reportId, 'reportId'), body.note);
  }
}
