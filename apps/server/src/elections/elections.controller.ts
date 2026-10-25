import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  candidateInputSchema,
  contestInputSchema,
  createElectionSchema,
  proposalInputSchema,
  reasonInputSchema,
  rollRequestSchema,
  updateElectionSchema,
  type CandidateInput,
  type ContestInput,
  type CreateElectionInput,
  type ProposalInput,
  type ReasonInput,
  type RollRequestInput,
  type UpdateElectionInput,
} from 'ustp-domain';
import { Ctx, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { ElectionsService } from './elections.service.js';

/** Election setup (design §6). Election Admins edit drafts; Auditors can read everything they will be asked to approve. */
@Controller('v1/admin/elections')
@Roles('election_admin')
export class ElectionsController {
  constructor(private readonly elections: ElectionsService) {}

  @Get()
  @Roles('election_admin', 'auditor')
  list() {
    return this.elections.list();
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(createElectionSchema)) body: CreateElectionInput) {
    return this.elections.create(ctx, body);
  }

  @Get(':id')
  @Roles('election_admin', 'auditor')
  detail(@Param('id') id: string) {
    return this.elections.detail(id);
  }

  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(new ZodPipe(updateElectionSchema)) body: UpdateElectionInput) {
    return this.elections.update(ctx, id, body);
  }

  @Get(':id/roll')
  @Roles('election_admin', 'auditor')
  roll(@Param('id') id: string) {
    return this.elections.roll(id);
  }

  /** Snapshot every Active member now; an Auditor must approve it. */
  @Post(':id/roll')
  requestRoll(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(new ZodPipe(rollRequestSchema)) body: RollRequestInput) {
    return this.elections.requestRoll(ctx, id, body.reason, body.voters);
  }

  /** Ask an Auditor to freeze the current definition and roll. */
  @Post(':id/schedule')
  requestSchedule(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(new ZodPipe(reasonInputSchema)) body: ReasonInput) {
    return this.elections.requestSchedule(ctx, id, body.reason);
  }

  /** Ask an Auditor to certify the provisional results of a closed election. */
  @Post(':id/certify')
  requestCertify(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(new ZodPipe(reasonInputSchema)) body: ReasonInput) {
    return this.elections.requestCertify(ctx, id, body.reason);
  }

  /** Drafts are cancelled at once; scheduled and open elections need an Auditor's approval. */
  @Post(':id/cancel')
  cancel(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(new ZodPipe(reasonInputSchema)) body: ReasonInput) {
    return this.elections.cancel(ctx, id, body.reason);
  }

  /** Permanently deletes a cancelled election nobody voted in; the ledger keeps its entries and records the deletion. */
  @Post(':id/delete')
  @HttpCode(204)
  async delete(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(new ZodPipe(reasonInputSchema)) body: ReasonInput) {
    await this.elections.delete(ctx, id, body.reason);
  }

  @Post(':id/contests')
  addContest(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(new ZodPipe(contestInputSchema)) body: ContestInput) {
    return this.elections.addContest(ctx, id, body);
  }

  @Put(':id/contests/:contestId')
  updateContest(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('contestId') contestId: string,
    @Body(new ZodPipe(contestInputSchema)) body: ContestInput,
  ) {
    return this.elections.updateContest(ctx, id, contestId, body);
  }

  @Delete(':id/contests/:contestId')
  @HttpCode(204)
  async removeContest(@Ctx() ctx: RequestContext, @Param('id') id: string, @Param('contestId') contestId: string) {
    await this.elections.removeContest(ctx, id, contestId);
  }

  @Post(':id/contests/:contestId/candidates')
  addCandidate(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('contestId') contestId: string,
    @Body(new ZodPipe(candidateInputSchema)) body: CandidateInput,
  ) {
    return this.elections.addCandidate(ctx, id, contestId, body);
  }

  @Delete(':id/contests/:contestId/candidates/:candidateId')
  @HttpCode(204)
  async removeCandidate(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('contestId') contestId: string,
    @Param('candidateId') candidateId: string,
  ) {
    await this.elections.removeCandidate(ctx, id, contestId, candidateId);
  }
}

/** Frozen proposal texts that proposal contests point at (design §6.4). */
@Controller('v1/admin/proposals')
@Roles('election_admin')
export class ProposalsController {
  constructor(private readonly elections: ElectionsService) {}

  @Get()
  @Roles('election_admin', 'auditor')
  list() {
    return this.elections.listProposals();
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(proposalInputSchema)) body: ProposalInput) {
    return this.elections.createProposal(ctx, body);
  }
}
