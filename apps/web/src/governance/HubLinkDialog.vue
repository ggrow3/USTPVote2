<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { HUB_ICONS, HUB_LIMITS, linkProblem, newHubId, urlProblem, type HubIcon, type HubLink, type HubSection } from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import VideoField from '../components/VideoField.vue';
import { videoDraft, videoDraftProblem, videoFromDraft } from '../video-fields.js';
import { HUB_VIDEO_UPLOADS } from './api.js';
import { hubIcon } from './hub-icons.js';
import { iconLabel } from './hub-text.js';

/** Adds or edits a hub link (design §10.6): its words, address or video (§10.10), icon, section, and where it shows. */
const props = defineProps<{ link: HubLink | null; section: string; sections: readonly HubSection[]; busy: boolean }>();
/** `save` gives the link and the section it goes in. */
const emit = defineEmits<{ save: [draft: { section: string; link: HubLink }]; close: [] }>();

const open = ref(true);
const form = reactive({
  section: props.section,
  title: props.link?.title ?? '',
  subtitle: props.link?.subtitle ?? '',
  url: props.link?.url ?? '',
  videoUpload: videoDraft(props.link?.video).upload,
  videoLink: videoDraft(props.link?.video).link,
  icon: (props.link?.icon ?? 'link') as HubIcon,
  shown: props.link?.shown ?? true,
  iconRow: props.link?.iconRow ?? false,
  featured: props.link?.featured ?? false,
});
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const video = computed(() => videoFromDraft({ upload: form.videoUpload, link: form.videoLink }));
/** While a video uploads, the link waits for it. */
const videoBusy = ref(false);

const sectionOptions = computed(() => props.sections.map((s) => ({ label: s.title || 'Untitled section', value: s.id })));
const iconOptions = HUB_ICONS.map((icon) => ({ label: iconLabel(icon), value: icon }));

/** Why each field cannot be saved, if it cannot; a hidden link may be left unfinished. */
const errors = computed(() => {
  const title = tidy(form.title);
  const url = tidy(form.url);
  const unfinished = form.shown ? linkProblem({ title, url, video: video.value }) : null;
  return {
    title:
      title.length > HUB_LIMITS.linkTitle
        ? `Over ${HUB_LIMITS.linkTitle} characters`
        : form.shown && !title
          ? 'Needed while the link is shown'
          : undefined,
    subtitle: tidy(form.subtitle).length > HUB_LIMITS.subtitle ? `Over ${HUB_LIMITS.subtitle} characters` : undefined,
    url: (url && urlProblem(url, 'link')) || (unfinished && !url ? 'An address or a video is needed while the link is shown' : undefined),
    video: videoDraftProblem({ upload: form.videoUpload, link: form.videoLink }) ?? undefined,
  };
});
const invalid = computed(() => Object.values(errors.value).some(Boolean));

async function save() {
  if (invalid.value || videoBusy.value) return focusFirstInvalid();
  emit('save', {
    section: form.section,
    link: {
      id: props.link?.id ?? newHubId(),
      title: tidy(form.title),
      subtitle: tidy(form.subtitle),
      url: tidy(form.url),
      video: video.value,
      icon: form.icon,
      shown: form.shown,
      iconRow: form.iconRow,
      featured: form.featured,
    },
  });
}
</script>

<template>
  <q-dialog v-model="open" persistent aria-labelledby="hub-link-dialog-title" @hide="emit('close')">
    <q-card class="ustp-dialog ustp-dialog--wide">
      <q-card-section>
        <h2 id="hub-link-dialog-title" class="text-h6">{{ link ? `Edit ${link.title || 'the link'}` : 'Add a link' }}</h2>
      </q-card-section>
      <q-card-section class="ustp-form">
        <q-input
          v-model="form.title"
          outlined
          dense
          counter
          :maxlength="HUB_LIMITS.linkTitle"
          label="Title"
          :error="!!errors.title"
          :error-message="errors.title"
        />
        <q-input
          v-model="form.subtitle"
          outlined
          dense
          label="Subtitle (optional)"
          hint="A few words under the title: “Live chat with members”."
          :error="!!errors.subtitle"
          :error-message="errors.subtitle"
        />
        <q-input
          v-model="form.url"
          outlined
          dense
          inputmode="url"
          autocomplete="url"
          label="Address"
          hint="A page of this site (/ballot), an https:// address, or mailto: for email. May be left empty for a video."
          :error="!!errors.url"
          :error-message="errors.url"
        />
        <div>
          <div class="text-body2 text-weight-medium">Video (optional)</div>
          <div class="text-caption text-grey-7">With one, choosing the link plays it on the hub instead of opening the address.</div>
        </div>
        <VideoField
          v-model:upload="form.videoUpload"
          v-model:link="form.videoLink"
          :upload-path="HUB_VIDEO_UPLOADS"
          :title="tidy(form.title) || 'this link'"
          @busy="(busy) => (videoBusy = busy)"
        />
        <q-banner v-if="errors.video" class="bg-red-1 text-black" rounded role="alert">{{ errors.video }}</q-banner>
        <div class="ustp-row">
          <q-select v-model="form.icon" outlined dense emit-value map-options :options="iconOptions" label="Icon">
            <template #prepend><q-icon :name="hubIcon(form.icon)" size="20px" /></template>
            <template #option="{ itemProps, opt }">
              <q-item v-bind="itemProps">
                <q-item-section avatar><q-icon :name="hubIcon(opt.value)" size="20px" /></q-item-section>
                <q-item-section>{{ opt.label }}</q-item-section>
              </q-item>
            </template>
          </q-select>
          <q-select v-model="form.section" outlined dense emit-value map-options :options="sectionOptions" label="Section" />
        </div>
        <q-toggle v-model="form.shown" label="Show it on the hub" />
        <q-toggle v-model="form.iconRow" label="Put its icon in the row under the profile too" />
        <q-toggle v-model="form.featured" label="Star it: drawn in the accent colour, to stand out" />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn v-close-popup flat no-caps label="Cancel" />
        <q-btn unelevated no-caps color="primary" :label="link ? 'Save the link' : 'Add the link'" :loading="busy" :disable="videoBusy" @click="save" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
