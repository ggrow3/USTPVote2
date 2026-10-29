import { BadRequestException } from '@nestjs/common';
import sharp, { type Metadata } from 'sharp';
import { COURSE_IMAGE } from 'ustp-domain';

/** A Firestore document holds at most 1 MiB, and the image shares it with a few small fields. */
const MAX_STORED_BYTES = 900_000;

export interface NormalizedPortrait {
  readonly image: Buffer;
  readonly width: number;
  readonly height: number;
}

/**
 * Decodes an uploaded portrait and re-encodes it as a WebP at most COURSE_IMAGE.maxSide on its long side: decoding
 * proves it is an image, and re-encoding drops its metadata (EXIF location, camera serials) and anything else hidden in
 * the bytes, as for profile photos and the hub's logo. EXIF orientation is applied first so the photo stays upright.
 */
export async function normalizePortrait(input: Buffer): Promise<NormalizedPortrait> {
  const options = { limitInputPixels: 50_000_000, failOn: 'error' } as const;
  let meta: Metadata;
  try {
    meta = await sharp(input, options).metadata();
  } catch {
    throw new BadRequestException('that file is not a readable image');
  }
  if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '')) throw new BadRequestException('use a JPEG, PNG or WebP image');
  // EXIF orientations 5–8 swap width and height.
  const [w, h] = (meta.orientation ?? 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  if (Math.min(w ?? 0, h ?? 0) < COURSE_IMAGE.minSide) {
    throw new BadRequestException(`the photo must be at least ${COURSE_IMAGE.minSide}×${COURSE_IMAGE.minSide} pixels`);
  }
  const { data, info } = await sharp(input, options)
    .rotate()
    .resize({ width: COURSE_IMAGE.maxSide, height: COURSE_IMAGE.maxSide, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  if (data.length > MAX_STORED_BYTES) throw new BadRequestException('that photo is too detailed to store; try a simpler or smaller one');
  return { image: data, width: info.width, height: info.height };
}
