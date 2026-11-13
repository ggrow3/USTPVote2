import { Body, Controller, Delete, Get, Header, HttpCode, NotFoundException, Param, Post, Put, Req, Res, type PipeTransform } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createEventSchema,
  createPartnerSchema,
  eventVersionSchema,
  isUuidV7,
  partnerConsentSchema,
  partnerVersionSchema,
  SLUG,
  updateEventSchema,
  updatePartnerSchema,
  type CreateEventInput,
  type CreatePartnerInput,
  type EventVersionInput,
  type PartnerConsentInput,
  type PartnerVersionInput,
  type UpdateEventInput,
  type UpdatePartnerInput,
} from 'ustp-domain';
import { Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { requestOrigin } from '../common/request-origin.js';
import { ZodPipe } from '../common/validation.js';
import { EventsService } from './events.service.js';
import { PartnersService } from './partners.service.js';

/** An event's or partner's ID from the address, which is always a UUIDv7: anything else, a slash included, is no such thing. */
class IdPipe implements PipeTransform<string, string> {
  constructor(private readonly what: string) {}

  transform(value: string): string {
    if (!isUuidV7(value)) throw new NotFoundException(`no such ${this.what}`);
    return value;
  }
}

/** An event's address, as its slug: anything else is no event. It is then safe in a header too. */
class SlugPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!SLUG.test(value)) throw new NotFoundException('no such event');
    return value;
  }
}

const EVENT_ID = new IdPipe('event');
const PARTNER_ID = new IdPipe('partner');
const EVENT_SLUG = new SlugPipe();

/**
 * The Events page, each event and the calendars (design §10.17): anyone may read them. A calendar file is opened as a
 * link, not fetched, so it needs no credentials; `inline` lets iOS offer to add it to Calendar, and other browsers
 * download it, as they cannot show text/calendar.
 */
@Controller('v1/public/events')
@Public()
export class PublicEventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  page() {
    return this.events.page();
  }

  /** The calendar to subscribe to (webcal), refreshed by calendar apps every few hours. */
  @Get('calendar.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'inline; filename="ustp-events.ics"')
  @Header('Cache-Control', 'public, max-age=300')
  subscribed(@Req() req: FastifyRequest) {
    return this.events.subscribedCalendar(requestOrigin(req));
  }

  @Get(':slug')
  event(@Param('slug', EVENT_SLUG) slug: string) {
    return this.events.event(slug);
  }

  @Get(':slug/calendar.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  async calendar(@Param('slug', EVENT_SLUG) slug: string, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const ics = await this.events.calendar(slug, requestOrigin(req));
    void reply.header('Content-Disposition', `inline; filename="${slug}.ics"`);
    return ics;
  }
}

/** The Partners page (design §10.17): the groups listed with their consent, and the events each co-hosts. */
@Controller('v1/public/partners')
@Public()
export class PublicPartnersController {
  constructor(private readonly events: EventsService) {}

  @Get()
  page() {
    return this.events.partnersPage();
  }
}

/** Communications Admins' events and partners (design §10.17). */
@Controller('v1/admin/communications')
@Roles('communications_admin')
export class EventsAdminController {
  constructor(
    private readonly events: EventsService,
    private readonly partners: PartnersService,
  ) {}

  // --- Events ------------------------------------------------------------------------------------------------------

  @Get('events')
  allEvents() {
    return this.events.all();
  }

  @Get('events/:eventId')
  event(@Param('eventId', EVENT_ID) eventId: string) {
    return this.events.detail(eventId);
  }

  @Post('events')
  createEvent(@Ctx() ctx: RequestContext, @Body(new ZodPipe(createEventSchema)) body: CreateEventInput) {
    return this.events.create(requireAccount(ctx), body);
  }

  @Put('events/:eventId')
  updateEvent(@Ctx() ctx: RequestContext, @Param('eventId', EVENT_ID) eventId: string, @Body(new ZodPipe(updateEventSchema)) body: UpdateEventInput) {
    return this.events.update(requireAccount(ctx), eventId, body);
  }

  @Post('events/:eventId/publish')
  publishEvent(@Ctx() ctx: RequestContext, @Param('eventId', EVENT_ID) eventId: string, @Body(new ZodPipe(eventVersionSchema)) body: EventVersionInput) {
    return this.events.publish(requireAccount(ctx), eventId, body.basedOn);
  }

  @Post('events/:eventId/cancel')
  cancelEvent(@Ctx() ctx: RequestContext, @Param('eventId', EVENT_ID) eventId: string, @Body(new ZodPipe(eventVersionSchema)) body: EventVersionInput) {
    return this.events.cancel(requireAccount(ctx), eventId, body.basedOn);
  }

  @Delete('events/:eventId')
  @HttpCode(204)
  async deleteEvent(@Param('eventId', EVENT_ID) eventId: string): Promise<void> {
    await this.events.delete(eventId);
  }

  // --- Partners ----------------------------------------------------------------------------------------------------

  @Get('partners')
  allPartners() {
    return this.partners.all();
  }

  @Post('partners')
  addPartner(@Ctx() ctx: RequestContext, @Body(new ZodPipe(createPartnerSchema)) body: CreatePartnerInput) {
    return this.partners.add(requireAccount(ctx), body);
  }

  @Put('partners/:partnerId')
  updatePartner(@Ctx() ctx: RequestContext, @Param('partnerId', PARTNER_ID) partnerId: string, @Body(new ZodPipe(updatePartnerSchema)) body: UpdatePartnerInput) {
    return this.partners.update(requireAccount(ctx), partnerId, body);
  }

  @Post('partners/:partnerId/consent')
  consent(@Ctx() ctx: RequestContext, @Param('partnerId', PARTNER_ID) partnerId: string, @Body(new ZodPipe(partnerConsentSchema)) body: PartnerConsentInput) {
    return this.partners.recordConsent(requireAccount(ctx), partnerId, body);
  }

  @Post('partners/:partnerId/withdraw-consent')
  withdrawConsent(@Ctx() ctx: RequestContext, @Param('partnerId', PARTNER_ID) partnerId: string, @Body(new ZodPipe(partnerVersionSchema)) body: PartnerVersionInput) {
    return this.partners.withdrawConsent(requireAccount(ctx), partnerId, body.basedOn);
  }

  @Delete('partners/:partnerId')
  @HttpCode(204)
  async removePartner(@Ctx() ctx: RequestContext, @Param('partnerId', PARTNER_ID) partnerId: string): Promise<void> {
    await this.partners.remove(requireAccount(ctx), partnerId);
  }
}
