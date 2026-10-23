<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ProfilePhotoRecord } from 'ustp-domain';
import { api, ApiError, apiUpload, errorMessage } from '../api.js';
import { hasCamera, prefersCameraApp, useCamera } from '../camera.js';
import { dialog } from '../dialogs.js';
import { faceCheckMessage } from '../photo-check.js';
import { MIN_PHOTO_SIDE, photoFileProblem, PHOTO_TYPES, STATUS_LABELS, useAuthenticatedImages } from '../photos.js';

const $q = useQuasar();
const photo = ref<ProfilePhotoRecord | null>(null);
const busy = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const { urls, load: loadImage, forget } = useAuthenticatedImages();
const check = computed(() => (photo.value ? faceCheckMessage(photo.value) : null));
const TONE_ICONS = { passed: 'check_circle', flagged: 'error', rejected: 'cancel' } as const;
const TONE_CLASSES = { passed: 'text-positive', flagged: 'text-deep-orange-10', rejected: 'text-negative' } as const;

/** The chosen file, shown for review before it is uploaded; its object URL is revoked when it is dropped. */
const chosen = ref<{ file: File; url: string; from: 'file' | 'camera' } | null>(null);
const reviewing = ref(false);
const viewing = ref(false);

/** Taking the photo with the camera: phones use their camera app (`cameraInput`), computers a live preview. */
const canUseCamera = ref(false);
const cameraInput = ref<HTMLInputElement | null>(null);
const cameraOpen = ref(false);
const video = ref<HTMLVideoElement | null>(null);
const { stream: cameraStream, problem: cameraProblem, starting: cameraStarting, start, stop, capture } = useCamera();
watch([cameraStream, video], ([s, v]) => {
  if (v) v.srcObject = s;
});

async function refresh() {
  try {
    photo.value = await api<ProfilePhotoRecord>('GET', '/v1/me/photo');
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) $q.notify({ type: 'negative', message: errorMessage(e) });
    photo.value = null;
  }
  if (photo.value?.storagePath) await loadImage('mine', '/v1/me/photo/image');
  else forget('mine');
}

/** Width and height as the browser shows the image (EXIF orientation applied), or null if it cannot be read. */
function imageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function onFile(event: Event, from: 'file' | 'camera' = 'file') {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) await consider(file, from);
}

/** Checks what the browser can, then shows the photo for review. */
async function consider(file: File, from: 'file' | 'camera') {
  const problem = photoFileProblem(file);
  if (problem) {
    $q.notify({ type: 'negative', message: problem });
    return;
  }
  const url = URL.createObjectURL(file);
  const size = await imageSize(url);
  const tooSmall = size && Math.min(size.width, size.height) < MIN_PHOTO_SIDE;
  if (!size || tooSmall) {
    URL.revokeObjectURL(url);
    const message = size ? `The photo must be at least ${MIN_PHOTO_SIDE}×${MIN_PHOTO_SIDE} pixels.` : 'That file could not be read as an image.';
    $q.notify({ type: 'negative', message });
    return;
  }
  drop();
  chosen.value = { file, url, from };
  reviewing.value = true;
}

function takePhoto() {
  if (prefersCameraApp()) cameraInput.value?.click();
  else cameraOpen.value = true;
}

async function snap() {
  const file = video.value && (await capture(video.value));
  cameraOpen.value = false;
  if (file) await consider(file, 'camera');
  else $q.notify({ type: 'negative', message: 'The camera gave no picture. Try again.' });
}

function drop() {
  if (chosen.value) URL.revokeObjectURL(chosen.value.url);
  chosen.value = null;
}

function chooseAnother() {
  const retake = chosen.value?.from === 'camera';
  reviewing.value = false;
  if (retake) takePhoto();
  else fileInput.value?.click();
}

async function upload() {
  if (!chosen.value) return;
  busy.value = true;
  try {
    const saved = await apiUpload<ProfilePhotoRecord>('/v1/me/photo', chosen.value.file);
    reviewing.value = false;
    await refresh();
    $q.notify(
      saved.status === 'accepted'
        ? { type: 'positive', message: 'Photo saved. The automatic check passed.' }
        : { type: 'warning', message: `Photo saved for review: the automatic check found ${saved.flags.join(', ')}.` },
    );
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  } finally {
    busy.value = false;
  }
}

function remove() {
  dialog({ title: 'Remove photo', message: 'Remove your profile photo? The image is deleted.', cancel: true, focus: 'cancel' }).onOk(
    async () => {
      busy.value = true;
      try {
        await api('DELETE', '/v1/me/photo');
        await refresh();
      } catch (e) {
        $q.notify({ type: 'negative', message: errorMessage(e) });
      } finally {
        busy.value = false;
      }
    },
  );
}

onMounted(async () => {
  await refresh();
  canUseCamera.value = await hasCamera();
});
onBeforeUnmount(drop);
</script>

