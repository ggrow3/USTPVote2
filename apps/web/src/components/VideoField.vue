<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { Notify } from 'quasar';
import { VIDEO_UPLOAD } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { fileSize, videoFileProblem, videoFromDraft } from '../video-fields.js';
import { uploadVideo } from '../video-upload.js';
import VideoPlayer from './VideoPlayer.vue';

/**
 * An editor's video (design §10.10): a YouTube link, or a file uploaded to `uploadPath` a part at a time, with a
 * preview as it will play. `busy` is true while an upload is under way, so the form can wait for it before saving.
 */
const props = defineProps<{ uploadPath: string; title: string }>();
const upload = defineModel<string | null>('upload', { required: true });
const link = defineModel<string>('link', { required: true });
const emit = defineEmits<{ busy: [busy: boolean] }>();

const preview = computed(() => videoFromDraft({ upload: upload.value, link: link.value }));
const input = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const progress = ref(0);
const problem = ref<string | null>(null);
/** The name of the file just uploaded, while the editor stays open. */
const fileName = ref<string | null>(null);
let cancelled = false;
watch(uploading, (busy) => emit('busy', busy));
// Closing the editor stops an upload, so its video never lands in the next item opened.
onUnmounted(() => (cancelled = true));

/** Uploads the chosen video; it replaces any YouTube link, and shows once the item is saved (and published). */
async function choose(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file) return;
  problem.value = videoFileProblem(file);
  if (problem.value) return;
  uploading.value = true;
  progress.value = 0;
  cancelled = false;
  let videoId: string | null = null;
  await attempt(async () => {
    videoId = await uploadVideo(props.uploadPath, file, (sent) => (progress.value = sent), () => cancelled);
  });
  uploading.value = false;
  if (!videoId || cancelled) return;
  upload.value = videoId;
  link.value = '';
  fileName.value = file.name;
  Notify.create({ type: 'positive', message: 'Video uploaded. Save to keep it.' });
}

function cancel() {
  cancelled = true;
}

function remove() {
  upload.value = null;
  link.value = '';
  fileName.value = null;
}
</script>

<template>
  <div class="video-field">
    <VideoPlayer v-if="preview" :video="preview" :title="title" />
    <div v-if="upload">
      <div class="text-body2 text-weight-medium">Uploaded video{{ fileName ? ` · ${fileName}` : '' }}</div>
      <div class="text-caption text-grey-7">Kept on this site, so people play it from here.</div>
    </div>
    <q-input
      v-else
      v-model="link"
      outlined
      dense
      label="YouTube link"
      hint="Such as https://youtu.be/… or a youtube.com/watch address; add ?t=90 to start 90 seconds in. Or upload a video instead."
    />
    <div v-if="uploading" role="status" class="row items-center q-gutter-sm">
      <q-linear-progress :value="progress" size="10px" rounded class="col" color="primary" />
      <span class="text-caption">Uploading, {{ Math.round(progress * 100) }}%</span>
      <q-btn flat dense no-caps label="Cancel" @click="cancel" />
    </div>
    <q-banner v-if="problem" class="bg-red-1 text-black" rounded role="alert">{{ problem }}</q-banner>
    <div class="row q-gutter-sm">
      <q-btn outline no-caps icon="upload" :label="upload ? 'Upload another video' : 'Upload a video'" :loading="uploading" @click="input?.click()" />
      <q-btn v-if="upload || link" flat no-caps label="Remove the video" :disable="uploading" @click="remove" />
    </div>
    <div class="text-caption text-grey-7">
      An MP4 or WebM file up to {{ fileSize(VIDEO_UPLOAD.maxBytes) }}. It is kept exactly as sent, with anything the camera stored in it,
      such as where it was filmed; export it from a video editor first to leave that out.
    </div>
    <input ref="input" type="file" accept="video/mp4,video/webm,.mp4,.m4v,.webm" class="sr-only" tabindex="-1" aria-hidden="true" @change="choose" />
  </div>
</template>

<style scoped>
.video-field { display: flex; flex-direction: column; gap: 12px; }
</style>
