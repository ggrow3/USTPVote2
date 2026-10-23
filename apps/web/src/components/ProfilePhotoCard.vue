<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ProfilePhotoRecord } from 'ustp-domain';
import { api, ApiError, apiUpload, errorMessage } from '../api.js';
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
const chosen = ref<{ file: File; url: string } | null>(null);
const reviewing = ref(false);
const viewing = ref(false);

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

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
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
  chosen.value = { file, url };
  reviewing.value = true;
}

function drop() {
  if (chosen.value) URL.revokeObjectURL(chosen.value.url);
  chosen.value = null;
}

function chooseAnother() {
  reviewing.value = false;
  fileInput.value?.click();
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

onMounted(refresh);
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
      <q-btn
        outline
        no-caps
        color="primary"
        :loading="busy"
        :label="photo && photo.status !== 'rejected' ? 'Replace photo' : 'Upload photo'"
        @click="fileInput?.click()"
      />
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
          <q-btn flat no-caps color="primary" label="Choose another" :disable="busy" @click="chooseAnother" />
          <q-btn color="primary" no-caps label="Upload photo" :loading="busy" @click="upload" />
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
.ustp-photo-button {
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: none;
  cursor: zoom-in;
}
</style>
