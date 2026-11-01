import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VIDEO_UPLOAD } from 'ustp-domain';

/** The api client, as the uploader sees it: each call answered by the test. */
const client = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(readonly status: number) {
      super(`status ${status}`);
    }
  }
  return { ApiError, api: vi.fn(), apiUpload: vi.fn() };
});
vi.mock('./api.js', () => client);

const { uploadVideo } = await import('./video-upload.js');

const PART = VIDEO_UPLOAD.partBytes;

describe('uploading a video', () => {
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
    expect(await uploadVideo('/v1/admin/courses/c/videos', video, (sent) => progress.push(sent), () => false)).toBe('v1');
    expect(client.api).toHaveBeenCalledWith('POST', '/v1/admin/courses/c/videos', { contentType: 'video/mp4', size: PART * 2 + 10, fileName: 'talk.mp4' });
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
    const done = uploadVideo('/v1/admin/courses/c/videos', video, () => {}, () => false);
    await vi.runAllTimersAsync();
    expect(await done).toBe('v1');
    expect(client.apiUpload).toHaveBeenCalledTimes(5);

    client.apiUpload.mockReset().mockRejectedValue(new client.ApiError(400));
    await expect(uploadVideo('/v1/admin/courses/c/videos', video, () => {}, () => false)).rejects.toThrow('status 400');
    expect(client.apiUpload).toHaveBeenCalledTimes(1);
  });

  it('stops between parts when cancelled', async () => {
    let parts = 0;
    client.apiUpload.mockImplementation(async () => ({ ...started, received: ++parts }));
    expect(await uploadVideo('/v1/admin/courses/c/videos', video, () => {}, () => parts >= 1)).toBeNull();
    expect(client.apiUpload).toHaveBeenCalledTimes(1);
  });
});
