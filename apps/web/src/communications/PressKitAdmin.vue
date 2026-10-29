<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  PRESS_ASSET_MAX_BYTES,
  PRESS_KIT_LIMITS,
  pressKitSchema,
  type PressAssetType,
  type PressKitRecord,
} from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { adminPressKit, pressAssetBlob, pressPage, savePressKit, uploadPressAsset } from './api.js';
import { fileSize, longDate } from './comms-text.js';

/**
 * The press kit for Communications Admins (design §10.9): the public Press page's media contact, the party's own
 * description, facts and files. Uploading a file changes nothing the public sees until the kit is saved listing it.
 * Each save is recorded in the audit ledger.
 */
interface FileInfo {
  readonly contentType: PressAssetType;
  readonly bytes: number;
  readonly width: number | null;
  readonly height: number | null;
}
interface Form {
  about: string;
  contact: { name: string; role: string; email: string; phone: string; note: string };
  facts: { label: string; value: string }[];
  assets: { id: string; title: string; description: string }[];
}

const saved = ref<PressKitRecord | null>(null);
const form = ref<Form | null>(null);
const files = ref<Record<string, FileInfo>>({});
const thumbs = ref<Record<string, string>>({});
const errors = ref<FieldErrors>({});
const uploading = ref(false);
const picker = ref<HTMLInputElement | null>(null);

const toForm = (k: PressKitRecord): Form => ({
  about: k.about,
  contact: { ...k.contact },
  facts: k.facts.map((f) => ({ ...f })),
  assets: k.assets.map((a) => ({ id: a.id, title: a.title, description: a.description })),
});
const dirty = computed(() => !!saved.value && !!form.value && JSON.stringify(toForm(saved.value)) !== JSON.stringify(form.value));

async function thumb(id: string) {
  if (thumbs.value[id] || files.value[id]?.contentType === 'application/pdf') return;
  try {
    thumbs.value[id] = URL.createObjectURL(await pressAssetBlob(id));
  } catch {
    // The row still shows its title and type.
  }
}

async function load() {
  await attempt(async () => {
    const [kit, page] = await Promise.all([adminPressKit(), pressPage()]);
    saved.value = kit;
    form.value = toForm(kit);
    for (const a of page.kit.assets) files.value[a.id] = a;
    for (const a of kit.assets) void thumb(a.id);
  });
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !form.value) return;
  uploading.value = true;
  try {
    await attempt(async () => {
      const record = await uploadPressAsset(file);
      files.value[record.id] = record;
      if (!form.value!.assets.some((a) => a.id === record.id)) {
        form.value!.assets.push({ id: record.id, title: file.name.replace(/\.[^.]*$/, '').slice(0, PRESS_KIT_LIMITS.assetTitle), description: '' });
      }
      void thumb(record.id);
    }, 'Uploaded: give it a title, then save the kit to offer it');
  } finally {
    uploading.value = false;
  }
}

function move<T>(list: T[], i: number, by: -1 | 1) {
  const j = i + by;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j]!, list[i]!];
}

async function save() {
  if (!form.value || !saved.value) return;
  const checked = validate(pressKitSchema, { ...form.value, basedOn: saved.value.version });
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  errors.value = {};
  await attempt(async () => {
    try {
      saved.value = await savePressKit(checked.data);
      form.value = toForm(saved.value);
    } catch (e) {
      errors.value = apiFieldErrors(e);
      throw e;
    }
  }, 'Press kit saved');
}

onMounted(load);
onBeforeUnmount(() => Object.values(thumbs.value).forEach((url) => URL.revokeObjectURL(url)));
</script>

