<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { HUB_ICONS, HUB_LIMITS, linkProblem, newHubId, urlProblem, type HubIcon, type HubLink, type HubSection } from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { hubIcon } from './hub-icons.js';
import { iconLabel } from './hub-text.js';

/** Adds or edits a hub link (design §10.6): its words, address, icon, section, and where it shows. */
const props = defineProps<{ link: HubLink | null; section: string; sections: readonly HubSection[]; busy: boolean }>();
/** `save` gives the link and the section it goes in. */
const emit = defineEmits<{ save: [draft: { section: string; link: HubLink }]; close: [] }>();

const open = ref(true);
const form = reactive({
  section: props.section,
  title: props.link?.title ?? '',
  subtitle: props.link?.subtitle ?? '',
  url: props.link?.url ?? '',
  icon: (props.link?.icon ?? 'link') as HubIcon,
  shown: props.link?.shown ?? true,
  iconRow: props.link?.iconRow ?? false,
  featured: props.link?.featured ?? false,
});
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

const sectionOptions = computed(() => props.sections.map((s) => ({ label: s.title || 'Untitled section', value: s.id })));
const iconOptions = HUB_ICONS.map((icon) => ({ label: iconLabel(icon), value: icon }));

/** Why each field cannot be saved, if it cannot; a hidden link may be left unfinished. */
const errors = computed(() => {
  const title = tidy(form.title);
  const url = tidy(form.url);
  const unfinished = form.shown ? linkProblem({ title, url }) : null;
  return {
    title:
      title.length > HUB_LIMITS.linkTitle
        ? `Over ${HUB_LIMITS.linkTitle} characters`
        : form.shown && !title
          ? 'Needed while the link is shown'
          : undefined,
    subtitle: tidy(form.subtitle).length > HUB_LIMITS.subtitle ? `Over ${HUB_LIMITS.subtitle} characters` : undefined,
    url: (url && urlProblem(url, 'link')) || (unfinished && !url ? 'Needed while the link is shown' : undefined),
  };
});
const invalid = computed(() => Object.values(errors.value).some(Boolean));

async function save() {
  if (invalid.value) return focusFirstInvalid();
  emit('save', {
    section: form.section,
    link: {
      id: props.link?.id ?? newHubId(),
      title: tidy(form.title),
      subtitle: tidy(form.subtitle),
      url: tidy(form.url),
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
          hint="A page of this site (/ballot), an https:// address, or mailto: for email."
          :error="!!errors.url"
          :error-message="errors.url"
        />
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
        <q-btn unelevated no-caps color="primary" :label="link ? 'Save the link' : 'Add the link'" :loading="busy" @click="save" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
