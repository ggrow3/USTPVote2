import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { castBallotSchema, type CastBallotInput } from 'ustp-domain';
import { CheckRevoked, Ctx, NoActorLog } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { VotingService } from './voting.service.js';

/** The voter's side (design §7, §12): any signed-in member; each route checks the caller is on the election's roll. */
@Controller('v1/elections')
export class VotingController {
  constructor(private readonly voting: VotingService) {}

  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.voting.myElections(ctx);
  }

  @Get(':id/ballot')
  ballot(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.voting.ballot(ctx, id);
  }

  @Get(':id/participation/me')
  participation(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.voting.participation(ctx, id);
  }

  /** Request bodies are never logged, nor who cast (design §7.1); the token must not have been revoked. */
  @Post(':id/ballots')
  @CheckRevoked()
  @NoActorLog()
  cast(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(new ZodPipe(castBallotSchema)) body: CastBallotInput) {
    return this.voting.cast(ctx, id, body);
  }
}
