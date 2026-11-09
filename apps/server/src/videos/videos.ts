import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Transaction } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';
import { Readable } from 'node:stream';
import {
  Collections,
  isUuidV7,
  startVideoSchema,
  uuidv7,
  VIDEO_UPLOAD,
  videoFileName,
  videoParts,
  type StartVideoInput,
  type VideoArea,
  type VideoRecord,
  type VideoType,
  type VideoUpload,
} from 'ustp-domain';
import { Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { CourseIdPipe } from '../course/course-id.pipe.js';
import { Firebase } from '../infra/firebase.js';

type Bucket = ReturnType<Storage['bucket']>;

const PART = VIDEO_UPLOAD.partBytes;
const VIDEO_NAMES: Readonly<Record<VideoType, string>> = { 'video/mp4': 'an MP4', 'video/webm': 'a WebM' };
/**
 * An upload's bytes never change, so browsers may keep them; shared caches may not, since a CDN that stored one range
 * might answer another with it.
 */
const CACHE = 'private, max-age=31536000, immutable';
/** Ready uploads kept in memory, so each range a player asks for costs no Firestore read. */
const KEPT = 500;

/**
 * What a file's first bytes say it is: an MP4 (an ISO media file, `ftyp` at byte 4) or a WebM (an EBML file whose
 * document type is `webm`), or null for anything else, a Matroska file included, which not every browser plays.
 */
export function videoTypeOf(bytes: Buffer): VideoType | null {
  if (bytes.length >= 12 && bytes.toString('latin1', 4, 8) === 'ftyp') return 'video/mp4';
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3) {
    const header = bytes.subarray(0, 64).toString('latin1');
    const docType = header.indexOf('\x42\x82');
    return docType >= 0 && header.slice(docType + 2, docType + 8).includes('webm') ? 'video/webm' : null;
  }
  return null;
}

