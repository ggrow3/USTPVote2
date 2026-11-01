import type { VideoUpload } from 'ustp-domain';
import { api, ApiError, apiUpload } from './api.js';
import { videoType } from './video-fields.js';

/** A part is sent again after a dropped connection or a server error, up to this many times in all. */
const TRIES = 3;

/**
 * Uploads a video a part at a time to `base`, the area's upload address (design §10.10), saying how much is sent after
 * each, and gives its ID once the api has it all. `cancelled` is asked between parts, so Cancel stops after the part
 * being sent.
 */
export async function uploadVideo(base: string, file: File, progress: (fraction: number) => void, cancelled: () => boolean): Promise<string | null> {
  const contentType = videoType(file)!;
  let upload = await api<VideoUpload>('POST', base, { contentType, size: file.size, fileName: file.name });
  const { videoId, partBytes } = upload;
  for (let index = 0; index < upload.parts; index++) {
    if (cancelled()) return null;
    const part = file.slice(index * partBytes, (index + 1) * partBytes, contentType);
    for (let attempt = 1; ; attempt++) {
      try {
        upload = await apiUpload<VideoUpload>(`${base}/${videoId}/parts/${index}`, part);
        break;
      } catch (error) {
        const lasting = error instanceof ApiError && error.status < 500;
        if (lasting || attempt >= TRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
    progress(Math.min(file.size, (index + 1) * partBytes) / file.size);
  }
  if (!upload.ready) throw new Error('The upload did not finish. Try again.');
  return videoId;
}
