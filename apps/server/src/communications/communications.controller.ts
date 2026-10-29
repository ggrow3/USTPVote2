import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  botVersionSchema,
  calendarStatusSchema,
  createBotSchema,
  createCalendarItemSchema,
  createNewsSchema,
  createSharePostSchema,
  newsVersionSchema,
  pressKitSchema,
  shareClickSchema,
  sharePostVersionSchema,
  suggestionSchema,
  suggestionTriageSchema,
  updateBotSchema,
  updateCalendarItemSchema,
  updateNewsSchema,
  updateSharePostSchema,
  type BotVersionInput,
  type CalendarStatusInput,
  type CreateBotInput,
  type CreateCalendarItemInput,
  type CreateNewsInput,
  type CreateSharePostInput,
  type NewsVersionInput,
  type PressAssetRecord,
  type PressKitInput,
  type ShareClickInput,
  type SharePostVersionInput,
  type SuggestionInput,
  type SuggestionTriageInput,
  type UpdateBotInput,
  type UpdateCalendarItemInput,
  type UpdateNewsInput,
  type UpdateSharePostInput,
} from 'ustp-domain';
import { AppChecked, Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { requestOrigin } from '../common/request-origin.js';
import { ZodPipe } from '../common/validation.js';
import { BotsService } from './bots.service.js';
import { CalendarService } from './calendar.service.js';
import { NewsService } from './news.service.js';
import { PressKitService } from './press-kit.service.js';
import { ShareKitService } from './share-kit.service.js';
import { SuggestionsService } from './suggestions.service.js';

/** Sends a press kit file: an image shown where it is opened, a PDF always downloaded and never run as a page. */
function sendFile(reply: FastifyReply, record: PressAssetRecord, data: Buffer, cache: string): Buffer {
  const disposition = record.contentType === 'application/pdf' ? 'attachment' : 'inline';
  void reply
    .header('Content-Type', record.contentType)
    .header('Content-Disposition', `${disposition}; filename="${record.fileName}"`)
    .header('Content-Security-Policy', "sandbox; default-src 'none'")
    .header('Cache-Control', cache);
  return data;
}

/** The News page and its feeds (design §10.7): anyone may read them. */
@Controller('v1/news')
@Public()
export class PublicNewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  list() {
    return this.news.list();
  }

  /** RSS 2.0, for feed readers and the party's bots. */
  @Get('feed.xml')
  @Header('Content-Type', 'application/rss+xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  rss(@Req() req: FastifyRequest) {
    return this.news.rss(requestOrigin(req));
  }

  /** JSON Feed 1.1. */
  @Get('feed.json')
  @Header('Content-Type', 'application/feed+json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  json(@Req() req: FastifyRequest) {
    return this.news.json(requestOrigin(req));
  }

  @Get(':slug')
  post(@Param('slug') slug: string) {
    return this.news.post(slug);
  }
}

/** The Press page (design §10.7): the press kit, its files and the party's public bots. */
@Controller('v1/press')
@Public()
export class PublicPressController {
  constructor(private readonly press: PressKitService) {}

  @Get()
  page() {
    return this.press.page();
  }

  /** A file's ID is the hash of its bytes, so it never changes and browsers may keep it. */
  @Get('assets/:id')
  async asset(@Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const { record, data } = await this.press.download(id);
    return sendFile(reply, record, data, 'public, max-age=31536000, immutable');
  }
}

/** The suggestions form (design §10.7): anyone may send one, signed in or not. */
@Controller('v1/suggestions')
export class PublicSuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Public()
  @AppChecked()
  @Post()
  @HttpCode(202)
  async submit(@Body(new ZodPipe(suggestionSchema)) body: SuggestionInput, @Req() req: FastifyRequest): Promise<{ received: true }> {
    await this.suggestions.submit(body, req.ip);
    return { received: true };
  }
}

/** The share kit for Active members, and counting share buttons (design §10.7). */
@Controller('v1/share')
export class ShareController {
  constructor(private readonly share: ShareKitService) {}

  @Get()
  kit(@Ctx() ctx: RequestContext) {
    return this.share.forMember(requireAccount(ctx));
  }

