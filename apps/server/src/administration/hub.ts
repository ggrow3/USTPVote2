import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import sharp from 'sharp';
import {
  checkHub,
  clickCount,
  clickDay,
  clickTargets,
  Collections,
  hubChanges,
  hubSchema,
  isLogoId,
  publicHub,
  resolveHub,
  type ClickTarget,
  type DiscordLive,
  type HubChangedPayload,
  type HubClickCount,
  type HubClicksRecord,
  type HubInput,
  type HubRecord,
  type PublicHub,
} from 'ustp-domain';
import { Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck, ZodPipe } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';

const CACHE_MS = 60_000;
const DOC_ID = 'current';

/** Logos are stored square, at most this many pixels a side, and need at least LOGO_MIN to look sharp on the tile. */
const LOGO_SIDE = 256;
const LOGO_MIN = 64;

function record(data: Partial<HubRecord> | undefined): HubRecord {
  return { ...resolveHub(data), version: data?.version ?? 0, updatedAt: data?.updatedAt ?? null, updatedBy: data?.updatedBy ?? null };
}

/**
 * Decodes an uploaded logo and re-encodes it as a square WebP, the whole logo kept on a transparent ground: decoding
 * proves it is an image, and re-encoding drops its metadata and anything else hidden in the bytes (as profile photos).
 */
async function normalizeLogo(input: Buffer): Promise<Buffer> {
  const options = { limitInputPixels: 50_000_000, failOn: 'error' } as const;
  let meta;
  try {
    meta = await sharp(input, options).metadata();
  } catch {
    throw new BadRequestException('that file is not a readable image');
  }
  if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '')) throw new BadRequestException('use a PNG, JPEG or WebP image');
  if (Math.min(meta.width ?? 0, meta.height ?? 0) < LOGO_MIN) {
    throw new BadRequestException(`the logo must be at least ${LOGO_MIN}×${LOGO_MIN} pixels`);
  }
  return sharp(input, options)
    .rotate()
    .resize({ width: LOGO_SIDE, height: LOGO_SIDE, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer();
}

/**
 * The home page hub (design §10.6). Read by every visit to the home page, so cached briefly, as the quote and the
 * navigation settings are; another api instance picks up a change within a minute.
 */
@Injectable()
export class HubService {
  private cache: { at: number; record: HubRecord } | null = null;

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
  ) {}

  private get doc() {
    return this.firebase.db.collection(Collections.hub).doc(DOC_ID);
  }

  private logoDoc(id: string) {
    return this.firebase.db.collection(Collections.hubLogos).doc(id);
  }

  async current(): Promise<HubRecord> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.record;
    const snap = await this.doc.get();
    const current = record(snap.data() as HubRecord | undefined);
    this.cache = { at: Date.now(), record: current };
    return current;
  }

  async shown(): Promise<PublicHub> {
    const { version, ...hub } = await this.current();
    return publicHub(hub, version);
  }

  /**
   * Saves the hub, tidied, if nobody saved since `basedOn`, ledgering every change. Refused (400) when something shown
   * is unfinished, an address or the accent cannot be used, or the logo is not one uploaded here.
   */
  async update(ctx: RequestContext, input: HubInput): Promise<HubRecord> {
    const actor = requireAccount(ctx);
    const { basedOn, ...hub } = input;
    const after = resolveHub(hub);
    assertCheck(checkHub(after), BadRequestException);
    const saved = await this.firebase.db.runTransaction(async (tx) => {
      const before = record((await tx.get(this.doc)).data() as HubRecord | undefined);
      if (basedOn !== before.version) {
        throw new ConflictException('someone else changed the hub since you opened it; reload to see their change');
      }
      const changes = hubChanges(before, after);
      if (changes.length === 0) return before;
      const logo = after.profile.logo;
      if (logo && logo !== before.profile.logo && !(await tx.get(this.logoDoc(logo))).exists) {
        throw new BadRequestException('that logo is not one uploaded here; upload it again');
      }
      const next: HubRecord = { ...after, version: before.version + 1, updatedAt: new Date().toISOString(), updatedBy: actor };
      const payload: HubChangedPayload = { version: next.version, changes };
      await this.ledger.record(tx, [{ type: 'hub.changed', actor, subject: null, payload: { ...payload } }]);
      tx.set(this.doc, next);
      return next;
    });
    this.cache = { at: Date.now(), record: saved };
    return saved;
  }

  /**
   * Stores an uploaded logo, re-encoded, under the hash of its bytes, and gives that ID. It shows only once the hub is
   * saved with it, so uploading changes nothing a visitor sees.
   */
  async uploadLogo(ctx: RequestContext, body: unknown): Promise<{ logo: string }> {
    const actor = requireAccount(ctx);
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException('send the image as the request body');
    const image = await normalizeLogo(body);
    const id = createHash('sha256').update(image).digest('hex');
    await this.logoDoc(id).set({ image, contentType: 'image/webp', uploadedAt: new Date().toISOString(), uploadedBy: actor });
    return { logo: id };
  }

  async logo(id: string): Promise<Buffer> {
    if (!isLogoId(id)) throw new NotFoundException('no such logo');
    const snap = await this.logoDoc(id).get();
    const image = snap.get('image') as Buffer | undefined;
    if (!image) throw new NotFoundException('no such logo');
    return Buffer.from(image);
  }

  /** Counts one click on something the hub shows now: a total and today's count, nothing about who clicked. */
  async click(target: string): Promise<void> {
    if (!clickTargets(await this.shown()).includes(target as ClickTarget)) throw new NotFoundException('nothing on the hub by that name');
    await this.firebase.db
      .collection(Collections.hubClicks)
      .doc(target)
      .set({ total: FieldValue.increment(1), days: { [clickDay(new Date())]: FieldValue.increment(1) } }, { merge: true });
  }

  /** Every target's counts, including links since removed or hidden (their counts are kept). */
  async clicks(): Promise<HubClickCount[]> {
    const today = clickDay(new Date());
    const snap = await this.firebase.db.collection(Collections.hubClicks).get();
    return snap.docs.map((d) => clickCount(d.id, d.data() as Partial<HubClicksRecord>, today));
  }

  invalidate(): void {
    this.cache = null;
  }
}

