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
import sharp, { type ResizeOptions } from 'sharp';
import {
  checkHub,
  uploadedVideoIds,
  clickCount,
  clickDay,
  clickTargets,
  Collections,
  HUB_IMAGE_KINDS,
  HUB_IMAGE_NAMES,
  HUB_IMAGE_SIZES,
  hubChanges,
  hubImageProblem,
  hubSchema,
  isHubImageId,
  publicHub,
  resolveHub,
  type ClickTarget,
  type DiscordLive,
  type HubChangedPayload,
  type HubClickCount,
  type HubClicksRecord,
  type HubImageKind,
  type HubInput,
  type HubRecord,
  type PublicHub,
} from 'ustp-domain';
import { Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck, ZodPipe } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { VideosService } from '../videos/videos.js';

const CACHE_MS = 60_000;
const DOC_ID = 'current';

/** Where each kind of uploaded image is kept, under the SHA-256 of its stored bytes. */
const IMAGE_COLLECTIONS: Readonly<Record<HubImageKind, string>> = {
  logo: Collections.hubLogos,
  cover: Collections.hubCovers,
  background: Collections.hubBackgrounds,
};

/**
 * How each kind is fitted to its stored size (`HUB_IMAGE_SIZES`): the whole logo on a transparent square; the cover
 * cropped from the middle to exactly 3:1, since the hub shows it whole; the background shrunk to fit, as the page
 * crops it to the window anyway.
 */
function fitting(kind: HubImageKind): ResizeOptions {
  const { width, height } = HUB_IMAGE_SIZES[kind];
  switch (kind) {
    case 'logo':
      return { width, height, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: true };
    case 'cover':
      return { width, height, fit: 'cover', position: 'centre' };
    case 'background':
      return { width, height, fit: 'inside', withoutEnlargement: true };
  }
}

/** A Firestore document holds 1 MiB, so an image is stored in at most this many bytes, at the best quality that fits. */
const MAX_STORED_BYTES = 900_000;
const QUALITIES: Readonly<Record<HubImageKind, readonly number[]>> = {
  logo: [90, 75],
  cover: [85, 75, 65],
  background: [80, 70, 60, 50],
};

function record(data: Partial<HubRecord> | undefined): HubRecord {
  return { ...resolveHub(data), version: data?.version ?? 0, updatedAt: data?.updatedAt ?? null, updatedBy: data?.updatedBy ?? null };
}

/**
 * Decodes an uploaded image and re-encodes it upright as a WebP of its kind's size: decoding proves it is an image, and
 * re-encoding drops its metadata and anything else hidden in the bytes (as profile photos).
 */
async function normalizeHubImage(kind: HubImageKind, input: Buffer): Promise<Buffer> {
  const options = { limitInputPixels: 50_000_000, failOn: 'error' } as const;
  let meta;
  try {
    meta = await sharp(input, options).metadata();
  } catch {
    throw new BadRequestException('that file is not a readable image');
  }
  if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '')) throw new BadRequestException('use a PNG, JPEG or WebP image');
  // EXIF orientations 5–8 swap width and height.
  const [width, height] = (meta.orientation ?? 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  const problem = hubImageProblem(kind, width ?? 0, height ?? 0);
  if (problem) throw new BadRequestException(problem);
  for (const quality of QUALITIES[kind]) {
    const image = await sharp(input, options).rotate().resize(fitting(kind)).webp({ quality }).toBuffer();
    if (image.length <= MAX_STORED_BYTES) return image;
  }
  throw new BadRequestException(`that ${HUB_IMAGE_NAMES[kind]} has too much fine detail to store; try a smaller or simpler image`);
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
    private readonly videos: VideosService,
  ) {}

  private get doc() {
    return this.firebase.db.collection(Collections.hub).doc(DOC_ID);
  }

  private imageDoc(kind: HubImageKind, id: string) {
    return this.firebase.db.collection(IMAGE_COLLECTIONS[kind]).doc(id);
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
   * is unfinished, an address or the accent cannot be used, a new logo, cover banner or background photo is not one
   * uploaded here, or a link's video is not a finished upload.
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
      for (const kind of HUB_IMAGE_KINDS) {
        const id = after.profile[kind];
        if (id && id !== before.profile[kind] && !(await tx.get(this.imageDoc(kind, id))).exists) {
          throw new BadRequestException(`that ${HUB_IMAGE_NAMES[kind]} is not one uploaded here; upload it again`);
        }
      }
      await this.videos.requireReady(uploadedVideoIds(after.sections.flatMap((s) => s.links.map((l) => l.video))), tx);
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
   * Stores an uploaded logo, cover banner or background photo, re-encoded, under the hash of its bytes, and gives that
   * ID. It shows only once the hub is saved with it, so uploading changes nothing a visitor sees.
   */
  async uploadImage(ctx: RequestContext, kind: HubImageKind, body: unknown): Promise<string> {
    const actor = requireAccount(ctx);
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException('send the image as the request body');
    const image = await normalizeHubImage(kind, body);
    const id = createHash('sha256').update(image).digest('hex');
    await this.imageDoc(kind, id).set({ image, contentType: 'image/webp', uploadedAt: new Date().toISOString(), uploadedBy: actor });
    return id;
  }

  async image(kind: HubImageKind, id: string): Promise<Buffer> {
    if (!isHubImageId(id)) throw new NotFoundException(`no such ${HUB_IMAGE_NAMES[kind]}`);
    const snap = await this.imageDoc(kind, id).get();
    const image = snap.get('image') as Buffer | undefined;
    if (!image) throw new NotFoundException(`no such ${HUB_IMAGE_NAMES[kind]}`);
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

/** The hub every visitor's home page shows, its images, the Discord count and click counting: no sign-in. */
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

  /** An image's ID is the hash of its bytes, so it never changes and browsers may keep it. */
  @Public()
  @Get('logo/:id')
  @Header('Content-Type', 'image/webp')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  logo(@Param('id') id: string): Promise<Buffer> {
    return this.hub.image('logo', id);
  }

  @Public()
  @Get('cover/:id')
  @Header('Content-Type', 'image/webp')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  cover(@Param('id') id: string): Promise<Buffer> {
    return this.hub.image('cover', id);
  }

  @Public()
  @Get('background/:id')
  @Header('Content-Type', 'image/webp')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  background(@Param('id') id: string): Promise<Buffer> {
    return this.hub.image('background', id);
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
 * §10.9): its links are the party's social accounts.
 */
@Controller('v1/admin/hub')
@Roles('system_admin', 'site_admin', 'communications_admin')
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

  /** Each upload takes the raw image as the body (Content-Type image/png, image/jpeg or image/webp), at most 5 MB. */
  @Put('logo')
  async uploadLogo(@Ctx() ctx: RequestContext, @Body() body: unknown): Promise<{ logo: string }> {
    return { logo: await this.hub.uploadImage(ctx, 'logo', body) };
  }

  @Put('cover')
  async uploadCover(@Ctx() ctx: RequestContext, @Body() body: unknown): Promise<{ cover: string }> {
    return { cover: await this.hub.uploadImage(ctx, 'cover', body) };
  }

  @Put('background')
  async uploadBackground(@Ctx() ctx: RequestContext, @Body() body: unknown): Promise<{ background: string }> {
    return { background: await this.hub.uploadImage(ctx, 'background', body) };
  }

  @Get('clicks')
  clicks() {
    return this.hub.clicks();
  }
}
