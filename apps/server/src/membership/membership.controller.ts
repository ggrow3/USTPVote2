import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import {
  createApplicationSchema,
  decisionSchema,
  MEMBER_STATUSES,
  memberStatusSchema,
  publishBylawsSchema,
  resignSchema,
  type CreateApplicationInput,
  type DecisionInput,
  type MemberStatusInput,
  type PublishBylawsInput,
  type ResignInput,
} from 'ustp-domain';
import { z } from 'zod';
import { Ctx, Public, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { parseQuery, ZodPipe } from '../common/validation.js';
import { MembershipApplications } from './applications.service.js';
import { Members } from './members.service.js';
import { MembershipService } from './membership.service.js';

const limitParam = z.coerce.number().int().min(1).max(500).default(100);

/** Member-facing registration (design §5, §12). */
@Controller('v1')
export class RegistrationController {
  constructor(
    private readonly membership: MembershipService,
    private readonly applications: MembershipApplications,
    private readonly members: Members,
  ) {}

  @Public()
  @Get('bylaws/current')
  async currentBylaws() {
    const bylaws = await this.membership.currentBylaws();
    if (!bylaws) throw new NotFoundException('no bylaws have been published yet');
    return bylaws;
  }

  /** Every published version, newest first, without the text (design §5.2). */
  @Public()
  @Get('bylaws')
  bylawsVersions() {
    return this.membership.bylawsVersions();
  }

  @Public()
  @Get('bylaws/:version')
  async bylawsVersion(@Param('version') version: string) {
    const bylaws = /^[A-Za-z0-9._-]{1,64}$/.test(version) ? await this.membership.bylawsVersion(version) : null;
    if (!bylaws) throw new NotFoundException(`no bylaws version ${version}`);
    return bylaws;
  }

  @Post('registration/applications')
  apply(@Ctx() ctx: RequestContext, @Body(new ZodPipe(createApplicationSchema)) body: CreateApplicationInput) {
    return this.applications.submit(ctx, body);
  }

  @Get('registration/applications/me')
  myApplications(@Ctx() ctx: RequestContext) {
    return this.applications.mine(ctx);
  }

  @Post('me/resign')
  resign(@Ctx() ctx: RequestContext, @Body(new ZodPipe(resignSchema)) body: ResignInput) {
    return this.members.resign(ctx, body.reason);
  }
}

/** Membership Admin triage (design §5, §10.1). */
@Controller('v1/admin')
@Roles('membership_admin')
export class MembershipAdminController {
  constructor(
    private readonly membership: MembershipService,
    private readonly applications: MembershipApplications,
    private readonly members: Members,
  ) {}

  @Post('bylaws')
  publishBylaws(@Ctx() ctx: RequestContext, @Body(new ZodPipe(publishBylawsSchema)) body: PublishBylawsInput) {
    return this.membership.publishBylaws(ctx, body);
  }

  @Get('applications')
  listApplications(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.applications.list(
      parseQuery(z.enum(['pending', 'approved', 'rejected']).default('pending'), status, 'status'),
      parseQuery(limitParam, limit, 'limit'),
    );
  }

  @Post('applications/:id/decision')
  decide(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(new ZodPipe(decisionSchema)) body: DecisionInput) {
    return this.applications.decide(ctx, id, body);
  }

  @Get('members')
  listMembers(@Query('status') status?: string, @Query('after') after?: string, @Query('limit') limit?: string) {
    return this.members.list(
      parseQuery(z.enum(MEMBER_STATUSES).optional(), status, 'status'),
      parseQuery(z.string().min(1).optional(), after, 'after'),
      parseQuery(limitParam, limit, 'limit'),
    );
  }

  @Post('members/:accountId/status')
  setStatus(
    @Ctx() ctx: RequestContext,
    @Param('accountId') accountId: string,
    @Body(new ZodPipe(memberStatusSchema)) body: MemberStatusInput,
  ) {
    return this.members.setStatus(ctx, accountId, body);
  }

  @Get('members/:accountId/history')
  history(@Param('accountId') accountId: string) {
    return this.members.history(accountId);
  }
}
