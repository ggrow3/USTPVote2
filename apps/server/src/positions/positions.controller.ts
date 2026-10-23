import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { positionInputSchema, reasonInputSchema, ROLES, type PositionInput, type ReasonInput } from 'ustp-domain';
import { Ctx, Public, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { PositionsService } from './positions.service.js';

/** Offices and terms for administrators (design §6.4); ending a term goes to an Auditor. */
@Controller('v1/admin/positions')
@Roles('membership_admin', 'election_admin')
export class PositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Get()
  @Roles(...ROLES)
  all() {
    return this.positions.all();
  }

  /** Define a new office or change one; it takes effect at once. */
  @Post()
  define(@Ctx() ctx: RequestContext, @Body(new ZodPipe(positionInputSchema)) body: PositionInput) {
    return this.positions.define(ctx, body);
  }

  /** End a term now; an Auditor must approve. */
  @Post(':id/terms/:termId/end')
  endTerm(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('termId') termId: string,
    @Body(new ZodPipe(reasonInputSchema)) body: ReasonInput,
  ) {
    return this.positions.requestEndTerm(ctx, id, termId, body.reason);
  }
}

/** Who holds which office now: public, like the results the terms come from. */
@Controller('v1/public/positions')
@Public()
export class PublicPositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Get()
  current() {
    return this.positions.current();
  }
}
