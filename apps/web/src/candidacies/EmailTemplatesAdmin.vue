<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  DEFAULT_EMAIL_TEMPLATES,
  DEFAULT_OFFICE_TITLES,
  EMAIL_PLACEHOLDERS,
  EMAIL_TEMPLATE_LIMITS,
  emailTemplateSchema,
  fillTemplate,
  placeholderValues,
  PUBLIC_OFFICES,
  type EmailPlaceholder,
  type EmailTemplate,
  type PublicOffice,
} from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { emailTemplates, saveEmailTemplate } from './api.js';
import { OFFICE_HEADINGS } from './candidacy-text.js';

/**
 * The emails members send from the Your area page (design §5.12), one per kind of office, for Communications Admins.
 * The page fills in the placeholders for each person; members can change the text before they send it from their own
 * email app. Every save is ledgered.
 */
const templates = ref<EmailTemplate[] | null>(null);
const office = ref<PublicOffice>('us_house');
const subject = ref('');
const body = ref('');
const errors = ref<FieldErrors>({});

const PLACEHOLDER_HELP: Readonly<Record<EmailPlaceholder, string>> = {
  name: 'the person written to',
  office: 'their office, e.g. U.S. Representative',
  district: 'where, e.g. Congressional District 49, California',
  asRole: '“as my U.S. Representative” or “as a candidate for U.S. Representative”',
  myName: 'the member’s own name',
};

/** A placeholder as written in a template, `{name}`. */
const braced = (p: EmailPlaceholder) => `{${p}}`;
const officeOptions = PUBLIC_OFFICES.map((value) => ({ value, label: OFFICE_HEADINGS[value] }));
const shown = computed(() => templates.value?.find((t) => t.office === office.value) ?? null);
const changed = computed(() => !!shown.value && (subject.value !== shown.value.subject || body.value !== shown.value.body));

/** The template filled in for a made-up member writing to their representative. */
const preview = computed(() => {
  const values = placeholderValues({ name: 'Alex Example', officeTitle: DEFAULT_OFFICE_TITLES[office.value], role: 'holder' }, 'Congressional District 49, California', 'Ada Brooks');
  return { subject: fillTemplate(subject.value, values), body: fillTemplate(body.value, values) };
});

function show() {
  subject.value = shown.value?.subject ?? '';
  body.value = shown.value?.body ?? '';
  errors.value = {};
}
watch(office, show);

async function load() {
  await attempt(async () => {
    templates.value = await emailTemplates();
    show();
  });
}

function useStartingText() {
  subject.value = DEFAULT_EMAIL_TEMPLATES[office.value].subject;
  body.value = DEFAULT_EMAIL_TEMPLATES[office.value].body;
}

async function save() {
  const template = shown.value;
  if (!template) return;
  const checked = validate(emailTemplateSchema, { subject: subject.value, body: body.value, basedOn: template.version });
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  const ok = await attempt(async () => {
    try {
      const saved = await saveEmailTemplate(office.value, checked.data);
      templates.value = (templates.value ?? []).map((t) => (t.office === saved.office ? saved : t));
    } catch (err) {
      errors.value = apiFieldErrors(err);
      throw err;
    }
  }, 'Saved');
  if (ok) show();
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <p class="text-grey-7">
      The emails members can send from the Your area page, one for each kind of office. The page fills in the words in
      braces for each person; members can change the text before they send it from their own email app.
    </p>
    <q-select v-model="office" outlined dense emit-value map-options :options="officeOptions" label="Office" class="templates-office" />
    <div v-if="shown" class="text-caption text-grey-7">
      {{ shown.version === 0 ? 'The starting text: not changed yet.' : `Version ${shown.version}.` }}
    </div>
    <q-form v-if="shown" class="ustp-form" novalidate @submit.prevent="save">
      <q-input
        v-model="subject"
        outlined
        dense
        label="Subject"
        :maxlength="EMAIL_TEMPLATE_LIMITS.subject"
        :error="!!errors.subject"
        :error-message="errors.subject"
      />
      <q-input
        v-model="body"
        outlined
        type="textarea"
        autogrow
        label="Email"
        :maxlength="EMAIL_TEMPLATE_LIMITS.body"
        :error="!!errors.body"
        :error-message="errors.body"
      />
      <div class="text-caption text-grey-7">
        Words in braces:
        <span v-for="p in EMAIL_PLACEHOLDERS" :key="p" class="templates-placeholder"><code v-text="braced(p)" /> {{ PLACEHOLDER_HELP[p] }}</span>
      </div>
      <div class="ustp-actions">
        <q-btn type="submit" unelevated no-caps color="primary" label="Save" :disable="!changed" />
        <q-btn flat no-caps label="Use the starting text" @click="useStartingText" />
        <q-btn v-if="changed" flat no-caps label="Undo changes" @click="show" />
      </div>
    </q-form>
    <q-card v-if="shown" flat bordered>
      <q-card-section>
        <h2 class="text-subtitle2 q-my-none">Preview</h2>
        <div class="text-caption text-grey-7">Ada Brooks writing to their representative, Alex Example.</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <div class="text-weight-medium">{{ preview.subject }}</div>
        <div class="templates-preview">{{ preview.body }}</div>
      </q-card-section>
    </q-card>
  </div>
</template>

<style scoped>
.templates-office {
  max-width: 320px;
}
.templates-placeholder {
  display: block;
}
.templates-preview {
  white-space: pre-wrap;
  margin-top: 8px;
}
</style>
