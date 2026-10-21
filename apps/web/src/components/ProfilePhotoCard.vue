<script setup lang="ts">
import { useQuasar } from 'quasar';
import { onMounted, ref } from 'vue';
import type { ProfilePhotoRecord } from 'ustp-domain';
import { api, ApiError, apiUpload, errorMessage } from '../api.js';
import { photoFileProblem, PHOTO_TYPES, STATUS_LABELS, useAuthenticatedImages } from '../photos.js';

const $q = useQuasar();
const photo = ref<ProfilePhotoRecord | null>(null);
const busy = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const { urls, load: loadImage, forget } = useAuthenticatedImages();

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
  busy.value = true;
  try {
    const saved = await apiUpload<ProfilePhotoRecord>('/v1/me/photo', file);
    await refresh();
    $q.notify(
      saved.status === 'accepted'
        ? { type: 'positive', message: 'Photo saved' }
        : { type: 'warning', message: `Saved for review by a Membership Admin (${saved.flags.join(', ')}).` },
    );
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  } finally {
    busy.value = false;
  }
}

function remove() {
  $q.dialog({ title: 'Remove photo', message: 'Remove your profile photo? The image is deleted.', cancel: true }).onOk(
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
</script>

<template>
  <q-card flat bordered>
    <q-card-section>
      <div class="text-subtitle1">Profile photo</div>
      <div class="text-caption text-grey-7">
        Optional; helps Membership Admins recognise members. Photos are checked automatically for quality, never with
        face recognition, and location and camera data are removed. Only a person can turn a photo down.
      </div>
    </q-card-section>
    <q-card-section class="row items-center q-gutter-md">
      <img
        v-if="urls.mine"
        :src="urls.mine"
        alt="Your profile photo"
        style="width: 128px; height: 128px; object-fit: cover; border-radius: 8px"
      />
      <div v-if="photo">
        <q-badge :label="STATUS_LABELS[photo.status] ?? photo.status" :color="photo.status === 'accepted' ? 'positive' : photo.status === 'rejected' ? 'negative' : 'warning'" />
        <div v-if="photo.status === 'needs_review'" class="text-caption q-mt-xs">Flagged: {{ photo.flags.join(', ') }}</div>
        <div v-if="photo.status === 'rejected'" class="text-caption q-mt-xs">
          {{ photo.decisionReason }} — please upload a new photo.
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
  </q-card>
</template>
