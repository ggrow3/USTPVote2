import { HUB_IMAGE_NAMES, hubImageProblem, type HubImageKind } from 'ustp-domain';

/** Must match the server, which takes these types and no larger body for any upload (apps/server/src/photos/image.ts). */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** An image's width and height as shown, upright. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** The image's size as the browser draws it (turned upright by its EXIF orientation), or null if it cannot tell. */
async function measure(file: Blob): Promise<ImageSize | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

const sentence = (text: string) => `${text[0]!.toUpperCase()}${text.slice(1)}.`;

/**
 * Problems the browser can spot before uploading a logo, cover banner or background photo (design §10.6), so a 5 MB
 * upload is not sent only to be refused; the server checks everything again.
 */
export async function hubImageFileProblem(kind: HubImageKind, file: File, size = measure): Promise<string | null> {
  if (!IMAGE_TYPES.includes(file.type)) return 'Use a PNG, JPEG or WebP image.';
  if (file.size > MAX_IMAGE_BYTES) return `The ${HUB_IMAGE_NAMES[kind]} must be 5 MB or smaller.`;
  const measured = await size(file);
  const problem = measured && hubImageProblem(kind, measured.width, measured.height);
  return problem ? sentence(problem) : null;
}