<template>
  <q-card flat bordered>
    <q-card-section>
      <h2 class="text-subtitle1">Profile photo</h2>
      <div class="text-caption text-grey-7">
        Optional; helps Membership Admins recognise members. Photos are checked automatically for quality, never with
        face recognition, and location and camera data are removed. Only a person can turn a photo down.
      </div>
    </q-card-section>
    <q-card-section class="row items-start q-gutter-md">
      <button v-if="urls.mine" type="button" class="ustp-photo-button" aria-label="View your photo larger" @click="viewing = true">
        <img :src="urls.mine" alt="Your profile photo" class="ustp-photo-thumb" />
      </button>
      <div v-if="photo && check" class="col" style="min-width: 220px">
        <q-badge
          :label="STATUS_LABELS[photo.status] ?? photo.status"
          :color="photo.status === 'accepted' ? 'positive' : photo.status === 'rejected' ? 'negative' : 'warning'"
          :text-color="photo.status === 'needs_review' ? 'black' : 'white'"
        />
        <div class="row no-wrap items-start q-mt-sm">
          <q-icon :name="TONE_ICONS[check.tone]" :class="TONE_CLASSES[check.tone]" size="20px" class="q-mr-sm" aria-hidden="true" />
          <div>
            <div :class="TONE_CLASSES[check.tone]">{{ check.text }}</div>
            <ul v-if="check.advice.length" class="q-my-xs q-pl-md">
              <li v-for="tip in check.advice" :key="tip">{{ tip }}</li>
            </ul>
          </div>
        </div>
      </div>
      <div v-else class="text-grey-7">No photo yet.</div>
    </q-card-section>
    <q-card-actions>
      <input ref="fileInput" type="file" :accept="PHOTO_TYPES.join(',')" hidden @change="onFile" />
      <input ref="cameraInput" type="file" :accept="PHOTO_TYPES.join(',')" capture="user" hidden @change="onFile($event, 'camera')" />
      <q-btn
        outline
        no-caps
        color="primary"
        :loading="busy"
        :label="photo && photo.status !== 'rejected' ? 'Replace photo' : 'Upload photo'"
        @click="fileInput?.click()"
      />
      <q-btn v-if="canUseCamera" outline no-caps color="primary" icon="photo_camera" label="Take photo" :disable="busy" @click="takePhoto" />
      <q-btn v-if="photo && photo.status !== 'rejected'" flat no-caps color="negative" label="Remove" :disable="busy" @click="remove" />
    </q-card-actions>

    <!-- Review before upload: the photo as chosen, as it will appear, and what the check looks for. -->
    <q-dialog v-model="reviewing" :persistent="busy" @hide="drop">
      <q-card v-if="chosen" style="width: 460px; max-width: 92vw">
        <q-card-section>
          <h2 class="text-h6 q-my-none">Review your photo</h2>
        </q-card-section>
        <q-card-section class="text-center q-pt-none">
          <img :src="chosen.url" alt="The photo you chose" class="ustp-photo-full ustp-photo-review" />
        </q-card-section>
        <q-card-section class="row no-wrap items-center q-gutter-md q-pt-none">
          <img :src="chosen.url" alt="" class="ustp-photo-thumb" />
          <div class="text-caption">How it will appear on your account and to Membership Admins.</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <div>The automatic check looks for:</div>
          <ul class="q-my-xs q-pl-md">
            <li>just you, facing the camera</li>
            <li>your face clearly visible, with nothing covering it</li>
            <li>a sharp, well-lit photo</li>
          </ul>
          <div class="text-caption text-grey-7">It only checks quality. It never identifies who is in the photo.</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat no-caps label="Cancel" :disable="busy" />
          <q-btn flat no-caps color="primary" :label="chosen.from === 'camera' ? 'Retake' : 'Choose another'" :disable="busy" @click="chooseAnother" />
          <q-btn color="primary" no-caps label="Upload photo" :loading="busy" @click="upload" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Live camera preview (computers). The camera runs only while this is open. -->
    <q-dialog v-model="cameraOpen" @show="start" @hide="stop">
      <q-card style="width: 560px; max-width: 92vw">
        <q-card-section>
          <h2 class="text-h6 q-my-none">Take a photo</h2>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <div v-if="cameraProblem" role="alert" class="text-negative">{{ cameraProblem }}</div>
          <div v-else class="ustp-camera">
            <video ref="video" autoplay playsinline muted aria-label="Camera preview"></video>
            <q-inner-loading :showing="cameraStarting" label="Starting the camera…" />
          </div>
          <div class="text-caption text-grey-7 q-mt-sm">
            Face the camera in good light. The camera is on only while this window is open, and nothing is sent until you
            review the photo and upload it.
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat no-caps label="Cancel" />
          <q-btn color="primary" no-caps icon="photo_camera" label="Take photo" :disable="!cameraStream" @click="snap" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="viewing">
      <q-card style="max-width: 92vw">
        <q-card-section class="text-center">
          <img v-if="urls.mine" :src="urls.mine" alt="Your profile photo" class="ustp-photo-full" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat no-caps label="Close" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-card>
</template>

<style scoped>
.ustp-photo-thumb {
  display: block;
  width: 128px;
  height: 128px;
  object-fit: cover;
  border-radius: 8px;
}
.ustp-photo-full {
  display: block;
  margin: 0 auto;
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
  border-radius: 8px;
}
.ustp-photo-review {
  max-height: min(36vh, 320px);
}
.ustp-camera {
  position: relative;
  min-height: 200px;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}
/* Mirrored, as people expect to see themselves; the photo taken is not. */
.ustp-camera video {
  display: block;
  width: 100%;
  max-height: 50vh;
  object-fit: contain;
  transform: scaleX(-1);
}
.ustp-photo-button {
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: none;
  cursor: zoom-in;
}
</style>