  /** A share button was pressed, on a news post or in the kit; counts only. */
  @Public()
  @Post('clicks')
  @HttpCode(204)
  async click(@Body(new ZodPipe(shareClickSchema)) body: ShareClickInput): Promise<void> {
    await this.share.click(body);
  }
}

/**
 * Communications Admins (design §10.7): news and press releases, the share kit, the social media calendar,
 * suggestions, the press kit and the bot registry.
 */
@Controller('v1/admin/communications')
@Roles('communications_admin')
export class CommunicationsAdminController {
  constructor(
    private readonly news: NewsService,
    private readonly share: ShareKitService,
    private readonly calendar: CalendarService,
    private readonly suggestions: SuggestionsService,
    private readonly press: PressKitService,
    private readonly bots: BotsService,
  ) {}

  // --- News --------------------------------------------------------------------------------------------------------

  @Get('news')
  allNews() {
    return this.news.all();
  }

  @Get('news/:postId')
  newsPost(@Param('postId') postId: string) {
    return this.news.detail(postId);
  }

  @Post('news')
  createNews(@Ctx() ctx: RequestContext, @Body(new ZodPipe(createNewsSchema)) body: CreateNewsInput) {
    return this.news.create(requireAccount(ctx), body);
  }

  @Put('news/:postId')
  updateNews(@Ctx() ctx: RequestContext, @Param('postId') postId: string, @Body(new ZodPipe(updateNewsSchema)) body: UpdateNewsInput) {
    return this.news.update(requireAccount(ctx), postId, body);
  }

  @Post('news/:postId/publish')
  publishNews(@Ctx() ctx: RequestContext, @Param('postId') postId: string, @Body(new ZodPipe(newsVersionSchema)) body: NewsVersionInput) {
    return this.news.publish(requireAccount(ctx), postId, body.basedOn);
  }

  @Post('news/:postId/withdraw')
  withdrawNews(@Ctx() ctx: RequestContext, @Param('postId') postId: string, @Body(new ZodPipe(newsVersionSchema)) body: NewsVersionInput) {
    return this.news.withdraw(requireAccount(ctx), postId, body.basedOn);
  }

  @Delete('news/:postId')
  @HttpCode(204)
  async deleteNews(@Param('postId') postId: string): Promise<void> {
    await this.news.delete(postId);
  }

  // --- Share kit ---------------------------------------------------------------------------------------------------

  @Get('share')
  allShare() {
    return this.share.all();
  }

  /** How often each share button was pressed, on news posts and in the kit. */
  @Get('share-counts')
  shareCounts() {
    return this.share.counts();
  }

  @Post('share')
  createShare(@Ctx() ctx: RequestContext, @Body(new ZodPipe(createSharePostSchema)) body: CreateSharePostInput) {
    return this.share.create(requireAccount(ctx), body);
  }

  @Put('share/:shareId')
  updateShare(@Ctx() ctx: RequestContext, @Param('shareId') shareId: string, @Body(new ZodPipe(updateSharePostSchema)) body: UpdateSharePostInput) {
    return this.share.update(requireAccount(ctx), shareId, body);
  }

  @Post('share/:shareId/publish')
  publishShare(@Ctx() ctx: RequestContext, @Param('shareId') shareId: string, @Body(new ZodPipe(sharePostVersionSchema)) body: SharePostVersionInput) {
    return this.share.publish(requireAccount(ctx), shareId, body.basedOn);
  }

  @Post('share/:shareId/archive')
  archiveShare(@Ctx() ctx: RequestContext, @Param('shareId') shareId: string, @Body(new ZodPipe(sharePostVersionSchema)) body: SharePostVersionInput) {
    return this.share.archive(requireAccount(ctx), shareId, body.basedOn);
  }

  @Delete('share/:shareId')
  @HttpCode(204)
  async deleteShare(@Param('shareId') shareId: string): Promise<void> {
    await this.share.delete(shareId);
  }

  // --- Calendar ----------------------------------------------------------------------------------------------------

  @Get('calendar')
  allCalendar() {
    return this.calendar.list();
  }

