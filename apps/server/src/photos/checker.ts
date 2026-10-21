import { ImageAnnotatorClient } from '@google-cloud/vision';
import sharp from 'sharp';
import { isLikelihood, LIKELIHOODS, type Likelihood, type PhotoSignals } from 'ustp-domain';

/** Produces quality and SafeSearch signals for a photo. Never identifies anyone (design §5.3). */
export interface PhotoChecker {
  readonly name: 'vision' | 'local';
  check(jpeg: Buffer): Promise<PhotoSignals>;
}

export const PHOTO_CHECKER = Symbol('PhotoChecker');

/** Cloud Vision FACE_DETECTION (count, confidence, blur, exposure) and SAFE_SEARCH_DETECTION. */
export class VisionPhotoChecker implements PhotoChecker {
  readonly name = 'vision';
  private client: ImageAnnotatorClient | null = null;

  async check(jpeg: Buffer): Promise<PhotoSignals> {
    this.client ??= new ImageAnnotatorClient();
    const [result] = await this.client.annotateImage({
      image: { content: jpeg },
      features: [{ type: 'FACE_DETECTION', maxResults: 5 }, { type: 'SAFE_SEARCH_DETECTION' }],
    });
    if (result.error?.message) throw new Error(`Cloud Vision: ${result.error.message}`);
    const faces = result.faceAnnotations ?? [];
    const top = faces.reduce<(typeof faces)[number] | undefined>(
      (best, f) => ((f.detectionConfidence ?? 0) > (best?.detectionConfidence ?? -1) ? f : best),
      undefined,
    );
    const safe = result.safeSearchAnnotation ?? {};
    return {
      faceCount: faces.length,
      faceConfidence: top?.detectionConfidence ?? 0,
      blurred: likelihood(top?.blurredLikelihood),
      underExposed: likelihood(top?.underExposedLikelihood),
      adult: likelihood(safe.adult),
      violence: likelihood(safe.violence),
      racy: likelihood(safe.racy),
    };
  }
}

/**
 * Emulator-only stand-in (there is no Vision emulator): assumes one clear face and flags only dark images, so the
 * review flow can be exercised locally. The server refuses to use it outside the emulators.
 */
export class LocalPhotoChecker implements PhotoChecker {
  readonly name = 'local';
  static readonly DARK_MEAN = 40;

  async check(jpeg: Buffer): Promise<PhotoSignals> {
    const { channels } = await sharp(jpeg).stats();
    const mean = channels.slice(0, 3).reduce((sum, c) => sum + c.mean, 0) / Math.min(3, channels.length);
    return {
      faceCount: 1,
      faceConfidence: 1,
      blurred: 'VERY_UNLIKELY',
      underExposed: mean < LocalPhotoChecker.DARK_MEAN ? 'VERY_LIKELY' : 'VERY_UNLIKELY',
      adult: 'VERY_UNLIKELY',
      violence: 'VERY_UNLIKELY',
      racy: 'VERY_UNLIKELY',
    };
  }
}

/** Vision returns likelihoods as enum names or as their numbers (UNKNOWN = 0 … VERY_LIKELY = 5). */
function likelihood(value: unknown): Likelihood {
  if (isLikelihood(value)) return value;
  if (typeof value === 'number') return LIKELIHOODS[value] ?? 'UNKNOWN';
  return 'UNKNOWN';
}
