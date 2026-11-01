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
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Storage } from 'firebase-admin/storage';
import { Readable } from 'node:stream';
import {
  Collections,
  COURSE_VIDEO,
  courseVideoParts,
  isUuidV7,
  startCourseVideoSchema,
  uuidv7,
  type CourseVideoRecord,
  type CourseVideoType,
  type CourseVideoUpload,
  type StartCourseVideoInput,
} from 'ustp-domain';
import { Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { CourseIdPipe } from './course.controller.js';

type Bucket = ReturnType<Storage['bucket']>;

const PART = COURSE_VIDEO.partBytes;
const VIDEO_NAMES: Readonly<Record<CourseVideoType, string>> = { 'video/mp4': 'an MP4', 'video/webm': 'a WebM' };
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
export function videoTypeOf(bytes: Buffer): CourseVideoType | null {
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
const partSize = (video: Pick<CourseVideoRecord, 'size' | 'parts'>, index: number) =>
  index < video.parts - 1 ? PART : video.size - PART * (video.parts - 1);
const uploadView = ({ videoId, parts, received, ready }: CourseVideoRecord): CourseVideoUpload => ({ videoId, parts, received, ready, partBytes: PART });

export interface ServedVideo {
  readonly status: 200 | 206 | 416;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer | Readable;
}

/**
 * Lesson videos Course Administrators upload (design §10.8). A file arrives in parts of COURSE_VIDEO.partBytes, in
 * order, each kept as its own object in the course videos bucket, and is played back from those parts by byte range,
 * so no request in either direction carries more than one part.
 */
@Injectable()
export class CourseVideosService {
  private readonly ready = new Map<string, CourseVideoRecord>();

  constructor(
    private readonly firebase: Firebase,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Starts an upload for the course; nothing shows until a lesson is saved with the finished video and published. */
  async start(courseId: string, input: StartCourseVideoInput, accountId: string): Promise<CourseVideoUpload> {
    this.bucket();
    if (!(await this.firebase.db.collection(Collections.courses).doc(courseId).get()).exists) throw new NotFoundException('course not found');
    const videoId = uuidv7();
    const record: CourseVideoRecord = {
      videoId,
      courseId,
      contentType: input.contentType,
      size: input.size,
      parts: courseVideoParts(input.size),
      received: 0,
      ready: false,
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
  async putPart(courseId: string, videoId: string, index: number, body: unknown, contentType: string | undefined): Promise<CourseVideoUpload> {
    const bucket = this.bucket();
    if (!isUuidV7(videoId)) throw new NotFoundException('no such upload');
    const snap = await this.doc(videoId).get();
    const video = snap.data() as CourseVideoRecord | undefined;
    if (!video || video.courseId !== courseId) throw new NotFoundException('no such upload');
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
      const current = (await tx.get(this.doc(videoId))).data() as CourseVideoRecord;
      if (current.received !== index) return uploadView(current);
      const updated: CourseVideoRecord = { ...current, received: index + 1, ready: index + 1 === current.parts };
      tx.set(this.doc(videoId), updated);
      return uploadView(updated);
    });
  }

  /**
   * A finished upload for anyone to play: the part a range starts in, from there to the range's end or the part's,
   * whichever is first (a player asks again for the rest), or with no range the whole file, a part at a time.
   */
  async serve(videoId: string, range: string | undefined): Promise<ServedVideo> {
    const video = await this.readyVideo(videoId);
    const bucket = this.bucket();
    const headers = { 'content-type': video.contentType, 'accept-ranges': 'bytes', 'cache-control': CACHE, etag: `"${videoId}"` };
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
    const headersOut = { ...headers, 'content-range': `bytes ${wanted.start}-${end}/${video.size}`, 'content-length': String(bytes.length) };
    return { status: 206, headers: headersOut, body: bytes };
  }

  private async readyVideo(videoId: string): Promise<CourseVideoRecord> {
    if (!isUuidV7(videoId)) throw new NotFoundException('no such video');
    const kept = this.ready.get(videoId);
    if (kept) return kept;
    const video = (await this.doc(videoId).get()).data() as CourseVideoRecord | undefined;
    if (!video?.ready) throw new NotFoundException('no such video');
    if (this.ready.size >= KEPT) this.ready.clear();
    this.ready.set(videoId, video);
    return video;
  }

  private doc(videoId: string) {
    return this.firebase.db.collection(Collections.courseVideos).doc(videoId);
  }

  private bucket(): Bucket {
    if (!this.config.courseVideosBucket) throw new ServiceUnavailableException('video storage is not configured (COURSE_VIDEOS_BUCKET)');
    return this.firebase.storage.bucket(this.config.courseVideosBucket);
  }
}

@Controller('v1')
export class CourseVideosController {
  constructor(private readonly videos: CourseVideosService) {}

  /** Starts uploading a lesson video (MP4 or WebM, at most 1 GiB): the answer says how many parts to send, and how big. */
  @Post('admin/courses/:courseId/videos')
  @Roles('course_admin')
  start(@Ctx() ctx: RequestContext, @Param('courseId', CourseIdPipe) courseId: string, @Body(new ZodPipe(startCourseVideoSchema)) input: StartCourseVideoInput) {
    return this.videos.start(courseId, input, requireAccount(ctx));
  }

  /** One part of the upload, in order from 0: its raw bytes as the body, with the video's Content-Type. */
  @Put('admin/courses/:courseId/videos/:videoId/parts/:index')
  @Roles('course_admin')
  part(
    @Param('courseId', CourseIdPipe) courseId: string,
    @Param('videoId') videoId: string,
    @Param('index') index: string,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ) {
    const part = /^\d{1,4}$/.test(index) ? Number(index) : -1;
    return this.videos.putPart(courseId, videoId, part, body, request.headers['content-type']);
  }

  /** An uploaded video, by byte range, for the course page's player; anyone may play it, as anyone may read a lesson. */
  @Public()
  @Get('public/course-videos/:videoId')
  async play(@Param('videoId') videoId: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const served = await this.videos.serve(videoId, request.headers.range);
    await reply.status(served.status).headers(served.headers).send(served.body);
  }
}
