<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import {
  accentProblem,
  checkHub,
  contrast,
  DEFAULT_ACCENT,
  effectiveAccent,
  guildIdProblem,
  HUB_LIMITS,
  HUB_THEMES,
  hubChanges,
  hubInitials,
  resolveHub,
  urlProblem,
  type Hub,
  type HubRecord,
} from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { hubLogoUrl, uploadHubLogo } from './api.js';
import { hubIcon } from './hub-icons.js';
import { describeHubChange, THEME_LABELS } from './hub-text.js';

/** The hub's profile, look and Discord card (design §10.6), saved together with "Save settings". */
const props = defineProps<{ saved: HubRecord; busy: boolean }>();
const emit = defineEmits<{ commit: [next: Hub, done?: () => void] }>();

type Draft = { -readonly [K in keyof Hub['profile']]: Hub['profile'][K] } & { -readonly [K in keyof Hub['discord']]: Hub['discord'][K] };
const fromSaved = (record: Hub = props.saved): Draft => ({ ...record.profile, ...record.discord });
const draft = reactive<Draft>(fromSaved());
const same = (a: Draft, b: Draft) => (Object.keys(a) as (keyof Draft)[]).every((k) => a[k] === b[k]);
/**
 * A new version (a save here, a link change, someone else's save) refreshes the form, unless it holds unsaved edits:
 * those stay, and are compared with the new version.
 */
watch(
  () => props.saved,
  (now, before) => {
    if (same(draft, fromSaved(before))) Object.assign(draft, fromSaved(now));
  },
);

/** The hub as it would be saved, tidied: the sections as saved, the profile and Discord card from the form. */
const next = computed<Hub>(() =>
  resolveHub({
    sections: props.saved.sections,
    profile: { name: draft.name, tagline: draft.tagline, bio: draft.bio, logo: draft.logo, accent: draft.accent, theme: draft.theme },
    discord: { invite: draft.invite, guildId: draft.guildId, widget: draft.widget },
  }),
);
const changes = computed(() => hubChanges(props.saved, next.value));
const refused = computed(() => {
  const check = checkHub(next.value);
  return check.ok ? null : check.reason;
});

const over = (value: string, limit: number) => (value.trim().length > limit ? `Over ${limit} characters` : undefined);
const errors = computed(() => ({
  name: next.value.profile.name ? over(draft.name, HUB_LIMITS.name) : 'The hub needs a name',
  tagline: over(draft.tagline, HUB_LIMITS.tagline),
  bio: over(draft.bio, HUB_LIMITS.bio),
  accent: accentProblem(next.value.profile.accent) ?? undefined,
  invite: (next.value.discord.invite && urlProblem(next.value.discord.invite, 'discord')) || undefined,
  guildId:
    guildIdProblem(next.value.discord.guildId) ??
    (draft.widget && !next.value.discord.guildId ? 'Needed for the live widget' : undefined),
}));

const accent = computed(() => effectiveAccent(next.value.profile));
const accentContrast = computed(() => (errors.value.accent ? null : contrast(accent.value, '#ffffff').toFixed(2)));
const themeOptions = HUB_THEMES.map((value) => ({ value, label: THEME_LABELS[value] }));

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file) return;
  uploading.value = true;
  await attempt(async () => {
    draft.logo = (await uploadHubLogo(file)).logo;
  }, 'Logo uploaded. Save settings to show it on the hub.');
  uploading.value = false;
}

/** Once saved, the form shows what was saved, tidied. */
function save() {
  emit('commit', next.value, () => void nextTick(() => Object.assign(draft, fromSaved())));
}
function discard() {
  Object.assign(draft, fromSaved());
}
</script>

