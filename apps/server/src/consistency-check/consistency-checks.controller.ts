import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Ctx, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ConsistencyChecksService } from './consistency-checks.service.js';

/**
 * The platform consistency check from the ballot (design §5.5): any signed-in member; asking checks the caller is on
 * the election's roll. Each person runs it once per election (409 after that).
 */
@Controller('v1/elections/:id/consistency-check')
export class ConsistencyChecksController {
  constructor(private readonly checks: ConsistencyChecksService) {}

  /** Whether the check is on, and the caller's own check of this election, if any. */
  @Get()
  state(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.checks.state(ctx, id);
  }

  /** Queues the caller's one check; the worker runs it. Poll `GET` until it is `done` or `failed`. */
  @Post()
  @HttpCode(202)
  request(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.checks.requestFromBallot(ctx, id);
  }
}

/** The same check from the election editor, for those who read election setup (design §5.5, §10.5). */
@Controller('v1/admin/elections/:id/consistency-check')
@Roles('election_admin', 'auditor')
export class AdminConsistencyChecksController {
  constructor(private readonly checks: ConsistencyChecksService) {}

  @Get()
  state(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.checks.state(ctx, id);
  }

  @Post()
  @HttpCode(202)
  request(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.checks.requestFromEditor(ctx, id);
  }
}
