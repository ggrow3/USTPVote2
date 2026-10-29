import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import {
  createTeamSchema,
  joinTeamSchema,
  leadTeamSettingsSchema,
  teamArchiveSchema,
  teamMemberInputSchema,
  teamRequestDecisionSchema,
  updateTeamSchema,
  type CreateTeamInput,
  type JoinTeamInput,
  type LeadTeamSettingsInput,
  type TeamArchiveInput,
  type TeamMemberInput,
  type TeamRequestDecisionInput,
  type UpdateTeamInput,
} from 'ustp-domain';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { TeamsService, type TeamCaller } from './teams.service.js';

const member = (ctx: RequestContext): TeamCaller => ({ accountId: requireAccount(ctx), admin: false });
const admin = (ctx: RequestContext): TeamCaller => ({ accountId: requireAccount(ctx), admin: true });

/**
 * Teams for Active members (design §5.7): see every team and who is on it, join or ask to join, leave. A team's leads
 * also decide requests, remove members, make co-leads, step down and change its settings (all but the name). Every
 * route answers with the team as the caller now sees it.
 */
@Controller('v1/teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.teams.list(member(ctx));
  }

  @Get(':teamId')
  detail(@Ctx() ctx: RequestContext, @Param('teamId') teamId: string) {
    return this.teams.detail(teamId, member(ctx));
  }

  /** Joins an open team at once, or asks the leads of one that decides. */
  @Post(':teamId/join')
  join(@Ctx() ctx: RequestContext, @Param('teamId') teamId: string, @Body(new ZodPipe(joinTeamSchema)) body: JoinTeamInput) {
    return this.teams.join(member(ctx), teamId, body);
  }

  /** Withdraws the caller's request to join. */
  @Delete(':teamId/request')
  withdraw(@Ctx() ctx: RequestContext, @Param('teamId') teamId: string) {
    return this.teams.withdraw(member(ctx), teamId);
  }

  @Post(':teamId/leave')
  leave(@Ctx() ctx: RequestContext, @Param('teamId') teamId: string) {
    return this.teams.leave(member(ctx), teamId);
  }

  /** A lead changes the team's settings, all but its name. */
  @Put(':teamId')
  update(@Ctx() ctx: RequestContext, @Param('teamId') teamId: string, @Body(new ZodPipe(leadTeamSettingsSchema)) body: LeadTeamSettingsInput) {
    const { basedOn, ...settings } = body;
    return this.teams.update(member(ctx), teamId, settings, basedOn);
  }

  @Post(':teamId/requests/:accountId/decision')
  decide(
    @Ctx() ctx: RequestContext,
    @Param('teamId') teamId: string,
    @Param('accountId') accountId: string,
    @Body(new ZodPipe(teamRequestDecisionSchema)) body: TeamRequestDecisionInput,
  ) {
    return this.teams.decide(member(ctx), teamId, accountId, body);
  }

  /** A lead makes a member a co-lead. */
  @Post(':teamId/members/:accountId/lead')
  makeLead(@Ctx() ctx: RequestContext, @Param('teamId') teamId: string, @Param('accountId') accountId: string) {
    return this.teams.changeMember(member(ctx), teamId, accountId, 'make_lead');
  }

  /** A lead stays on the team as a member, while another lead remains. */
  @Post(':teamId/step-down')
  stepDown(@Ctx() ctx: RequestContext, @Param('teamId') teamId: string) {
    const caller = member(ctx);
    return this.teams.changeMember(caller, teamId, caller.accountId, 'make_member');
  }

  /** A lead removes a member (not another lead). */
  @Delete(':teamId/members/:accountId')
  remove(@Ctx() ctx: RequestContext, @Param('teamId') teamId: string, @Param('accountId') accountId: string) {
    return this.teams.changeMember(member(ctx), teamId, accountId, 'remove');
  }
}

/**
 * Teams for Membership Admins (design §5.7): every team, archived ones too; create, rename, archive and restore them;
 * put Active members on a team as leads or members, take the lead from someone, remove anyone, and decide requests.
 */
@Controller('v1/admin/teams')
@Roles('membership_admin')
export class TeamsAdminController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.teams.list(admin(ctx));
  }

  @Get(':teamId')
  detail(@Ctx() ctx: RequestContext, @Param('teamId') teamId: string) {
    return this.teams.detail(teamId, admin(ctx));
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(createTeamSchema)) body: CreateTeamInput) {
    return this.teams.create(admin(ctx), body);
  }

  @Put(':teamId')
  update(@Ctx() ctx: RequestContext, @Param('teamId') teamId: string, @Body(new ZodPipe(updateTeamSchema)) body: UpdateTeamInput) {
    const { basedOn, ...settings } = body;
    return this.teams.update(admin(ctx), teamId, settings, basedOn);
  }

  @Post(':teamId/archive')
  archive(@Ctx() ctx: RequestContext, @Param('teamId') teamId: string, @Body(new ZodPipe(teamArchiveSchema)) body: TeamArchiveInput) {
    return this.teams.archive(admin(ctx), teamId, body.archived);
  }

  /** Puts an Active member on the team as a lead or a member, or changes the role of someone on it. */
  @Post(':teamId/members')
  addMember(@Ctx() ctx: RequestContext, @Param('teamId') teamId: string, @Body(new ZodPipe(teamMemberInputSchema)) body: TeamMemberInput) {
    return this.teams.addMember(admin(ctx), teamId, body);
  }

  @Delete(':teamId/members/:accountId')
  remove(@Ctx() ctx: RequestContext, @Param('teamId') teamId: string, @Param('accountId') accountId: string) {
    return this.teams.changeMember(admin(ctx), teamId, accountId, 'remove');
  }

  @Post(':teamId/requests/:accountId/decision')
  decide(
    @Ctx() ctx: RequestContext,
    @Param('teamId') teamId: string,
    @Param('accountId') accountId: string,
    @Body(new ZodPipe(teamRequestDecisionSchema)) body: TeamRequestDecisionInput,
  ) {
    return this.teams.decide(admin(ctx), teamId, accountId, body);
  }
}
