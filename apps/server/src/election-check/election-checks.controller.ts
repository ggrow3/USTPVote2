import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Ctx, Public, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ElectionChecksService } from './election-checks.service.js';

/** The advisory election setup check in the election editor, for Election Admins and Auditors (design §6.9). */
@Controller('v1/admin/elections/:id/bylaws-checks')
@Roles('election_admin', 'auditor')
export class ElectionChecksController {
  constructor(private readonly checks: ElectionChecksService) {}

  /** Whether the check is on, and the election's latest check with what has changed since it ran. */
  @Get()
  state(@Param('id') id: string) {
    return this.checks.state(id);
  }

  /** Queues a check; the worker runs it. Poll `GET` (or `GET …/{checkId}`) until it is `done` or `failed`. */
  @Post()
  @HttpCode(202)
  request(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.checks.request(ctx, id);
  }

  @Get(':checkId')
  get(@Param('id') id: string, @Param('checkId') checkId: string) {
    return this.checks.get(id, checkId);
  }
}

/** The check of a scheduled election, which every user sees beside the contests (design §6.9, §12). */
@Controller('v1/public/elections')
@Public()
export class PublicElectionChecksController {
  constructor(private readonly checks: ElectionChecksService) {}

  @Get(':id/bylaws-check')
  published(@Param('id') id: string) {
    return this.checks.published(id);
  }
}
