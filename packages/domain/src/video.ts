import { z } from 'zod';
import { isUuidV7 } from './ids.js';

/**
 * A video on a course lesson, a news post or a hub link (design §10.10): a YouTube video, which a page loads from
 * YouTube only once its viewer presses play, or a file an admin uploaded, played from this server. Never both.
 */
export type Video = YouTubeVideo | UploadedVideo;

export interface YouTubeVideo {
  readonly kind: 'youtube';
  /** YouTube's 11-character video ID. */
  readonly youtubeId: string;
  /** Where it starts, in seconds from the beginning. */
  readonly start: number;
}

export interface UploadedVideo {
  readonly kind: 'upload';
  /** The upload's ID, a UUIDv7 (see videoSrc). */
  readonly videoId: string;
}

/** Where uploads are used, each uploaded by its own admins: Course, System, and Communications for news and press. */
export const VIDEO_AREAS = ['course', 'hub', 'communications'] as const;
export type VideoArea = (typeof VIDEO_AREAS)[number];

/**
 * Uploaded videos: MP4 or WebM, which every current browser plays, at most `maxBytes`, sent in parts of `partBytes`,
 * since Cloud Run takes at most 32 MiB in a request. They are kept as sent, not re-encoded.
 */
export const VIDEO_UPLOAD = {
  types: ['video/mp4', 'video/webm'],
  maxBytes: 1024 ** 3,
  partBytes: 8 * 1024 ** 2,
  fileName: 100,
} as const;
export type VideoType = (typeof VIDEO_UPLOAD.types)[number];

/** `videos/{videoId}`: an upload as its parts arrive, in order; it can be used once it is `ready`. */
export interface VideoRecord {
  readonly videoId: string;
  readonly area: VideoArea;
  /** The course it was uploaded for (area `course`); null elsewhere. */
  readonly courseId: string | null;
  readonly contentType: VideoType;
  readonly size: number;
  readonly parts: number;
  /** How many parts are stored, from the first. */
  readonly received: number;
  readonly ready: boolean;
  /** The name it downloads as, from the name it was uploaded with. */
  readonly fileName: string;
  readonly uploadedAt: string;
  readonly uploadedBy: string;
}

/** What the api answers when an upload starts and after each part. */
export type VideoUpload = Pick<VideoRecord, 'videoId' | 'parts' | 'received' | 'ready'> & { readonly partBytes: number };

export const videoParts = (size: number) => Math.ceil(size / VIDEO_UPLOAD.partBytes);

/** Where a browser plays an uploaded video from: this server, which answers byte ranges. */
export const videoSrc = (videoId: string) => `/v1/public/videos/${videoId}`;

/** The same video as a file to save, under the name it was uploaded with. */
export const videoDownloadSrc = (videoId: string) => `${videoSrc(videoId)}?download=1`;

/** An uploaded video's name as it downloads: its letters, digits, dots, dashes and underscores, with the right ending. */
export function videoFileName(uploaded: string, type: VideoType): string {
  const base = uploaded
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, VIDEO_UPLOAD.fileName - 5);
  return `${base || 'ustp-video'}.${type === 'video/webm' ? 'webm' : 'mp4'}`;
}

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
 * YouTube's privacy-enhanced player for the video, playing at once: pages load it only when a viewer presses play, so
 * no browser contacts YouTube before they choose to.
 */
export function youtubeEmbedSrc(video: YouTubeVideo): string {
  const query = new URLSearchParams({ autoplay: '1', rel: '0' });
  if (video.start) query.set('start', String(video.start));
  return `https://www.youtube-nocookie.com/embed/${video.youtubeId}?${query}`;
}

export const uploadedVideoIdSchema = z.string().refine(isUuidV7, 'not an uploaded video');

export const videoSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('youtube'),
    youtubeId: z.string().regex(YOUTUBE_ID, 'not a YouTube video ID'),
    start: z.number().int().min(0).max(MAX_START),
  }),
  z.strictObject({ kind: z.literal('upload'), videoId: uploadedVideoIdSchema }),
]);

/** The uploads a set of videos names, for the api to check they are finished. */
export function uploadedVideoIds(videos: readonly (Video | null | undefined)[]): string[] {
  return [...new Set(videos.flatMap((v) => (v?.kind === 'upload' ? [v.videoId] : [])))];
}

/** Starts an upload: what the file is, how big and what it was called, so the api knows how many parts to expect. */
export const startVideoSchema = z.strictObject({
  contentType: z.enum(VIDEO_UPLOAD.types),
  size: z.number().int().min(1).max(VIDEO_UPLOAD.maxBytes),
  fileName: z.string().max(500).default(''),
});
export type StartVideoInput = z.infer<typeof startVideoSchema>;
