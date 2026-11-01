import { BadRequestException, Body, Controller, Get, Header, Param, Post, Put, Query } from '@nestjs/common';
import {
  candidacyChangeSchema,
  candidacyDecisionSchema,
  candidacyInputSchema,
  candidacyRemovalSchema,
  DISTRICT_KINDS,
  STATE_FIPS,
  type CandidacyChangeInput,
  type CandidacyDecisionInput,
  type CandidacyInput,
  type CandidacyRemovalInput,
  type DistrictKind,
} from 'ustp-domain';
import { Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { CandidaciesService } from './candidacies.service.js';

/** Census lists and outlines change once a year: browsers keep them an hour, Hosting's CDN a day. */
const DISTRICT_CACHE = 'public, max-age=3600, s-maxage=86400';

function districtKind(value: string): DistrictKind {
  if (!(DISTRICT_KINDS as readonly string[]).includes(value)) throw new BadRequestException('invalid district kind');
  return value as DistrictKind;
}

/**
 * An Active member's own candidacies (design §5.8): declare one, change it and withdraw it. Every change waits for a
 * Membership Admin before the Candidates page shows it. Any member also reads their own area, which the page opens on.
 */
@Controller('v1/candidacies')
export class CandidaciesController {
  constructor(private readonly candidacies: CandidaciesService) {}

  @Get('mine')
  mine(@Ctx() ctx: RequestContext) {
    return this.candidacies.mine(requireAccount(ctx));
  }

  /** Where the caller lives, as districts, for the Candidates page's first filter; any membership status. */
  @Get('area')
  area(@Ctx() ctx: RequestContext) {
    return this.candidacies.area(requireAccount(ctx));
  }

  @Post()
  declare(@Ctx() ctx: RequestContext, @Body(new ZodPipe(candidacyInputSchema)) body: CandidacyInput) {
    return this.candidacies.declare(requireAccount(ctx), body);
  }

  @Put(':candidacyId')
  change(@Ctx() ctx: RequestContext, @Param('candidacyId') candidacyId: string, @Body(new ZodPipe(candidacyChangeSchema)) body: CandidacyChangeInput) {
    return this.candidacies.change(requireAccount(ctx), candidacyId, body.candidacy, body.basedOn);
  }

  @Post(':candidacyId/withdraw')
  withdraw(@Ctx() ctx: RequestContext, @Param('candidacyId') candidacyId: string) {
    return this.candidacies.withdraw(requireAccount(ctx), candidacyId);
  }
}

/** Reviewing candidacies (design §5.8): every one, approve or decline what waits, take one down. */
@Controller('v1/admin/candidacies')
@Roles('membership_admin')
export class CandidaciesAdminController {
  constructor(private readonly candidacies: CandidaciesService) {}

  @Get()
  list() {
    return this.candidacies.adminList();
  }

  @Post(':candidacyId/decision')
  decide(@Ctx() ctx: RequestContext, @Param('candidacyId') candidacyId: string, @Body(new ZodPipe(candidacyDecisionSchema)) body: CandidacyDecisionInput) {
    return this.candidacies.decide(requireAccount(ctx), candidacyId, body);
  }

  @Post(':candidacyId/remove')
  remove(@Ctx() ctx: RequestContext, @Param('candidacyId') candidacyId: string, @Body(new ZodPipe(candidacyRemovalSchema)) body: CandidacyRemovalInput) {
    return this.candidacies.remove(requireAccount(ctx), candidacyId, body.reason);
  }
}

/** The Candidates page, for everyone: approved candidacies of Active members. */
@Controller('v1/public/candidacies')
@Public()
export class PublicCandidaciesController {
  constructor(private readonly candidacies: CandidaciesService) {}

  @Get()
  list() {
    return this.candidacies.publicList();
  }

  @Get(':candidacyId')
  detail(@Param('candidacyId') candidacyId: string) {
    return this.candidacies.publicDetail(candidacyId);
  }
}

/** What the map needs, for everyone: the Census districts, their outlines, and the Google Maps browser key. */
@Controller('v1/public')
@Public()
export class PublicDistrictsController {
  constructor(private readonly candidacies: CandidaciesService) {}

  /** `?kind=congressional&state=CA`; no state for the nation. */
  @Get('districts')
  @Header('Cache-Control', DISTRICT_CACHE)
  districts(@Query('kind') kind: string, @Query('state') state?: string) {
    if (state !== undefined && STATE_FIPS[state] === undefined) throw new BadRequestException('invalid state');
    return this.candidacies.districtList(districtKind(kind), state ?? null);
  }

  @Get('districts/:kind/:geoid/boundary')
  @Header('Cache-Control', DISTRICT_CACHE)
  boundary(@Param('kind') kind: string, @Param('geoid') geoid: string) {
    return this.candidacies.boundary(districtKind(kind), geoid);
  }

  @Get('maps')
  maps() {
    return this.candidacies.maps();
  }
}
