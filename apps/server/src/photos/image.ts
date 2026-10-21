import sharp, { type Metadata } from 'sharp';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MIN_PHOTO_SIDE = 200;
export const MAX_STORED_SIDE = 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** A problem with the uploaded file that the member can fix. */
export class PhotoInputError extends Error {}

export interface NormalizedPhoto {
  readonly jpeg: Buffer;
  readonly width: number;
  readonly height: number;
}

/**
 * Decodes an upload and re-encodes it as a bounded JPEG (design §5.3). Decoding proves it really is an image of an
 * accepted format; re-encoding drops all metadata (EXIF GPS location, camera serials, embedded thumbnails) and
 * anything else hidden in the original bytes. EXIF orientation is applied first so the photo stays upright.
 */
export async function normalizePhoto(input: Buffer): Promise<NormalizedPhoto> {
  const options = { limitInputPixels: 50_000_000, failOn: 'error' } as const;
  let meta: Metadata;
  try {
    meta = await sharp(input, options).metadata();
  } catch {
    throw new PhotoInputError('that file is not a readable image');
  }
  if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '')) throw new PhotoInputError('use a JPEG, PNG or WebP image');
  // EXIF orientations 5–8 swap width and height.
  const [w, h] = (meta.orientation ?? 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  if (Math.min(w ?? 0, h ?? 0) < MIN_PHOTO_SIDE) {
    throw new PhotoInputError(`the photo must be at least ${MIN_PHOTO_SIDE}×${MIN_PHOTO_SIDE} pixels`);
  }

  const { data, info } = await sharp(input, options)
    .rotate()
    .resize({ width: MAX_STORED_SIDE, height: MAX_STORED_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: data, width: info.width, height: info.height };
}
