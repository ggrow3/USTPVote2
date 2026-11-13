import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  clientAddress,
  createPollSchema,
  POLL_VOTER,
  POLL_VOTER_HEADER,
  pollVersionSchema,
  pollVoteSchema,
  updatePollSchema,
  type AdminPoll,
  type CreatePollInput,
  type PollVersionInput,
  type PollVoteInput,
  type PublicPoll,
  type UpdatePollInput,
} from 'ustp-domain';
import { AppChecked, Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { PollsService } from './polls.service.js';

/** The browser's token from its header, if it sent a well-formed one. */
const voterOf = (header: unknown): string | null => (typeof header === 'string' && POLL_VOTER.test(header) ? header : null);

/**
 * Issue polls for everyone (design §10.15): the list, a poll, and answering it signed out. The routes that read send
 * a poll's results only to a browser that answered it (by the token in `x-poll-voter`) or once it has closed.
 */
@Controller('v1/polls')
export class PublicPollsController {
  constructor(
    private readonly polls: PollsService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  @Public()
  @Get()
  list(@Headers(POLL_VOTER_HEADER) voter: unknown): Promise<PublicPoll[]> {
    return this.polls.list(voterOf(voter));
  }

  @Public()
  @Get(':pollId')
  poll(@Param('pollId') pollId: string, @Headers(POLL_VOTER_HEADER) voter: unknown): Promise<PublicPoll> {
    return this.polls.publicView(pollId, voterOf(voter));
  }

  /**
   * An answer from someone signed out. App Checked where App Check is enforced, as the suggestions form is, so a
   * script cannot answer from anywhere; one per browser; and a daily number per network address, counted under a
   * salted hash and never stored as it is.
   */
  @Public()
  @AppChecked()
  @Post(':pollId/votes')
  @HttpCode(200)
  vote(@Param('pollId') pollId: string, @Body(new ZodPipe(pollVoteSchema)) body: PollVoteInput, @Req() req: FastifyRequest): Promise<PublicPoll> {
    const { ip } = clientAddress(req.headers['x-forwarded-for'], req.socket?.remoteAddress, this.config.trustedProxyHops);
    return this.polls.vote(pollId, body, { address: ip ?? 'unknown' });
  }

  /** A poll as someone signed in sees it: answered by their account, or by this browser. */
  @Get(':pollId/mine')
  mine(@Ctx() ctx: RequestContext, @Param('pollId') pollId: string, @Headers(POLL_VOTER_HEADER) voter: unknown): Promise<PublicPoll> {
    return this.polls.publicView(pollId, voterOf(voter), ctx.accountId);
  }

  /** An answer from someone signed in: one per account; an Active member's is also counted among members. */
  @Post(':pollId/member-votes')
  @HttpCode(200)
  memberVote(@Ctx() ctx: RequestContext, @Param('pollId') pollId: string, @Body(new ZodPipe(pollVoteSchema)) body: PollVoteInput): Promise<PublicPoll> {
    return this.polls.vote(pollId, body, { accountId: requireAccount(ctx) });
  }
}

/** Communications Admins write, publish, close and delete issue polls (design §10.15), one alone. Nothing is ledgered. */
@Controller('v1/admin/communications/polls')
@Roles('communications_admin')
export class PollsAdminController {
  constructor(private readonly polls: PollsService) {}

  @Get()
  all(): Promise<AdminPoll[]> {
    return this.polls.all();
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(createPollSchema)) body: CreatePollInput): Promise<AdminPoll> {
    return this.polls.create(requireAccount(ctx), body);
  }

  @Put(':pollId')
  update(@Ctx() ctx: RequestContext, @Param('pollId') pollId: string, @Body(new ZodPipe(updatePollSchema)) body: UpdatePollInput): Promise<AdminPoll> {
    return this.polls.update(requireAccount(ctx), pollId, body);
  }

  @Post(':pollId/publish')
  @HttpCode(200)
  publish(@Ctx() ctx: RequestContext, @Param('pollId') pollId: string, @Body(new ZodPipe(pollVersionSchema)) body: PollVersionInput): Promise<AdminPoll> {
    return this.polls.publish(requireAccount(ctx), pollId, body.basedOn);
  }

  @Post(':pollId/close')
  @HttpCode(200)
  close(@Ctx() ctx: RequestContext, @Param('pollId') pollId: string, @Body(new ZodPipe(pollVersionSchema)) body: PollVersionInput): Promise<AdminPoll> {
    return this.polls.close(requireAccount(ctx), pollId, body.basedOn);
  }

  @Delete(':pollId')
  @HttpCode(204)
  async remove(@Param('pollId') pollId: string): Promise<void> {
    await this.polls.delete(pollId);
  }
}
