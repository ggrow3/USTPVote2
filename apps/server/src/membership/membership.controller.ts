import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import {
  addMemberSchema,
  createApplicationSchema,
  decisionSchema,
  MEMBER_STATUSES,
  memberCorrectionSchema,
  memberDetailsSchema,
  memberImportPreviewSchema,
  memberImportSchema,
  memberStatusSchema,
  publishBylawsSchema,
  resignSchema,
  type AddMemberInput,
  type CreateApplicationInput,
  type DecisionInput,
  type FirstStepsView,
  type MemberCorrectionInput,
  type MemberDetailsInput,
  type MemberImportInput,
  type MemberImportPreviewInput,
  type MemberStatusInput,
  type PublishBylawsInput,
  type ResignInput,
} from 'ustp-domain';
import { z } from 'zod';
import { Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { parseQuery, ZodPipe } from '../common/validation.js';
import { MembershipApplications } from './applications.service.js';
import { FirstStepsReader } from './first-steps.js';
import { MemberDirectory } from './member-directory.js';
import { MemberAdditions } from './member-additions.service.js';
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
    private readonly directory: MemberDirectory,
    private readonly steps: FirstStepsReader,
  ) {}

  /** A member's first steps and which they have done (design §5.16); nothing for someone who is not an Active member. */
  @Get('me/first-steps')
  async firstSteps(@Ctx() ctx: RequestContext): Promise<FirstStepsView> {
    const accountId = requireAccount(ctx);
    return this.steps.mine(accountId, await this.directory.find(accountId));
  }

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

  /** The signed-in member's own details and email opt-ins (design §5.2). */
  @Post('me/details')
  updateDetails(@Ctx() ctx: RequestContext, @Body(new ZodPipe(memberDetailsSchema)) body: MemberDetailsInput) {
    return this.members.updateOwnDetails(ctx, body);
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
    private readonly additions: MemberAdditions,
  ) {}

  @Post('bylaws')
  publishBylaws(@Ctx() ctx: RequestContext, @Body(new ZodPipe(publishBylawsSchema)) body: PublishBylawsInput) {
    return this.membership.publishBylaws(ctx, body);
  }

  /** How many applications wait, and since when the oldest: the count beside Admin in the menu (design §5.2). */
  @Get('applications/summary')
  applicationQueue() {
    return this.applications.queue();
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

  /** Adds one member, Active at once, who sets their own password when they first come (design §5.13). */
  @Post('members')
  addMember(@Ctx() ctx: RequestContext, @Body(new ZodPipe(addMemberSchema)) body: AddMemberInput) {
    return this.additions.addOne(ctx, body);
  }

  /** What importing a file's rows would do: each row added or skipped, with the reasons. Writes nothing. */
  @Post('member-imports/preview')
  @HttpCode(200)
  previewImport(@Body(new ZodPipe(memberImportPreviewSchema)) body: MemberImportPreviewInput) {
    return this.additions.preview(body.rows);
  }

  @Post('member-imports')
  importMembers(@Ctx() ctx: RequestContext, @Body(new ZodPipe(memberImportSchema)) body: MemberImportInput) {
    return this.additions.import(ctx, body.rows, body.reason);
  }

  /** Sends an added member's welcome email again, before they have signed in. */
  @Post('members/:accountId/welcome')
  @HttpCode(200)
  welcomeAgain(@Ctx() ctx: RequestContext, @Param('accountId') accountId: string) {
    return this.additions.welcomeAgain(ctx, accountId);
  }

  /** Records the welcome sign-in link this admin's browser just had Identity Platform send, for the email log. */
  @Post('members/:accountId/welcome-link')
  @HttpCode(204)
  async welcomeLinkSent(@Ctx() ctx: RequestContext, @Param('accountId') accountId: string): Promise<void> {
    await this.additions.welcomeLinkSent(ctx, accountId);
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

  /** One member's profile: record, applications with every answer, status history (design §5.2). */
  @Get('members/:accountId')
  member(@Param('accountId') accountId: string) {
    return this.members.detail(accountId);
  }

  @Post('members/:accountId/details')
  correctDetails(
    @Ctx() ctx: RequestContext,
    @Param('accountId') accountId: string,
    @Body(new ZodPipe(memberCorrectionSchema)) body: MemberCorrectionInput,
  ) {
    return this.members.correctDetails(ctx, accountId, body);
  }
}
