import { z } from 'zod';
import { isUuidV7 } from './ids.js';

/**
 * A lesson's video (design §10.8), shown above its text: a YouTube video, which the course page loads from YouTube only
 * once a learner presses play, or a file a Course Administrator uploaded, played from this server. Never both.
 */
export type LessonVideo = YouTubeVideo | UploadedVideo;

export interface YouTubeVideo {
  readonly kind: 'youtube';
  /** YouTube's 11-character video ID. */
  readonly youtubeId: string;
  /** Where it starts, in seconds from the beginning. */
  readonly start: number;
}

export interface UploadedVideo {
  readonly kind: 'upload';
  /** The upload's ID, a UUIDv7 (see courseVideoSrc). */
  readonly videoId: string;
}

/**
 * Videos Course Administrators upload: MP4 or WebM, which every current browser plays, at most `maxBytes`, sent in parts
 * of `partBytes`, since Cloud Run takes at most 32 MiB in a request. They are kept as sent, not re-encoded.
 */
export const COURSE_VIDEO = {
  types: ['video/mp4', 'video/webm'],
  maxBytes: 1024 ** 3,
  partBytes: 8 * 1024 ** 2,
} as const;
export type CourseVideoType = (typeof COURSE_VIDEO.types)[number];

/** `course_videos/{videoId}`: an upload as its parts arrive, in order; a lesson may use it once it is `ready`. */
export interface CourseVideoRecord {
  readonly videoId: string;
  /** The course it was uploaded for. */
  readonly courseId: string;
  readonly contentType: CourseVideoType;
  readonly size: number;
  readonly parts: number;
  /** How many parts are stored, from the first. */
  readonly received: number;
  readonly ready: boolean;
  readonly uploadedAt: string;
  readonly uploadedBy: string;
}

/** What the api answers when an upload starts and after each part. */
export type CourseVideoUpload = Pick<CourseVideoRecord, 'videoId' | 'parts' | 'received' | 'ready'> & { readonly partBytes: number };

export const courseVideoParts = (size: number) => Math.ceil(size / COURSE_VIDEO.partBytes);

/** Where a browser plays an uploaded video from: this server, which answers byte ranges. */
export const courseVideoSrc = (videoId: string) => `/v1/public/course-videos/${videoId}`;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
/** The latest start taken, in seconds: a day. */
const MAX_START = 86_400;

/** A start time as YouTube writes it (`90`, `90s`, `1m30s`, `1h2m3s`), in seconds; 0 when there is none. */
function startSeconds(value: string | null): number {
  const match = value ? /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value) : null;
  if (!match) return 0;
  const [, hours = '0', minutes = '0', seconds = '0'] = match;
  return Math.min(Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds), MAX_START);
}

/**
 * The YouTube video a link points to, from any address YouTube gives out (`youtube.com/watch?v=…`, `youtu.be/…`,
 * `/shorts/…`, `/live/…`, `/embed/…`), with its start time from `t=` or `start=`; null for anything else.
 */
export function youtubeVideo(address: string): YouTubeVideo | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!['https:', 'http:'].includes(url.protocol) || !YOUTUBE_HOSTS.has(host)) return null;
  const [first, second] = url.pathname.split('/').filter(Boolean);
  const id = host === 'youtu.be' ? first : first === 'watch' ? url.searchParams.get('v') : ['shorts', 'live', 'embed'].includes(first ?? '') ? second : null;
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return { kind: 'youtube', youtubeId: id, start: startSeconds(url.searchParams.get('t') ?? url.searchParams.get('start')) };
}

/** The video's page on YouTube, at its start time. */
export function youtubeWatchUrl(video: YouTubeVideo): string {
  return `https://www.youtube.com/watch?v=${video.youtubeId}${video.start ? `&t=${video.start}s` : ''}`;
}

/**
 * YouTube's privacy-enhanced player for the video, playing at once: the course page loads it only when a learner
 * presses play, so no browser contacts YouTube before they choose to.
 */
export function youtubeEmbedSrc(video: YouTubeVideo): string {
  const query = new URLSearchParams({ autoplay: '1', rel: '0' });
  if (video.start) query.set('start', String(video.start));
  return `https://www.youtube-nocookie.com/embed/${video.youtubeId}?${query}`;
}

export const lessonVideoSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('youtube'),
    youtubeId: z.string().regex(YOUTUBE_ID, 'not a YouTube video ID'),
    start: z.number().int().min(0).max(MAX_START),
  }),
  z.strictObject({ kind: z.literal('upload'), videoId: z.string().refine(isUuidV7, 'not an uploaded video') }),
]);

/** Starts an upload: what the file is and how big, so the api knows how many parts to expect. */
export const startCourseVideoSchema = z.strictObject({
  contentType: z.enum(COURSE_VIDEO.types),
  size: z.number().int().min(1).max(COURSE_VIDEO.maxBytes),
});
export type StartCourseVideoInput = z.infer<typeof startCourseVideoSchema>;
