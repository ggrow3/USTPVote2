import { describe, expect, it } from 'vitest';
import { VIDEO_UPLOAD } from 'ustp-domain';
import { fileSize, videoDraft, videoDraftProblem, videoFileProblem, videoFromDraft, videoType } from './video-fields.js';

const file = (name: string, type: string, size = 1000) => ({ name, type, size });
const UPLOAD = '0190a000-0000-7000-8000-000000000000';

describe('a video as an editor holds it', () => {
  it('is the upload, else the YouTube link, else none', () => {
    expect(videoFromDraft({ upload: UPLOAD, link: 'https://youtu.be/dQw4w9WgXcQ' })).toEqual({ kind: 'upload', videoId: UPLOAD });
    expect(videoFromDraft({ upload: null, link: ' https://youtu.be/dQw4w9WgXcQ?t=1m ' })).toEqual({ kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', start: 60 });
    expect(videoFromDraft({ upload: null, link: '  ' })).toBeNull();
  });

  it('comes back from a saved video, with the link at the same moment', () => {
    expect(videoDraft(null)).toEqual({ upload: null, link: '' });
    expect(videoDraft({ kind: 'upload', videoId: UPLOAD })).toEqual({ upload: UPLOAD, link: '' });
    expect(videoDraft({ kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', start: 90 })).toEqual({ upload: null, link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s' });
  });

  it('needs a link to be one YouTube video, unless there is an upload', () => {
    expect(videoDraftProblem({ upload: null, link: '' })).toBeNull();
    expect(videoDraftProblem({ upload: null, link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).toBeNull();
    expect(videoDraftProblem({ upload: null, link: 'https://vimeo.com/1' })).toBe('The video link must be the address of one YouTube video, or leave it empty.');
    expect(videoDraftProblem({ upload: UPLOAD, link: 'https://vimeo.com/1' })).toBeNull();
  });
});

describe('video files', () => {
  it('are MP4 or WebM, by the browser’s type or else the file name', () => {
    expect(videoType(file('a.mp4', 'video/mp4'))).toBe('video/mp4');
    expect(videoType(file('a.m4v', 'video/x-m4v'))).toBe('video/mp4');
    expect(videoType(file('a.webm', 'video/webm'))).toBe('video/webm');
    expect(videoType(file('a.MP4', ''))).toBe('video/mp4');
    expect(videoType(file('a.webm', ''))).toBe('video/webm');
    expect(videoType(file('a.mov', 'video/quicktime'))).toBeNull();
    expect(videoType(file('a.mp4', 'image/png'))).toBeNull();
    expect(videoType(file('a.mkv', ''))).toBeNull();
  });

  it('say in words why one cannot be uploaded', () => {
    expect(videoFileProblem(file('a.mp4', 'video/mp4'))).toBeNull();
    expect(videoFileProblem(file('a.mp4', 'video/mp4', VIDEO_UPLOAD.maxBytes))).toBeNull();
    expect(videoFileProblem(file('a.mov', 'video/quicktime'))).toMatch(/MP4 or WebM/);
    expect(videoFileProblem(file('a.mp4', 'video/mp4', 0))).toBe('That file is empty.');
    expect(videoFileProblem(file('a.mp4', 'video/mp4', VIDEO_UPLOAD.maxBytes * 1.5))).toBe('That video is 1.5 GB; the most is 1 GB.');
  });

  it('give sizes in MB, or GB from 1 GB', () => {
    expect(fileSize(1000)).toBe('1 MB');
    expect(fileSize(85 * 1024 ** 2)).toBe('85 MB');
    expect(fileSize(1023 * 1024 ** 2)).toBe('1,023 MB');
    expect(fileSize(1024 ** 3)).toBe('1 GB');
  });
});
