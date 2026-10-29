<script setup lang="ts">
import { ref } from 'vue';
import type { HubImageKind } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { uploadHubImage } from './api.js';
import { hubImageFileProblem } from './hub-images.js';

/**
 * One of the hub's images in its settings (design §10.6): a preview, what to upload, and buttons to upload one and to
 * go without. Uploading only gives the image an ID for the form; visitors see it once the settings are saved.
 */
const props = defineProps<{
  kind: HubImageKind;
  title: string;
  uploadLabel: string;
  /** The button that sets it back to none (the initials, no banner, the sunrise). */
  removeLabel: string;
  /** Said once it is uploaded. */
  uploaded: string;
  /** A wide preview (banner, background), set above the text on phones. */
  wide?: boolean;
}>();
const image = defineModel<string | null>({ required: true });

const input = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

async function upload(event: Event) {
  const field = event.target as HTMLInputElement;
  const file = field.files?.[0];
  field.value = '';
  if (!file) return;
  uploading.value = true;
  await attempt(async () => {
    const problem = await hubImageFileProblem(props.kind, file);
    if (problem) throw new Error(problem);
    image.value = await uploadHubImage(props.kind, file);
  }, props.uploaded);
  uploading.value = false;
}
</script>

<template>
  <div class="hi" :class="{ 'hi--wide': wide }">
    <div class="hi__preview" aria-hidden="true"><slot name="preview" /></div>
    <div class="hi__text">
      <div class="text-body2 text-weight-bold">{{ title }}</div>
      <div class="text-caption text-grey-7"><slot /></div>
      <div class="hi__buttons">
        <q-btn outline no-caps icon="upload" :label="uploadLabel" :loading="uploading" @click="input?.click()" />
        <q-btn v-if="image" flat no-caps :label="removeLabel" @click="image = null" />
      </div>
      <input ref="input" type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" tabindex="-1" aria-hidden="true" @change="upload" />
    </div>
  </div>
</template>

<style scoped>
.hi {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.hi__preview {
  flex: none;
  overflow: hidden;
  border: 1px solid var(--ha-line);
  border-radius: 16px;
  background: var(--ha-row);
}
.hi--wide .hi__preview {
  border-radius: 10px;
}
/* A wide preview goes above its text where the two do not fit side by side. */
@media (max-width: 599.98px) {
  .hi--wide {
    flex-direction: column;
  }
}
.hi__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.hi__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
</style>
