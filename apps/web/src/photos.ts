import { onBeforeUnmount, ref } from 'vue';
import { apiBlob } from './api.js';

/** Must match the server (apps/server/src/photos/image.ts). */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MIN_PHOTO_SIDE = 200;

/** Problems the browser can spot before uploading; the server checks everything again. */
export function photoFileProblem(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return 'Use a JPEG, PNG or WebP image.';
  if (file.size > MAX_PHOTO_BYTES) return 'The photo must be 5 MB or smaller.';
  return null;
}

export const STATUS_LABELS: Record<string, string> = {
  accepted: 'Accepted',
  needs_review: 'Waiting for review',
  rejected: 'Not accepted',
};

/** Object URLs for authenticated images, revoked when the component unmounts. */
export function useAuthenticatedImages() {
  const urls = ref<Record<string, string>>({});

  async function load(key: string, path: string): Promise<void> {
    try {
      const url = URL.createObjectURL(await apiBlob(path));
      const previous = urls.value[key];
      urls.value = { ...urls.value, [key]: url };
      if (previous) URL.revokeObjectURL(previous);
    } catch {
      forget(key);
    }
  }

  function forget(key: string): void {
    const previous = urls.value[key];
    if (!previous) return;
    URL.revokeObjectURL(previous);
    const { [key]: _removed, ...rest } = urls.value;
    urls.value = rest;
  }

  onBeforeUnmount(() => Object.values(urls.value).forEach((u) => URL.revokeObjectURL(u)));
  return { urls, load, forget };
}
