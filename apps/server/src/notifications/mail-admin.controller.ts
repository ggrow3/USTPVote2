import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Query } from '@nestjs/common';
import {
  adminTestSchema,
  checkMailHealthRequest,
  mailLogQuerySchema,
  mailRestoreSchema,
  mailStopSchema,
  type AdminTestInput,
  type MailCheckStatus,
  type MailHealthView,
  type MailLogQuery,
  type MailRestoreInput,
  type MailStopInput,
  type MailStopRow,
  type MemberMailFlag,
} from 'ustp-domain';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck, ZodPipe } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { MailLogService } from './mail-log.js';
import { MailPreferences } from './mail-preferences.js';
import { MailRepository } from './mail.repository.js';
import { MyEmailService } from './my-email.js';

/**
 * The email setup check as the api shows it (design §10.12): the worker's last run for System Admins, and their request
 * for a run now, which the worker takes on its next tick (the api holds no AWS key).
 */
@Injectable()
export class MailHealthService {
  constructor(
    private readonly firebase: Firebase,
    private readonly mail: MailRepository,
  ) {}

  async view(): Promise<MailHealthView> {
    const [health, request] = await Promise.all([this.mail.health(), this.mail.healthRequest()]);
    return { health, requested: request?.status === 'pending' ? request : null };
  }

  /** How the last run went, in a word, for the election editor's email card. */
  async overall(): Promise<MailCheckStatus | null> {
    return (await this.mail.health())?.overall ?? null;
  }

  /** Asks the worker to run the check on its next tick: one request at a time, not within minutes of the last run. */
  async request(ctx: RequestContext): Promise<MailHealthView> {
    const actor = requireAccount(ctx);
    await this.firebase.db.runTransaction(async (tx) => {
      const [current, request] = await Promise.all([this.mail.health(tx), this.mail.healthRequest(tx)]);
      const now = new Date();
      assertCheck(checkMailHealthRequest(current, request, now));
      this.mail.setHealthRequest(tx, { requestedBy: actor, requestedAt: now.toISOString(), status: 'pending' });
    });
    return this.view();
  }
}

/**
 * System Admins see whether email is set up properly, ask for a check now, and read the log of every email sent; Membership Admins see which members
 * cannot be emailed; both see who gets no email, and stop or restore an admin's stop (design §10.12).
 */
@Controller('v1/admin/mail')
@Roles('system_admin')
export class MailAdminController {
  constructor(
    private readonly health: MailHealthService,
    private readonly email: MyEmailService,
    private readonly preferences: MailPreferences,
    private readonly log: MailLogService,
  ) {}

  /** The email log: every email the site sent, newest first, a page at a time (design §10.12). */
  @Get('log')
  logPage(@Query(new ZodPipe(mailLogQuerySchema)) query: MailLogQuery) {
    return this.log.page(query);
  }

  @Get('members')
  @Roles('membership_admin')
  members(): Promise<MemberMailFlag[]> {
    return this.email.flags();
  }

  @Get('stops')
  @Roles('membership_admin', 'system_admin')
  stops(): Promise<MailStopRow[]> {
    return this.preferences.stops();
  }

  @Post('stops')
  @HttpCode(204)
  @Roles('membership_admin', 'system_admin')
  stop(@Ctx() ctx: RequestContext, @Body(new ZodPipe(mailStopSchema)) body: MailStopInput) {
    return this.preferences.stop(ctx, body);
  }

  @Post('stops/:accountId/restore')
  @HttpCode(204)
  @Roles('membership_admin', 'system_admin')
  restore(@Ctx() ctx: RequestContext, @Param('accountId') accountId: string, @Body(new ZodPipe(mailRestoreSchema)) body: MailRestoreInput) {
    return this.preferences.restore(ctx, accountId, body);
  }

  /** Who a test email can go to, and how the caller's last one went. */
  @Get('test')
  testView(@Ctx() ctx: RequestContext) {
    return this.email.adminTestView(ctx);
  }

  /** A test email to a System Admin, the caller by default, on the worker's next tick, even while all email is off. */
  @Post('test')
  @HttpCode(202)
  test(@Ctx() ctx: RequestContext, @Body(new ZodPipe(adminTestSchema)) body: AdminTestInput) {
    return this.email.requestAdminTest(ctx, body?.to);
  }

  @Get('health')
  view() {
    return this.health.view();
  }

  @Post('health/check')
  @HttpCode(202)
  check(@Ctx() ctx: RequestContext) {
    return this.health.request(ctx);
  }
}