<template>
  <div class="ustp-content">
    <div class="ustp-header">
      <p class="text-grey-7 q-mb-none">
        What journalists find on the public <router-link to="/press">Press page</router-link>, with the latest releases
        and the party's public bots. Saving is recorded in the audit ledger.
      </p>
      <q-btn flat no-caps color="primary" icon-right="north_east" label="View the Press page" to="/press" target="_blank" aria-label="View the Press page (opens in a new tab)" />
    </div>
    <div v-if="saved" class="text-caption text-grey-7">
      <template v-if="saved.version">Version {{ saved.version }}, saved {{ longDate(saved.updatedAt!) }}.</template>
      <template v-else>Not saved yet: the Press page says the kit is being prepared.</template>
    </div>

    <q-form v-if="form" class="ustp-form" novalidate @submit.prevent="save">
      <q-card flat bordered>
        <q-card-section class="ustp-form">
          <h2 class="text-subtitle1">Media contact</h2>
          <div class="ustp-row">
            <q-input v-model="form.contact.name" outlined dense label="Name" :maxlength="PRESS_KIT_LIMITS.contactName" />
            <q-input v-model="form.contact.role" outlined dense label="Office" placeholder="Director of Communications" :maxlength="PRESS_KIT_LIMITS.contactRole" />
          </div>
          <div class="ustp-row">
            <q-input v-model="form.contact.email" outlined dense type="email" label="Email" :error="!!errors['contact.email']" :error-message="errors['contact.email']" />
            <q-input v-model="form.contact.phone" outlined dense type="tel" label="Phone" :error="!!errors['contact.phone']" :error-message="errors['contact.phone']" />
          </div>
          <q-input v-model="form.contact.note" outlined dense label="Note (optional)" placeholder="We answer within a day." :maxlength="PRESS_KIT_LIMITS.contactNote" />
        </q-card-section>
      </q-card>

      <q-card flat bordered>
        <q-card-section class="ustp-form">
          <h2 class="text-subtitle1">About the party</h2>
          <q-input
            v-model="form.about"
            outlined
            type="textarea"
            autogrow
            aria-label="About the party"
            hint="The party in its own words, for journalists to quote. Plain text, as in news posts."
            :maxlength="PRESS_KIT_LIMITS.about"
            counter
          />
        </q-card-section>
      </q-card>

      <q-card flat bordered>
        <q-card-section class="ustp-form">
          <h2 class="text-subtitle1">Facts</h2>
          <div v-for="(f, i) in form.facts" :key="i" class="ustp-row">
            <q-input
              v-model="f.label"
              outlined
              dense
              :label="`Fact ${i + 1}`"
              placeholder="Founded"
              :maxlength="PRESS_KIT_LIMITS.factLabel"
              :error="!!errors[`facts.${i}.label`]"
              :error-message="errors[`facts.${i}.label`]"
            />
            <q-input
              v-model="f.value"
              outlined
              dense
              class="ustp-row__wide"
              label="Value"
              placeholder="2014"
              :maxlength="PRESS_KIT_LIMITS.factValue"
              :error="!!errors[`facts.${i}.value`]"
              :error-message="errors[`facts.${i}.value`]"
            />
            <q-btn flat round dense icon="close" :aria-label="`Remove fact ${i + 1}`" @click="form.facts.splice(i, 1)" />
          </div>
          <div>
            <q-btn flat no-caps icon="add" label="Add a fact" :disable="form.facts.length >= PRESS_KIT_LIMITS.facts" @click="form.facts.push({ label: '', value: '' })" />
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered>
        <q-card-section class="ustp-form">
          <h2 class="text-subtitle1">Files to download</h2>
          <div class="text-caption text-grey-7">
            Logos and photos (PNG or JPEG; stored without their metadata, at most 3000 pixels a side) and PDFs up to
            {{ Math.floor(PRESS_ASSET_MAX_BYTES / 1000) }} KB.
          </div>
          <div v-for="(a, i) in form.assets" :key="a.id" class="press-row">
            <div class="press-row__thumb">
              <img v-if="thumbs[a.id]" :src="thumbs[a.id]" alt="" />
              <q-icon v-else :name="files[a.id]?.contentType === 'application/pdf' ? 'picture_as_pdf' : 'image'" size="32px" />
            </div>
            <div class="press-row__fields">
              <q-input
                v-model="a.title"
                outlined
                dense
                label="Title"
                :maxlength="PRESS_KIT_LIMITS.assetTitle"
                :error="!!errors[`assets.${i}.title`]"
                :error-message="errors[`assets.${i}.title`]"
              />
              <q-input v-model="a.description" outlined dense label="Description (optional)" :maxlength="PRESS_KIT_LIMITS.assetDescription" />
              <div v-if="files[a.id]" class="text-caption text-grey-7">
                {{ files[a.id]!.contentType === 'application/pdf' ? 'PDF' : files[a.id]!.contentType === 'image/png' ? 'PNG' : 'JPEG' }}<template v-if="files[a.id]!.width">, {{ files[a.id]!.width }}×{{ files[a.id]!.height }}</template>, {{ fileSize(files[a.id]!.bytes) }}
              </div>
            </div>
            <div class="press-row__actions">
              <q-btn flat round dense icon="arrow_upward" :aria-label="`Move ${a.title || 'file'} up`" :disable="i === 0" @click="move(form.assets, i, -1)" />
              <q-btn flat round dense icon="arrow_downward" :aria-label="`Move ${a.title || 'file'} down`" :disable="i === form.assets.length - 1" @click="move(form.assets, i, 1)" />
              <q-btn flat round dense icon="close" :aria-label="`Remove ${a.title || 'file'}`" @click="form.assets.splice(i, 1)" />
            </div>
          </div>
          <div>
            <input ref="picker" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" class="hidden" aria-hidden="true" tabindex="-1" @change="upload" />
            <q-btn
              flat
              no-caps
              icon="upload"
              label="Upload a file"
              :loading="uploading"
              :disable="form.assets.length >= PRESS_KIT_LIMITS.assets"
              @click="picker?.click()"
            />
          </div>
        </q-card-section>
      </q-card>

      <div class="ustp-actions">
        <q-btn type="submit" unelevated no-caps color="primary" label="Save the press kit" :disable="!dirty" />
        <q-btn v-if="dirty" flat no-caps label="Undo changes" @click="form = toForm(saved!)" />
      </div>
    </q-form>
  </div>
</template>

<style scoped>
.press-row {
  display: grid;
  grid-template-columns: 64px 1fr auto;
  gap: 12px;
  align-items: start;
}
.press-row__thumb {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(127, 127, 127, 0.3);
  border-radius: 6px;
  overflow: hidden;
}
.press-row__thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.press-row__fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.press-row__actions {
  display: flex;
}
@media (max-width: 599px) {
  .press-row {
    grid-template-columns: 48px 1fr;
  }
  .press-row__actions {
    grid-column: 2;
  }
}
</style>
