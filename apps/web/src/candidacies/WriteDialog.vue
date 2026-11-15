<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { fillTemplate, placeholderValues, templatesFor, type AreaContact, type EmailTemplate } from 'ustp-domain';
import { confirmAction } from '../communications/admin-forms.js';
import { attempt } from '../dialogs.js';
import { BLANK_EMAIL, districtText, mailtoLink } from './candidacy-text.js';

/**
 * The email someone writes to a person on the Your area and Representatives pages (design §5.12, §5.19): they pick one
 * of the templates that suit the person, which the dialog fills in, change the text as they like and send it from
 * their own email app. Where no email address is listed, they copy the text into the person's contact form. The site
 * sends nothing and keeps no copy.
 */
const props = defineProps<{
  /** Whom the email is to; null while the dialog is closed. */
  modelValue: AreaContact | null;
  templates: readonly EmailTemplate[];
  /** The writer's name, for `{myName}`. */
  myName: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [contact: AreaContact | null] }>();

/** The template list's choice that starts from a blank email: no template ID is empty. */
const BLANK = '';

/** The templates that suit the person, the one chosen, the text as it filled in, and the text as edited. */
const writing = ref<{
  contact: AreaContact;
  offered: EmailTemplate[];
  templateId: string;
  filled: { subject: string; body: string };
  subject: string;
  body: string;
} | null>(null);

/** The text of a template (or the blank email) filled in for the person. */
function filledFor(contact: AreaContact, template: Pick<EmailTemplate, 'subject' | 'body'>) {
  const values = placeholderValues(contact, districtText(contact), props.myName);
  return { subject: fillTemplate(template.subject, values), body: fillTemplate(template.body, values) };
}

watch(
  () => props.modelValue,
  (contact) => {
    if (!contact) {
      writing.value = null;
      return;
    }
    const offered = templatesFor(props.templates, contact);
    const first = offered[0];
    const filled = filledFor(contact, first ?? BLANK_EMAIL);
    writing.value = { contact, offered, templateId: first?.templateId ?? BLANK, filled, ...filled };
  },
  { immediate: true },
);

const open = computed({
  get: () => writing.value !== null,
  set: (v) => {
    if (!v) emit('update:modelValue', null);
  },
});

const templateOptions = computed(() => [...(writing.value?.offered ?? []).map((t) => ({ value: t.templateId, label: t.name })), { value: BLANK, label: 'Blank email' }]);

/** Fills in another template; text the writer changed is replaced only once they say so. */
async function choose(templateId: string) {
  const w = writing.value;
  if (!w || templateId === w.templateId) return;
  const edited = w.subject !== w.filled.subject || w.body !== w.filled.body;
  if (edited && !(await confirmAction('Replace your changes?', 'The email you changed is replaced by the template you chose.', 'Replace'))) return;
  const filled = filledFor(w.contact, w.offered.find((t) => t.templateId === templateId) ?? BLANK_EMAIL);
  writing.value = { ...w, templateId, filled, ...filled };
}

async function copy() {
  const w = writing.value;
  if (!w) return;
  const to = w.contact.email ? `To: ${w.contact.email}\n` : '';
  await attempt(() => navigator.clipboard.writeText(`${to}Subject: ${w.subject}\n\n${w.body}`), 'Copied');
}
</script>

<template>
  <q-dialog v-model="open">
    <q-card v-if="writing" class="area-email">
      <q-card-section>
        <h2 class="text-h6 q-my-none">Write to {{ writing.contact.name }}</h2>
        <div class="text-grey-7">{{ writing.contact.officeTitle }} · {{ districtText(writing.contact) }}</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <div v-if="writing.contact.email" class="q-mb-sm">To: {{ writing.contact.email }}</div>
        <q-banner v-else dense rounded class="bg-grey-3 text-black q-mb-sm">
          No email address is listed for {{ writing.contact.name }}.
          <template v-if="writing.contact.contactUrl">Copy the text and paste it into their contact form.</template>
          <template v-else>Copy the text and send it through their website or office.</template>
        </q-banner>
        <q-select
          :model-value="writing.templateId"
          outlined
          dense
          emit-value
          map-options
          :options="templateOptions"
          label="Template"
          class="q-mb-sm"
          @update:model-value="choose"
        />
        <q-input v-model="writing.subject" outlined dense label="Subject" class="q-mb-sm" />
        <q-input v-model="writing.body" outlined type="textarea" autogrow label="Email" input-class="area-email-body" />
      </q-card-section>
      <q-card-actions align="left" class="q-px-md q-pb-md">
        <q-btn
          v-if="writing.contact.email"
          unelevated
          no-caps
          color="primary"
          icon="send"
          label="Open in my email app"
          :href="mailtoLink(writing.contact.email, writing.subject, writing.body)"
        />
        <q-btn outline no-caps color="primary" icon="content_copy" label="Copy text" @click="copy" />
        <q-btn
          v-if="writing.contact.contactUrl"
          flat
          no-caps
          color="primary"
          icon="open_in_new"
          label="Open their contact form"
          :href="writing.contact.contactUrl"
          target="_blank"
          rel="noopener noreferrer"
        />
        <q-btn v-close-popup flat no-caps label="Close" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.area-email {
  width: 640px;
  max-width: 100%;
}
:deep(.area-email-body) {
  min-height: 12em;
}
</style>
