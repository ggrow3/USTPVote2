import { COURSE_VIDEO, type CourseVideoType, type CourseVideoUpload } from 'ustp-domain';
import { api, ApiError, apiUpload } from '../api.js';

/** The type the api takes the file as: the browser's, or the file name's when the browser gives none (design §10.8). */
export function videoType(file: Pick<File, 'type' | 'name'>): CourseVideoType | null {
  const type = file.type.toLowerCase();
  if (type === 'video/mp4' || type === 'video/x-m4v' || (!type && /\.(mp4|m4v)$/i.test(file.name))) return 'video/mp4';
  if (type === 'video/webm' || (!type && /\.webm$/i.test(file.name))) return 'video/webm';
  return null;
}

/** What stops a file from being uploaded as a lesson video, in words, before any of it is sent; null when nothing. */
export function videoFileProblem(file: Pick<File, 'type' | 'name' | 'size'>): string | null {
  if (!videoType(file)) return 'Choose an MP4 or WebM video. Most editors and phones can save or export one.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > COURSE_VIDEO.maxBytes) return `That video is ${fileSize(file.size)}; the most is ${fileSize(COURSE_VIDEO.maxBytes)}.`;
  return null;
}

/** A file's size for people: in MB, or in GB with a decimal from 1 GB. */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${Number((bytes / 1024 ** 3).toFixed(1))} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2)).toLocaleString('en-US')} MB`;
}

/** A part is sent again after a dropped connection or a server error, up to this many times in all. */
const TRIES = 3;

/**
 * Uploads a video for the course a part at a time, saying how much is sent after each, and gives its ID once the api
 * has it all. `cancelled` is asked between parts, so Cancel stops after the part being sent.
 */
export async function uploadCourseVideo(courseId: string, file: File, progress: (fraction: number) => void, cancelled: () => boolean): Promise<string | null> {
  const contentType = videoType(file)!;
  const base = `/v1/admin/courses/${courseId}/videos`;
  let upload = await api<CourseVideoUpload>('POST', base, { contentType, size: file.size });
  const { videoId, partBytes } = upload;
  for (let index = 0; index < upload.parts; index++) {
    if (cancelled()) return null;
    const part = file.slice(index * partBytes, (index + 1) * partBytes, contentType);
    for (let attempt = 1; ; attempt++) {
      try {
        upload = await apiUpload<CourseVideoUpload>(`${base}/${videoId}/parts/${index}`, part);
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