/** Discord's public widget data, from which only the online count is used. */
interface DiscordWidget {
  readonly presence_count?: unknown;
}

const DISCORD_CACHE_MS = 5 * 60_000;
const DISCORD_TIMEOUT_MS = 3_000;

/**
 * How many are online in the party's Discord server (design §10.6), read by the API from Discord's public widget
 * (Server Settings › Widget must be on), so a visitor's browser never contacts Discord. Cached for five minutes,
 * failures too, so visits never wait on Discord more than once in that time.
 */
@Injectable()
export class DiscordLiveService {
  private readonly logger = new Logger(DiscordLiveService.name);
  private cache = new Map<string, { at: number; online: number | null }>();

  constructor(private readonly hub: HubService) {}

  async live(): Promise<DiscordLive> {
    const { discord } = await this.hub.current();
    if (!discord.invite || !discord.widget || !discord.guildId) return { online: null };
    const cached = this.cache.get(discord.guildId);
    if (cached && Date.now() - cached.at < DISCORD_CACHE_MS) return { online: cached.online };
    let online: number | null = null;
    try {
      const widget = await this.fetchWidget(discord.guildId);
      online = typeof widget?.presence_count === 'number' ? widget.presence_count : null;
    } catch (e) {
      this.logger.warn(`Discord widget unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.cache = new Map([[discord.guildId, { at: Date.now(), online }]]);
    return { online };
  }

  /** Discord's widget JSON, or null when the server has its widget switched off (403) or does not exist (404). */
  async fetchWidget(guildId: string): Promise<DiscordWidget | null> {
    const res = await fetch(`https://discord.com/api/guilds/${guildId}/widget.json`, {
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as DiscordWidget;
  }

  invalidate(): void {
    this.cache.clear();
  }
}

/** The hub every visitor's home page shows, its logo, the Discord count and click counting: no sign-in. */
@Controller('v1/hub')
export class PublicHubController {
  constructor(
    private readonly hub: HubService,
    private readonly discord: DiscordLiveService,
  ) {}

  @Public()
  @Get()
  current(): Promise<PublicHub> {
    return this.hub.shown();
  }

  @Public()
  @Get('discord')
  live(): Promise<DiscordLive> {
    return this.discord.live();
  }

  /** A logo's ID is the hash of its bytes, so it never changes and browsers may keep it. */
  @Public()
  @Get('logo/:id')
  @Header('Content-Type', 'image/webp')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  logo(@Param('id') id: string): Promise<Buffer> {
    return this.hub.logo(id);
  }

  @Public()
  @Post('clicks/:target')
  @HttpCode(204)
  async click(@Param('target') target: string): Promise<void> {
    await this.hub.click(target);
  }
}

/**
 * System Admins and Communications Admins manage the hub and see how often each link is followed (design §10.6,
 * §10.7): its links are the party's social accounts.
 */
@Controller('v1/admin/hub')
@Roles('system_admin', 'communications_admin')
export class HubAdminController {
  constructor(private readonly hub: HubService) {}

  @Get()
  current() {
    return this.hub.current();
  }

  @Put()
  update(@Ctx() ctx: RequestContext, @Body(new ZodPipe(hubSchema)) body: HubInput) {
    return this.hub.update(ctx, body);
  }

  /** The raw image as the body (Content-Type image/png, image/jpeg or image/webp). */
  @Put('logo')
  uploadLogo(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.hub.uploadLogo(ctx, body);
  }

  @Get('clicks')
  clicks() {
    return this.hub.clicks();
  }
}
