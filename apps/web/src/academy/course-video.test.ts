import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COURSE_VIDEO } from 'ustp-domain';

/** The api client, as the uploader sees it: each call answered by the test. */
const client = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(readonly status: number) {
      super(`status ${status}`);
    }
  }
  return { ApiError, api: vi.fn(), apiUpload: vi.fn() };
});
vi.mock('../api.js', () => client);

const { fileSize, uploadCourseVideo, videoFileProblem, videoType } = await import('./course-video.js');

const file = (name: string, type: string, size = 1000) => ({ name, type, size });
const PART = COURSE_VIDEO.partBytes;

describe('lesson video files', () => {
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
    expect(videoFileProblem(file('a.mp4', 'video/mp4', COURSE_VIDEO.maxBytes))).toBeNull();
    expect(videoFileProblem(file('a.mov', 'video/quicktime'))).toMatch(/MP4 or WebM/);
    expect(videoFileProblem(file('a.mp4', 'video/mp4', 0))).toBe('That file is empty.');
    expect(videoFileProblem(file('a.mp4', 'video/mp4', COURSE_VIDEO.maxBytes * 1.5))).toBe('That video is 1.5 GB; the most is 1 GB.');
  });

  it('give sizes in MB, or GB from 1 GB', () => {
    expect(fileSize(1000)).toBe('1 MB');
    expect(fileSize(85 * 1024 ** 2)).toBe('85 MB');
    expect(fileSize(1023 * 1024 ** 2)).toBe('1,023 MB');
    expect(fileSize(1024 ** 3)).toBe('1 GB');
  });
});

describe('uploading a lesson video', () => {
  const video = new File([new Uint8Array(PART * 2 + 10)], 'talk.mp4', { type: 'video/mp4' });
  const started = { videoId: 'v1', parts: 3, partBytes: PART, received: 0, ready: false };

  beforeEach(() => {
    vi.useRealTimers();
    client.api.mockReset().mockResolvedValue(started);
    client.apiUpload.mockReset().mockImplementation(async (path: string) => {
      const index = Number(path.split('/').pop());
      return { ...started, received: index + 1, ready: index === 2 };
    });
  });

  it('sends the parts in order, each a slice of the file with its type, and says how far it has got', async () => {
    const progress: number[] = [];
    expect(await uploadCourseVideo('c', video, (sent) => progress.push(sent), () => false)).toBe('v1');
    expect(client.api).toHaveBeenCalledWith('POST', '/v1/admin/courses/c/videos', { contentType: 'video/mp4', size: PART * 2 + 10 });
    const parts = client.apiUpload.mock.calls as [string, Blob][];
    expect(parts.map(([path]) => path)).toEqual([0, 1, 2].map((i) => `/v1/admin/courses/c/videos/v1/parts/${i}`));
    expect(parts.map(([, blob]) => [blob.size, blob.type])).toEqual([
      [PART, 'video/mp4'],
      [PART, 'video/mp4'],
      [10, 'video/mp4'],
    ]);
    expect(progress).toEqual([PART / video.size, (PART * 2) / video.size, 1]);
  });

  it('sends a part again after a dropped connection or a server error, but not after a refusal', async () => {
    vi.useFakeTimers();
    client.apiUpload.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new client.ApiError(503));
    const done = uploadCourseVideo('c', video, () => {}, () => false);
    await vi.runAllTimersAsync();
    expect(await done).toBe('v1');
    expect(client.apiUpload).toHaveBeenCalledTimes(5);

    client.apiUpload.mockReset().mockRejectedValue(new client.ApiError(400));
    await expect(uploadCourseVideo('c', video, () => {}, () => false)).rejects.toThrow('status 400');
    expect(client.apiUpload).toHaveBeenCalledTimes(1);
  });

  it('stops between parts when cancelled', async () => {
    let parts = 0;
    client.apiUpload.mockImplementation(async () => ({ ...started, received: ++parts }));
    expect(await uploadCourseVideo('c', video, () => {}, () => parts >= 1)).toBeNull();
    expect(client.apiUpload).toHaveBeenCalledTimes(1);
  });
});