/**
 * The bytes a `Range` header asks for, as the first of its ranges, ends included: null when there is no header or it
 * is not one this server reads (the whole file is sent), `unsatisfiable` when it starts past the end.
 */
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = header ? /^bytes=(\d*)-(\d*)/.exec(header.trim()) : null;
  if (!match || (!match[1] && !match[2])) return null;
  const [, from, to] = match;
  if (!from) {
    const suffix = Number(to);
    return suffix === 0 ? 'unsatisfiable' : { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  const end = to ? Math.min(Number(to), size - 1) : size - 1;
  if (start >= size) return 'unsatisfiable';
  return end < start ? null : { start, end };
}

const partName = (videoId: string, index: number) => `${videoId}/${String(index).padStart(4, '0')}`;
const partSize = (video: Pick<VideoRecord, 'size' | 'parts'>, index: number) => (index < video.parts - 1 ? PART : video.size - PART * (video.parts - 1));
const uploadView = ({ videoId, parts, received, ready }: VideoRecord): VideoUpload => ({ videoId, parts, received, ready, partBytes: PART });

/** Where an upload belongs: its area, and for a course, which one. */
interface UploadPlace {
  readonly area: VideoArea;
  readonly courseId: string | null;
}

export interface ServedVideo {
  readonly status: 200 | 206 | 416;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer | Readable;
}

/**
 * Uploaded videos for lessons, news posts, the press kit and the hub (design §10.10). A file arrives in parts of
 * VIDEO_UPLOAD.partBytes, in order, each kept as its own object in the videos bucket, and is played back from those
 * parts by byte range, so no request in either direction carries more than one part.
 */
@Injectable()
export class VideosService {
  private readonly ready = new Map<string, VideoRecord>();

  constructor(
    private readonly firebase: Firebase,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Starts an upload; nothing shows until something is saved with the finished video. */
  async start(place: UploadPlace, input: StartVideoInput, accountId: string): Promise<VideoUpload> {
    this.bucket();
    if (place.courseId && !(await this.firebase.db.collection(Collections.courses).doc(place.courseId).get()).exists) {
      throw new NotFoundException('course not found');
    }
    const videoId = uuidv7();
    const record: VideoRecord = {
      videoId,
      ...place,
      contentType: input.contentType,
      size: input.size,
      parts: videoParts(input.size),
      received: 0,
      ready: false,
      fileName: videoFileName(input.fileName, input.contentType),
      uploadedAt: new Date().toISOString(),
      uploadedBy: accountId,
    };
    await this.doc(videoId).set(record);
    return uploadView(record);
  }

  /**
   * Stores the next part. One already stored is not stored again, so a part whose answer was lost can be resent; one
   * further on is refused until those before it arrive. The first part must be the kind of file the upload said.
   */
  async putPart(place: UploadPlace, videoId: string, index: number, body: unknown, contentType: string | undefined): Promise<VideoUpload> {
    const bucket = this.bucket();
    if (!isUuidV7(videoId)) throw new NotFoundException('no such upload');
    const video = (await this.doc(videoId).get()).data() as VideoRecord | undefined;
    if (!video || video.area !== place.area || video.courseId !== place.courseId) throw new NotFoundException('no such upload');
    if (!Number.isSafeInteger(index) || index < 0 || index >= video.parts) throw new NotFoundException(`this upload has parts 0 to ${video.parts - 1}`);
    if (index < video.received) return uploadView(video);
    if (index > video.received) throw new ConflictException(`send part ${video.received} first`);
    if (!Buffer.isBuffer(body)) throw new BadRequestException('send the part as the request body');
    if (contentType?.split(';')[0]?.trim().toLowerCase() !== video.contentType) throw new BadRequestException(`this upload is ${VIDEO_NAMES[video.contentType]} video`);
    if (body.length !== partSize(video, index)) throw new BadRequestException(`part ${index} must be ${partSize(video, index)} bytes`);
    if (index === 0 && videoTypeOf(body) !== video.contentType) {
      throw new BadRequestException(`that file is not ${VIDEO_NAMES[video.contentType]} video; use an MP4 or WebM file`);
    }
    await bucket.file(partName(videoId, index)).save(body, { contentType: 'application/octet-stream', resumable: false });
    return this.firebase.db.runTransaction(async (tx) => {
      const current = (await tx.get(this.doc(videoId))).data() as VideoRecord;
      if (current.received !== index) return uploadView(current);
      const updated: VideoRecord = { ...current, received: index + 1, ready: index + 1 === current.parts };
      tx.set(this.doc(videoId), updated);
      return uploadView(updated);
    });
  }

  /**
   * The finished uploads among these IDs, by ID, read in the transaction when one is given: a save that names any
   * other is refused (400) by its caller, through requireReady.
   */
  async finished(ids: readonly string[], tx?: Transaction): Promise<Map<string, VideoRecord>> {
    const valid = ids.filter((id) => isUuidV7(id));
    if (!valid.length) return new Map();
    const refs = valid.map((id) => this.doc(id));
    const snaps = tx ? await tx.getAll(...refs) : await this.firebase.db.getAll(...refs);
    const records = snaps.map((snap) => snap.data() as VideoRecord | undefined).filter((v): v is VideoRecord => !!v?.ready);
    return new Map(records.map((v) => [v.videoId, v]));
  }

  /** Refuses a save that names an upload which is not a finished one uploaded here. */
  async requireReady(ids: readonly string[], tx?: Transaction): Promise<void> {
    if (!ids.length) return;
    const found = await this.finished(ids, tx);
    if (ids.some((id) => !found.has(id))) throw new BadRequestException('that video is not one uploaded here, or has not finished uploading; upload it again');
  }

  /**
   * A finished upload for anyone to play: the part a range starts in, from there to the range's end or the part's,
   * whichever is first (a player asks again for the rest), or with no range the whole file, a part at a time; with
   * `download`, as a file to save under its uploaded name.
   */
  async serve(videoId: string, range: string | undefined, download: boolean): Promise<ServedVideo> {
    const video = await this.readyVideo(videoId);
    const bucket = this.bucket();
    const headers: Record<string, string> = { 'content-type': video.contentType, 'accept-ranges': 'bytes', 'cache-control': CACHE, etag: `"${videoId}"` };
    if (download) headers['content-disposition'] = `attachment; filename="${video.fileName}"`;
    const wanted = byteRange(range, video.size);
    if (wanted === 'unsatisfiable') return { status: 416, headers: { ...headers, 'content-range': `bytes */${video.size}` }, body: Buffer.alloc(0) };
    if (!wanted) {
      async function* parts() {
        for (let index = 0; index < video.parts; index++) yield (await bucket.file(partName(videoId, index)).download())[0];
      }
      // Without a length the answer is chunked, as Cloud Run needs for an HTTP/1 response over 32 MiB.
      return { status: 200, headers, body: Readable.from(parts(), { objectMode: false }) };
    }
    const index = Math.floor(wanted.start / PART);
    const end = Math.min(wanted.end, (index + 1) * PART - 1);
    const [bytes] = await bucket.file(partName(videoId, index)).download({ start: wanted.start - index * PART, end: end - index * PART });
    return { status: 206, headers: { ...headers, 'content-range': `bytes ${wanted.start}-${end}/${video.size}`, 'content-length': String(bytes.length) }, body: bytes };
  }

  private async readyVideo(videoId: string): Promise<VideoRecord> {
    if (!isUuidV7(videoId)) throw new NotFoundException('no such video');
    const kept = this.ready.get(videoId);
    if (kept) return kept;
    const video = (await this.doc(videoId).get()).data() as VideoRecord | undefined;
    if (!video?.ready) throw new NotFoundException('no such video');
    if (this.ready.size >= KEPT) this.ready.clear();
    this.ready.set(videoId, video);
    return video;
  }

  private doc(videoId: string) {
    return this.firebase.db.collection(Collections.videos).doc(videoId);
  }

  private bucket(): Bucket {
    if (!this.config.videosBucket) throw new ServiceUnavailableException('video storage is not configured (VIDEOS_BUCKET)');
    return this.firebase.storage.bucket(this.config.videosBucket);
  }
}

/** A part's index from the address; anything else is no part. */
const partIndex = (index: string) => (/^\d{1,4}$/.test(index) ? Number(index) : -1);

/**
 * Uploading: each area's admins start an upload (MP4 or WebM, at most 1 GiB; the answer says how many parts to send,
 * and how big), then send its parts in order from 0, each part's raw bytes as the body with the video's Content-Type.
 */
@Controller('v1')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Post('admin/courses/:courseId/videos')
  @Roles('course_admin')
  startCourse(@Ctx() ctx: RequestContext, @Param('courseId', CourseIdPipe) courseId: string, @Body(new ZodPipe(startVideoSchema)) input: StartVideoInput) {
    return this.videos.start({ area: 'course', courseId }, input, requireAccount(ctx));
  }

  @Put('admin/courses/:courseId/videos/:videoId/parts/:index')
  @Roles('course_admin')
  partCourse(@Param('courseId', CourseIdPipe) courseId: string, @Param('videoId') videoId: string, @Param('index') index: string, @Req() req: FastifyRequest, @Body() body: unknown) {
    return this.videos.putPart({ area: 'course', courseId }, videoId, partIndex(index), body, req.headers['content-type']);
  }

  @Post('admin/communications/videos')
  @Roles('communications_admin')
  startCommunications(@Ctx() ctx: RequestContext, @Body(new ZodPipe(startVideoSchema)) input: StartVideoInput) {
    return this.videos.start({ area: 'communications', courseId: null }, input, requireAccount(ctx));
  }

  @Put('admin/communications/videos/:videoId/parts/:index')
  @Roles('communications_admin')
  partCommunications(@Param('videoId') videoId: string, @Param('index') index: string, @Req() req: FastifyRequest, @Body() body: unknown) {
    return this.videos.putPart({ area: 'communications', courseId: null }, videoId, partIndex(index), body, req.headers['content-type']);
  }

  @Post('admin/hub/videos')
  @Roles('system_admin', 'site_admin', 'communications_admin')
  startHub(@Ctx() ctx: RequestContext, @Body(new ZodPipe(startVideoSchema)) input: StartVideoInput) {
    return this.videos.start({ area: 'hub', courseId: null }, input, requireAccount(ctx));
  }

  @Put('admin/hub/videos/:videoId/parts/:index')
  @Roles('system_admin', 'site_admin', 'communications_admin')
  partHub(@Param('videoId') videoId: string, @Param('index') index: string, @Req() req: FastifyRequest, @Body() body: unknown) {
    return this.videos.putPart({ area: 'hub', courseId: null }, videoId, partIndex(index), body, req.headers['content-type']);
  }

  /** An uploaded video, by byte range, for any page's player, or with `?download=1` as a file; anyone may fetch it. */
  @Public()
  @Get('public/videos/:videoId')
  async play(@Param('videoId') videoId: string, @Query('download') download: string | undefined, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const served = await this.videos.serve(videoId, request.headers.range, download !== undefined);
    await reply.status(served.status).headers(served.headers).send(served.body);
  }
}
