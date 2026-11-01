import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, HttpException, HttpStatus, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  areaContactChangeSchema,
  areaLookupSchema,
  clientAddress,
  areaContactInputSchema,
  candidacyChangeSchema,
  candidacyDecisionSchema,
  candidacyInputSchema,
  candidacyRemovalSchema,
  DISTRICT_KINDS,
  emailTemplateChangeSchema,
  emailTemplateInputSchema,
  STATE_FIPS,
  type AreaLookupInput,
  type AreaContactChangeInput,
  type AreaContactInput,
  type CandidacyChangeInput,
  type CandidacyDecisionInput,
  type CandidacyInput,
  type CandidacyRemovalInput,
  type DistrictKind,
  type EmailTemplateChangeInput,
  type EmailTemplateInput,
} from 'ustp-domain';
import { Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { VisitRateLimiter } from '../security/page-visits.js';
import { AreaContactsService } from './area-contacts.service.js';
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
  constructor(
    private readonly candidacies: CandidaciesService,
    private readonly contacts: AreaContactsService,
  ) {}

  @Get('mine')
  mine(@Ctx() ctx: RequestContext) {
    return this.candidacies.mine(requireAccount(ctx));
  }

  /** Where the caller lives, as districts, for the Candidates page's first filter; any membership status. */
  @Get('area')
  area(@Ctx() ctx: RequestContext) {
    return this.candidacies.area(requireAccount(ctx));
  }

  /** The Your area page: who holds and who runs for each office in the caller's area, and the emails (design §5.12). */
  @Get('area/contacts')
  areaContacts(@Ctx() ctx: RequestContext) {
    return this.contacts.view(requireAccount(ctx));
  }

  /** The Candidates page: who runs in the caller's area, from public records (design §5.12). */
  @Get('area/candidates')
  areaCandidates(@Ctx() ctx: RequestContext) {
    return this.contacts.myCandidates(requireAccount(ctx));
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

/** What the Your area page lists besides public records (design §5.12), for Communications Admins: the office holders and candidates they enter. */
@Controller('v1/admin')
@Roles('communications_admin')
export class AreaContactsAdminController {
  constructor(private readonly contacts: AreaContactsService) {}

  @Get('area-contacts')
  list() {
    return this.contacts.list();
  }

  @Post('area-contacts')
  add(@Ctx() ctx: RequestContext, @Body(new ZodPipe(areaContactInputSchema)) body: AreaContactInput) {
    return this.contacts.add(requireAccount(ctx), body);
  }

  @Put('area-contacts/:contactId')
  change(@Ctx() ctx: RequestContext, @Param('contactId') contactId: string, @Body(new ZodPipe(areaContactChangeSchema)) body: AreaContactChangeInput) {
    return this.contacts.change(requireAccount(ctx), contactId, body.contact, body.basedOn);
  }

  @Delete('area-contacts/:contactId')
  @HttpCode(204)
  async remove(@Ctx() ctx: RequestContext, @Param('contactId') contactId: string) {
    await this.contacts.remove(requireAccount(ctx), contactId);
  }
}

/** The Your area page's email templates (design §5.12), which Membership Admins and Communications Admins both keep. */
@Controller('v1/admin/email-templates')
@Roles('membership_admin', 'communications_admin')
export class EmailTemplatesAdminController {
  constructor(private readonly contacts: AreaContactsService) {}

  @Get()
  list() {
    return this.contacts.templates();
  }

  @Post()
  add(@Ctx() ctx: RequestContext, @Body(new ZodPipe(emailTemplateInputSchema)) body: EmailTemplateInput) {
    return this.contacts.addTemplate(requireAccount(ctx), body);
  }

  @Put(':templateId')
  change(@Ctx() ctx: RequestContext, @Param('templateId') templateId: string, @Body(new ZodPipe(emailTemplateChangeSchema)) body: EmailTemplateChangeInput) {
    return this.contacts.changeTemplate(requireAccount(ctx), templateId, body.template, body.basedOn);
  }

  @Delete(':templateId')
  @HttpCode(204)
  async remove(@Ctx() ctx: RequestContext, @Param('templateId') templateId: string) {
    await this.contacts.removeTemplate(requireAccount(ctx), templateId);
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

/** Lookups of a typed ZIP code each address may make a minute, on one api instance: each may ask several records. */
export const AREA_LOOKUP_RATE = { visits: 20, windowMs: 60_000 } as const;

/**
 * Who runs where a ZIP code is, for anyone on the Candidates page (design §5.12): public records only. Like the page
 * visits it needs no App Check token; the caller's address limits how often, and neither it nor the ZIP code is kept.
 */
@Controller('v1/public/candidates')
@Public()
export class PublicAreaCandidatesController {
  private readonly limiter = new VisitRateLimiter(AREA_LOOKUP_RATE);

  constructor(
    private readonly contacts: AreaContactsService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  @Post('area')
  @HttpCode(200)
  area(@Body(new ZodPipe(areaLookupSchema)) body: AreaLookupInput, @Req() request: FastifyRequest) {
    const { ip } = clientAddress(request.headers['x-forwarded-for'], request.socket?.remoteAddress, this.config.trustedProxyHops);
    if (!this.limiter.take(`address:${ip ?? 'unknown'}`)) throw new HttpException('too many lookups; try again in a minute', HttpStatus.TOO_MANY_REQUESTS);
    return this.contacts.zipCandidates(body.zip);
  }

  /** Forgets this instance's lookup counts (tests). */
  forget(): void {
    this.limiter.forget();
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
