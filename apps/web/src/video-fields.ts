import { VIDEO_UPLOAD, youtubeVideo, youtubeWatchUrl, type Video, type VideoType } from 'ustp-domain';

/** A video as an editor holds it (design §10.10): an upload's ID, or the YouTube link as typed. */
export interface VideoDraft {
  readonly upload: string | null;
  readonly link: string;
}

export const videoDraft = (video: Video | null | undefined): VideoDraft => ({
  upload: video?.kind === 'upload' ? video.videoId : null,
  link: video?.kind === 'youtube' ? youtubeWatchUrl(video) : '',
});

/** The video as the api takes it: the upload, else the YouTube video the link points to, else none. */
export function videoFromDraft({ upload, link }: VideoDraft): Video | null {
  if (upload) return { kind: 'upload', videoId: upload };
  return link.trim() ? youtubeVideo(link) : null;
}

/** What stops the video from being saved, in words: a link that is not one YouTube video. */
export function videoDraftProblem({ upload, link }: VideoDraft): string | null {
  return !upload && link.trim() && !youtubeVideo(link) ? 'The video link must be the address of one YouTube video, or leave it empty.' : null;
}

/** The type the api takes the file as: the browser's, or the file name's when the browser gives none. */
export function videoType(file: Pick<File, 'type' | 'name'>): VideoType | null {
  const type = file.type.toLowerCase();
  if (type === 'video/mp4' || type === 'video/x-m4v' || (!type && /\.(mp4|m4v)$/i.test(file.name))) return 'video/mp4';
  if (type === 'video/webm' || (!type && /\.webm$/i.test(file.name))) return 'video/webm';
  return null;
}

/** What stops a file from being uploaded as a video, in words, before any of it is sent; null when nothing. */
export function videoFileProblem(file: Pick<File, 'type' | 'name' | 'size'>): string | null {
  if (!videoType(file)) return 'Choose an MP4 or WebM video. Most editors and phones can save or export one.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > VIDEO_UPLOAD.maxBytes) return `That video is ${fileSize(file.size)}; the most is ${fileSize(VIDEO_UPLOAD.maxBytes)}.`;
  return null;
}

/** A file's size for people: in MB, or in GB with a decimal from 1 GB. */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${Number((bytes / 1024 ** 3).toFixed(1))} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2)).toLocaleString('en-US')} MB`;
}
