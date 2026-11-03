import { Controller, Get, HttpCode, Injectable, Post } from '@nestjs/common';
import { checkMailHealthRequest, type MailCheckStatus, type MailHealthView } from 'ustp-domain';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { MailRepository } from './mail.repository.js';

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

/** System Admins see whether email is set up properly, and ask for a check now (design §10.12). */
@Controller('v1/admin/mail')
@Roles('system_admin')
export class MailAdminController {
  constructor(private readonly health: MailHealthService) {}

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