  /** The Communications Admins an item can be given to. */
  @Get('team')
  team() {
    return this.calendar.team();
  }

  @Post('calendar')
  createCalendar(@Ctx() ctx: RequestContext, @Body(new ZodPipe(createCalendarItemSchema)) body: CreateCalendarItemInput) {
    return this.calendar.create(requireAccount(ctx), body);
  }

  @Put('calendar/:itemId')
  updateCalendar(@Ctx() ctx: RequestContext, @Param('itemId') itemId: string, @Body(new ZodPipe(updateCalendarItemSchema)) body: UpdateCalendarItemInput) {
    return this.calendar.update(requireAccount(ctx), itemId, body);
  }

  @Post('calendar/:itemId/status')
  calendarStatus(@Ctx() ctx: RequestContext, @Param('itemId') itemId: string, @Body(new ZodPipe(calendarStatusSchema)) body: CalendarStatusInput) {
    return this.calendar.setStatus(requireAccount(ctx), itemId, body);
  }

  @Delete('calendar/:itemId')
  @HttpCode(204)
  async deleteCalendar(@Param('itemId') itemId: string): Promise<void> {
    await this.calendar.delete(itemId);
  }

  // --- Suggestions -------------------------------------------------------------------------------------------------

  @Get('suggestions')
  allSuggestions() {
    return this.suggestions.list();
  }

  @Put('suggestions/:suggestionId')
  triage(
    @Ctx() ctx: RequestContext,
    @Param('suggestionId') suggestionId: string,
    @Body(new ZodPipe(suggestionTriageSchema)) body: SuggestionTriageInput,
  ) {
    return this.suggestions.triage(requireAccount(ctx), suggestionId, body);
  }

  @Delete('suggestions/:suggestionId')
  @HttpCode(204)
  async deleteSuggestion(@Param('suggestionId') suggestionId: string): Promise<void> {
    await this.suggestions.delete(suggestionId);
  }

  // --- Press kit ---------------------------------------------------------------------------------------------------

  @Get('press-kit')
  pressKit() {
    return this.press.current();
  }

  @Put('press-kit')
  savePressKit(@Ctx() ctx: RequestContext, @Body(new ZodPipe(pressKitSchema)) body: PressKitInput) {
    return this.press.save(requireAccount(ctx), body);
  }

  /** The raw file as the body (image/png, image/jpeg, image/webp or application/pdf), and its name in `?name=`. */
  @Put('press-kit/assets')
  uploadAsset(@Ctx() ctx: RequestContext, @Req() req: FastifyRequest, @Body() body: unknown, @Query('name') name: unknown) {
    const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim();
    return this.press.upload(requireAccount(ctx), body, type, typeof name === 'string' ? name.slice(0, 200) : '');
  }

  /** An uploaded file, listed in the kit or not yet. */
  @Get('press-kit/assets/:id')
  async previewAsset(@Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const { record, data } = await this.press.preview(id);
    return sendFile(reply, record, data, 'private, no-store');
  }

  // --- Bots --------------------------------------------------------------------------------------------------------

  @Get('bots')
  allBots() {
    return this.bots.all();
  }

  @Post('bots')
  addBot(@Ctx() ctx: RequestContext, @Body(new ZodPipe(createBotSchema)) body: CreateBotInput) {
    return this.bots.add(requireAccount(ctx), body);
  }

  @Put('bots/:botId')
  updateBot(@Ctx() ctx: RequestContext, @Param('botId') botId: string, @Body(new ZodPipe(updateBotSchema)) body: UpdateBotInput) {
    return this.bots.update(requireAccount(ctx), botId, body);
  }

  @Post('bots/:botId/checked')
  checkedBot(@Ctx() ctx: RequestContext, @Param('botId') botId: string, @Body(new ZodPipe(botVersionSchema)) body: BotVersionInput) {
    return this.bots.checked(requireAccount(ctx), botId, body.basedOn);
  }

  @Delete('bots/:botId')
  @HttpCode(204)
  async removeBot(@Ctx() ctx: RequestContext, @Param('botId') botId: string): Promise<void> {
    await this.bots.remove(requireAccount(ctx), botId);
  }
}
