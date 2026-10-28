import { Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { isNoticeKind } from 'ustp-domain';
import { Ctx, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { NoticesService } from './notices.service.js';

/**
 * An election's notices (design §6.8): counts for Election Admins and Auditors; resending, and test emails to
 * themselves, for Election Admins.
 */
@Controller('v1/admin/elections/:id/notices')
@Roles('election_admin')
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get()
  @Roles('election_admin', 'auditor')
  view(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.notices.view(ctx, id);
  }

  /** Send the notice again to the recipients it failed for, on the worker's next tick. */
  @Post(':kind/resend')
  @HttpCode(200)
  resend(@Ctx() ctx: RequestContext, @Param('id') id: string, @Param('kind') kind: string) {
    if (!isNoticeKind(kind)) throw new NotFoundException(`no notice kind ${kind}`);
    return this.notices.resend(ctx, id, kind);
  }

  /**
   * Send the email, marked as a test, to the caller alone, on the worker's next tick. Takes no address: it goes to the
   * caller's own account.
   */
  @Post(':kind/test')
  @HttpCode(202)
  test(@Ctx() ctx: RequestContext, @Param('id') id: string, @Param('kind') kind: string) {
    if (!isNoticeKind(kind)) throw new NotFoundException(`no notice kind ${kind}`);
    return this.notices.requestTest(ctx, id, kind);
  }
}
