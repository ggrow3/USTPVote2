import { describe, expect, it } from 'vitest';
import { saveCourseLessonSchema } from './course.js';
import {
  VIDEO_UPLOAD,
  videoParts,
  videoSrc,
  videoSchema,
  startVideoSchema,
  uploadedVideoIds,
  videoDownloadSrc,
  videoFileName,
  youtubeEmbedSrc,
  youtubeVideo,
  youtubeWatchUrl,
} from './video.js';
import { uuidv7 } from './ids.js';

const ID = 'dQw4w9WgXcQ';
const lesson = {
  order: 1,
  title: 'T',
  summary: 'S',
  body: 'B',
  estimatedMinutes: 5,
  questions: [{ prompt: 'Which?', choices: ['a', 'b'], correctIndex: 0, explanation: 'Because.' }],
};

describe('YouTube links', () => {
  it('find the video in every address YouTube gives out', () => {
    for (const address of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?feature=share&v=${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}?si=abc`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
      `  http://www.YouTube.com/watch?v=${ID}  `,
    ]) {
      expect(youtubeVideo(address), address).toEqual({ kind: 'youtube', youtubeId: ID, start: 0 });
    }
  });

  it('keep where the video starts, however it is written', () => {
    expect(youtubeVideo(`https://youtu.be/${ID}?t=90`)?.start).toBe(90);
    expect(youtubeVideo(`https://www.youtube.com/watch?v=${ID}&t=90s`)?.start).toBe(90);
    expect(youtubeVideo(`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`)?.start).toBe(3723);
    expect(youtubeVideo(`https://www.youtube.com/embed/${ID}?start=42`)?.start).toBe(42);
    expect(youtubeVideo(`https://youtu.be/${ID}?t=soon`)?.start).toBe(0);
    expect(youtubeVideo(`https://youtu.be/${ID}?t=999999`)?.start).toBe(86_400);
  });

  it('refuse anything that is not one YouTube video', () => {
    for (const address of [
      '',
      'not a link',
      `https://vimeo.com/${ID}`,
      `https://youtube.com.evil.test/watch?v=${ID}`,
      `https://www.youtube.com/@ustp`,
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/watch?v=short',
      `javascript:alert('${ID}')`,
      `ftp://youtu.be/${ID}`,
    ]) {
      expect(youtubeVideo(address), address).toBeNull();
    }
  });

  it('play in the privacy-enhanced player, and open on YouTube at the same moment', () => {
    expect(youtubeEmbedSrc({ kind: 'youtube', youtubeId: ID, start: 0 })).toBe(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0`);
    expect(youtubeEmbedSrc({ kind: 'youtube', youtubeId: ID, start: 90 })).toBe(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0&start=90`);
    expect(youtubeWatchUrl({ kind: 'youtube', youtubeId: ID, start: 0 })).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(youtubeWatchUrl({ kind: 'youtube', youtubeId: ID, start: 90 })).toBe(`https://www.youtube.com/watch?v=${ID}&t=90s`);
  });
});

describe('lesson videos', () => {
  it('are a YouTube video or an upload, never anything else', () => {
    const videoId = uuidv7();
    expect(videoSchema.safeParse({ kind: 'youtube', youtubeId: ID, start: 0 }).success).toBe(true);
    expect(videoSchema.safeParse({ kind: 'upload', videoId }).success).toBe(true);
    expect(videoSchema.safeParse({ kind: 'youtube', youtubeId: 'x', start: 0 }).success).toBe(false);
    expect(videoSchema.safeParse({ kind: 'youtube', youtubeId: ID, start: -1 }).success).toBe(false);
    expect(videoSchema.safeParse({ kind: 'upload', videoId: '../secret' }).success).toBe(false);
    expect(videoSchema.safeParse({ kind: 'upload', videoId, youtubeId: ID }).success).toBe(false);
    expect(videoSchema.safeParse({ kind: 'link', url: 'https://example.test/v.mp4' }).success).toBe(false);
  });

  it('are optional on a lesson, which then has none', () => {
    expect(saveCourseLessonSchema.parse(lesson).video).toBeNull();
    expect(saveCourseLessonSchema.parse({ ...lesson, video: null }).video).toBeNull();
    expect(saveCourseLessonSchema.parse({ ...lesson, video: { kind: 'youtube', youtubeId: ID, start: 5 } }).video).toEqual({ kind: 'youtube', youtubeId: ID, start: 5 });
    expect(saveCourseLessonSchema.safeParse({ ...lesson, video: `https://youtu.be/${ID}` }).success).toBe(false);
  });
});

describe('video uploads', () => {
  it('take MP4 or WebM up to the limit, in parts small enough for Cloud Run', () => {
    expect(startVideoSchema.safeParse({ contentType: 'video/mp4', size: 1 }).success).toBe(true);
    expect(startVideoSchema.safeParse({ contentType: 'video/webm', size: VIDEO_UPLOAD.maxBytes }).success).toBe(true);
    expect(startVideoSchema.safeParse({ contentType: 'video/quicktime', size: 1 }).success).toBe(false);
    expect(startVideoSchema.safeParse({ contentType: 'video/mp4', size: VIDEO_UPLOAD.maxBytes + 1 }).success).toBe(false);
    expect(startVideoSchema.safeParse({ contentType: 'video/mp4', size: 0 }).success).toBe(false);
    expect(VIDEO_UPLOAD.partBytes).toBeLessThan(32 * 1024 ** 2);
  });

  it('count their parts and play from this server', () => {
    expect(videoParts(1)).toBe(1);
    expect(videoParts(VIDEO_UPLOAD.partBytes)).toBe(1);
    expect(videoParts(VIDEO_UPLOAD.partBytes + 1)).toBe(2);
    expect(videoParts(VIDEO_UPLOAD.maxBytes)).toBe(128);
    expect(videoSrc('abc')).toBe('/v1/public/videos/abc');
    expect(videoDownloadSrc('abc')).toBe('/v1/public/videos/abc?download=1');
  });

  it('download under the name they were uploaded with, made safe', () => {
    expect(videoFileName('Convention 2026 (final).MP4', 'video/mp4')).toBe('Convention-2026-final.mp4');
    expect(videoFileName('talk.mov', 'video/webm')).toBe('talk.webm');
    expect(videoFileName('Café.webm', 'video/webm')).toBe('Cafe.webm');
    expect(videoFileName('', 'video/mp4')).toBe('ustp-video.mp4');
    expect(videoFileName('../../etc/passwd', 'video/mp4')).toBe('etc-passwd.mp4');
    expect(videoFileName('x'.repeat(300), 'video/mp4').length).toBeLessThanOrEqual(VIDEO_UPLOAD.fileName);
  });

  it('are named once each, from any set of videos', () => {
    const a = uuidv7();
    const b = uuidv7();
    expect(uploadedVideoIds([{ kind: 'upload', videoId: a }, null, { kind: 'youtube', youtubeId: ID, start: 0 }, undefined, { kind: 'upload', videoId: b }, { kind: 'upload', videoId: a }])).toEqual([a, b]);
  });
});