<template>
  <div class="hp">
    <fieldset class="hp-group">
      <legend class="hp-legend">Profile</legend>
      <q-input
        v-model="draft.name"
        outlined
        dense
        label="Name"
        :error="!!errors.name"
        :error-message="errors.name"
      />
      <q-input v-model="draft.tagline" outlined dense label="Tagline" :error="!!errors.tagline" :error-message="errors.tagline" />
      <q-input
        v-model="draft.bio"
        outlined
        dense
        type="textarea"
        autogrow
        counter
        label="Bio"
        :hint="`A line or two under the tagline, up to ${HUB_LIMITS.bio} characters.`"
        :error="!!errors.bio"
        :error-message="errors.bio"
      />
      <div class="hp-logo">
        <div class="hp-logo__tile" aria-hidden="true">
          <img v-if="draft.logo" :src="hubLogoUrl(draft.logo)" alt="" width="64" height="64" />
          <span v-else>{{ hubInitials(draft.name) }}</span>
        </div>
        <div class="hp-logo__text">
          <div class="text-body2 text-weight-bold">Logo or avatar</div>
          <div class="text-caption text-grey-7">
            {{ draft.logo ? 'Your logo.' : "The name's initials until a logo is uploaded." }} A PNG, JPEG or WebP at least
            64 pixels square; the hub keeps it as a 256-pixel square on its own server, so visitors never load it from
            anywhere else.
          </div>
          <div class="hp-logo__buttons">
            <q-btn outline no-caps icon="upload" label="Upload a logo" :loading="uploading" @click="fileInput?.click()" />
            <q-btn v-if="draft.logo" flat no-caps label="Use the initials" @click="draft.logo = null" />
          </div>
          <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" tabindex="-1" aria-hidden="true" @change="upload" />
        </div>
      </div>
    </fieldset>

    <fieldset class="hp-group">
      <legend class="hp-legend">Look</legend>
      <div class="ustp-row">
        <q-input
          v-model="draft.accent"
          outlined
          dense
          label="Accent colour (blank = USTP orange)"
          :placeholder="DEFAULT_ACCENT"
          :hint="accentContrast ? `White text on it: ${accentContrast}:1 (4.5:1 needed)` : undefined"
          :error="!!errors.accent"
          :error-message="errors.accent"
        >
          <template #prepend>
            <input
              type="color"
              class="hp-swatch"
              :value="accent"
              aria-label="Pick the accent colour"
              @input="draft.accent = ($event.target as HTMLInputElement).value"
            />
          </template>
        </q-input>
        <q-select v-model="draft.theme" outlined dense emit-value map-options :options="themeOptions" label="Default theme" hint="Until a visitor picks one with the hub's theme button; it applies to every page." />
      </div>
    </fieldset>

    <fieldset class="hp-group">
      <legend class="hp-legend"><q-icon :name="hubIcon('discord')" size="14px" aria-hidden="true" /> Discord</legend>
      <q-input
        v-model="draft.invite"
        outlined
        dense
        inputmode="url"
        label="Invite link"
        placeholder="https://discord.gg/…"
        hint="The card shows while it has an invite."
        :error="!!errors.invite"
        :error-message="errors.invite"
      />
      <q-input
        v-model="draft.guildId"
        outlined
        dense
        inputmode="numeric"
        label="Server ID (for the live widget)"
        :error="!!errors.guildId"
        :error-message="errors.guildId"
      />
      <q-toggle v-model="draft.widget" label="Show live member widget on the hub" />
      <p class="hp-help">
        To get the Server ID: in Discord open Server Settings → Widget, turn on “Enable Server Widget”, and copy the
        Server ID shown there. The widget is the number online, which this site's server reads from Discord every few
        minutes: visitors' browsers never contact Discord.
      </p>
    </fieldset>

    <div v-if="changes.length" class="hp-changes">
      <h3 class="text-subtitle2">Not saved yet: {{ changes.length === 1 ? '1 change' : `${changes.length} changes` }}</h3>
      <ul class="q-mt-sm q-mb-none">
        <li v-for="(c, i) in changes" :key="i">{{ describeHubChange(c, () => '') }}</li>
      </ul>
    </div>
    <q-banner v-if="refused && changes.length" class="bg-orange-2 text-black" rounded>Cannot save yet: {{ refused }}.</q-banner>
    <div class="hp-actions">
      <q-btn flat no-caps color="primary" label="Discard changes" :disable="!changes.length || busy" @click="discard" />
      <q-btn unelevated no-caps color="primary" label="Save settings" :loading="busy" :disable="!changes.length || !!refused" @click="save" />
    </div>
  </div>
</template>

<style scoped>
.hp {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 860px;
}
/* A labelled group, its legend set small in mono on the border, as in the hub's section labels. */
.hp-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  margin: 0;
  padding: 16px 20px 20px;
  border: 1px solid var(--ha-line);
  border-radius: var(--signal-radius);
  background: var(--ha-card);
}
.hp-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  color: var(--ha-muted);
  font-family: var(--signal-mono);
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.hp-logo {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.hp-logo__tile {
  display: grid;
  flex: none;
  place-items: center;
  width: 64px;
  height: 64px;
  overflow: hidden;
  border: 1px solid var(--ha-line);
  border-radius: 16px;
  background: var(--ha-row);
  color: var(--ha-letters);
  font-family: var(--signal-display);
  font-size: 24px;
  font-weight: 800;
}
.hp-logo__tile img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.hp-logo__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.hp-logo__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
/* The browser's colour picker as a swatch inside the field. */
.hp-swatch {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--ha-line);
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
.hp-help {
  margin: 0;
  color: var(--ha-muted);
  font-size: 0.875rem;
}
.hp-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
</style>
