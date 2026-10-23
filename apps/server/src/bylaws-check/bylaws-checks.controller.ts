import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { requestBylawsCheckSchema, type RequestBylawsCheckInput } from 'ustp-domain';
import { Ctx, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { BylawsChecksService } from './bylaws-checks.service.js';

/** The advisory bylaws check, for Membership Admins drafting a version (design §5.2). */
@Controller('v1/admin/bylaws/checks')
@Roles('membership_admin')
export class BylawsChecksController {
  constructor(private readonly checks: BylawsChecksService) {}

  /** Queues a check; the worker runs it. Poll `GET …/{checkId}` until it is `done` or `failed`. */
  @Post()
  @HttpCode(202)
  request(@Ctx() ctx: RequestContext, @Body(new ZodPipe(requestBylawsCheckSchema)) body: RequestBylawsCheckInput) {
    return this.checks.request(ctx, body);
  }

  @Get(':checkId')
  get(@Param('checkId') checkId: string) {
    return this.checks.get(checkId);
  }
}
