import { onBeforeUnmount, ref, shallowRef } from 'vue';

/**
 * Taking a profile photo with the device's camera (design §5.3). Phones and tablets open their own camera app through
 * a file input with `capture`; computers get a live preview from getUserMedia. Either way the result goes through the
 * same review as an uploaded file, and nothing is sent until the member uploads it.
 */

/** Touch devices, whose camera apps do this better than a preview in the page. */
export function prefersCameraApp(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/** Whether to offer the camera at all. Device kinds are listed without permission; only their names need it. */
export async function hasCamera(): Promise<boolean> {
  if (prefersCameraApp()) return true;
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia || !devices.enumerateDevices) return false;
  try {
    return (await devices.enumerateDevices()).some((d) => d.kind === 'videoinput');
  } catch {
    return false;
  }
}

/** Why getUserMedia failed, in words that say what to do. */
export function cameraProblem(error: unknown): string {
  switch ((error as { name?: unknown } | null)?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access is blocked. Allow the camera for this site in your browser settings, or upload a photo instead.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found. Upload a photo instead.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is busy, perhaps in another app. Close that app and try again.';
    default:
      return 'The camera could not be started. Upload a photo instead.';
  }
}

/** A live front-camera stream, stopped by `stop()` and when the component unmounts. */
export function useCamera() {
  const stream = shallowRef<MediaStream | null>(null);
  const problem = ref<string | null>(null);
  const starting = ref(false);
  // Each start or stop bumps this, so a stream that arrives after the camera was closed is stopped at once.
  let generation = 0;

  async function start(): Promise<void> {
    stop();
    const mine = ++generation;
    problem.value = null;
    starting.value = true;
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      if (mine === generation) stream.value = media;
      else media.getTracks().forEach((t) => t.stop());
    } catch (e) {
      if (mine === generation) problem.value = cameraProblem(e);
    } finally {
      if (mine === generation) starting.value = false;
    }
  }

  function stop(): void {
    generation++;
    stream.value?.getTracks().forEach((t) => t.stop());
    stream.value = null;
    starting.value = false;
  }

  /** The frame the video shows now, as a JPEG, the right way round (the preview is mirrored, the photo is not). */
  async function capture(video: HTMLVideoElement): Promise<File | null> {
    if (!video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    return blob && new File([blob], 'camera.jpg', { type: 'image/jpeg' });
  }

  onBeforeUnmount(stop);
  return { stream, problem, starting, start, stop, capture };
}
