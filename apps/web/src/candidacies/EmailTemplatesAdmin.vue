<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  DEFAULT_OFFICE_TITLES,
  EMAIL_PLACEHOLDERS,
  EMAIL_TEMPLATE_LIMITS,
  emailTemplateInputSchema,
  fillTemplate,
  placeholderValues,
  PUBLIC_OFFICES,
  TEMPLATE_AUDIENCES,
  TEMPLATE_CHANNELS,
  type EmailPlaceholder,
  type EmailTemplate,
  type EmailTemplateInput,
  type TemplateChannel,
} from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { errorMessage } from '../api.js';
import { confirmAction } from '../communications/admin-forms.js';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { addEmailTemplate, changeEmailTemplate, emailTemplates, removeEmailTemplate } from './api.js';
import { AUDIENCE_TEXT, BLANK_EMAIL, OFFICE_HEADINGS, templateSuitsText } from './candidacy-text.js';

/**
 * The emails members send from the Your area page (design §5.12): a list that Membership Admins (Admin › Candidacies)
 * and Communications Admins (Admin › Communications) both keep. In the Write dialog a member picks one of those that
 * suit the person; the page fills in the words in braces, and the member can change the text before sending it from
 * their own email app. The list also holds the Representatives page's call scripts (design §5.19): what a member reads
 * out when they call a representative's office. Every add, change and removal is ledgered.
 */
const templates = ref<EmailTemplate[] | null>(null);
const error = ref<string | null>(null);
const editing = ref(false);
/** The template being edited; null for a new one. */
const current = ref<EmailTemplate | null>(null);
const form = reactive<EmailTemplateInput>({ channel: 'email', name: '', offices: [], audience: 'anyone', subject: '', body: '' });

const CHANNEL_TEXT: Readonly<Record<TemplateChannel, string>> = { email: 'Email', call: 'Call script' };
const channelOptions = TEMPLATE_CHANNELS.map((value) => ({ value, label: CHANNEL_TEXT[value] }));
/** What a call script starts from: who is calling, from where. */
const BLANK_CALL = 'Hello, my name is {myName}. I live in {district}, and I am calling {name} {asRole}.\n\n';
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
const audienceOptions = TEMPLATE_AUDIENCES.map((value) => ({ value, label: AUDIENCE_TEXT[value] }));

/** The template filled in for a made-up member writing to someone it suits. */
const preview = computed(() => {
  const office = form.offices[0] ?? 'us_house';
  const role = form.audience === 'candidate' ? 'candidate' : 'holder';
  const person = { name: 'Alex Example', officeTitle: DEFAULT_OFFICE_TITLES[office], role } as const;
  const values = placeholderValues(person, 'Congressional District 49, California', 'Ada Brooks');
  return {
    caption: `Ada Brooks ${form.channel === 'call' ? 'calling' : 'writing to'} Alex Example, ${role === 'holder' ? 'their' : 'a candidate for'} ${person.officeTitle}.`,
    subject: fillTemplate(form.subject, values),
    body: fillTemplate(form.body, values),
  };
});

async function load() {
  try {
    templates.value = await emailTemplates();
    error.value = null;
  } catch (e) {
    error.value = errorMessage(e);
  }
}
onMounted(load);

function edit(template: EmailTemplate | null, channel: TemplateChannel = 'email') {
  current.value = template;
  const blank =
    channel === 'call'
      ? { channel, name: '', offices: [], audience: 'holder' as const, subject: '', body: BLANK_CALL }
      : { channel, name: '', offices: [], audience: 'anyone' as const, ...BLANK_EMAIL };
  const { name, offices, audience, subject, body } = template ?? blank;
  Object.assign(form, { channel: template?.channel ?? channel, name, offices: [...offices], audience, subject, body });
  errors.value = {};
  editing.value = true;
}

async function save() {
  const checked = validate(emailTemplateInputSchema, { ...form, offices: [...form.offices] });
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  const template = current.value;
  const ok = await attempt(async () => {
    try {
      if (template) await changeEmailTemplate(template.templateId, checked.data, template.version);
      else await addEmailTemplate(checked.data);
    } catch (err) {
      // A change's fields are under `template`.
      errors.value = Object.fromEntries(Object.entries(apiFieldErrors(err)).map(([path, message]) => [path.replace(/^template\./, ''), message]));
      throw err;
    }
  }, 'Saved');
  if (ok) {
    editing.value = false;
    await load();
  }
}

async function remove(template: EmailTemplate) {
  if (!(await confirmAction(`Remove “${template.name}”?`, 'Members are no longer offered it.', 'Remove'))) return;
  if (await attempt(() => removeEmailTemplate(template.templateId), 'Removed')) {
    editing.value = false;
    await load();
  }
}
</script>

<template>
  <div class="ustp-content">
    <p class="text-grey-7">
      The emails people can send from the Your area and Representatives pages, and the scripts they can read out when
      they call a representative’s office. When someone writes to or calls a person, they choose from the templates of
      that kind that suit the person, in this order, and the first is filled in to start; an email can be changed
      before it is sent from their own email app. Membership Admins and Communications Admins both keep this list.
    </p>
    <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
    <div v-else-if="!templates" class="text-grey-7">Loading…</div>
    <template v-else>
      <div v-if="!templates.length" class="text-grey-7">No templates: people start from a blank email, and calls have no script.</div>
      <q-list v-else bordered separator class="rounded-borders">
        <q-item v-for="t in templates" :key="t.templateId">
          <q-item-section>
            <q-item-label>{{ t.name }}</q-item-label>
            <q-item-label caption>{{ CHANNEL_TEXT[t.channel] }} · {{ templateSuitsText(t) }} · {{ t.version === 0 ? 'ready-made' : `version ${t.version}` }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-btn flat dense no-caps color="primary" label="Edit" :aria-label="`Edit ${t.name}`" @click="edit(t)" />
          </q-item-section>
        </q-item>
      </q-list>
      <div v-if="!editing">
        <q-btn
          unelevated
          no-caps
          color="primary"
          icon="add"
          label="New email"
          :disable="templates.length >= EMAIL_TEMPLATE_LIMITS.templates"
          @click="edit(null)"
        />
        <q-btn
          outline
          no-caps
          color="primary"
          icon="call"
          label="New call script"
          class="q-ml-sm"
          :disable="templates.length >= EMAIL_TEMPLATE_LIMITS.templates"
          @click="edit(null, 'call')"
        />
      </div>

      <q-card v-if="editing" flat bordered>
        <q-card-section>
          <h2 class="text-subtitle1 q-my-none">{{ current ? current.name : form.channel === 'call' ? 'New call script' : 'New email' }}</h2>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-form class="ustp-form" novalidate @submit.prevent="save">
            <q-input
              v-model="form.name"
              outlined
              dense
              label="Name members see in the list"
              :maxlength="EMAIL_TEMPLATE_LIMITS.name"
              :error="!!errors.name"
              :error-message="errors.name"
            />
            <div class="ustp-row">
              <q-select v-model="form.channel" outlined dense emit-value map-options :options="channelOptions" label="Kind" :disable="!!current" />
              <q-select v-model="form.audience" outlined dense emit-value map-options :options="audienceOptions" label="For" />
              <q-select
                v-model="form.offices"
                outlined
                dense
                multiple
                use-chips
                emit-value
                map-options
                :options="officeOptions"
                label="Offices"
                hint="None chosen: every office"
                :error="!!errors.offices"
                :error-message="errors.offices"
              />
            </div>
            <q-input
              v-if="form.channel === 'email'"
              v-model="form.subject"
              outlined
              dense
              label="Subject"
              :maxlength="EMAIL_TEMPLATE_LIMITS.subject"
              :error="!!errors.subject"
              :error-message="errors.subject"
            />
            <q-input
              v-model="form.body"
              outlined
              type="textarea"
              autogrow
              :label="form.channel === 'call' ? 'What to say' : 'Email'"
              :maxlength="EMAIL_TEMPLATE_LIMITS.body"
              :error="!!errors.body"
              :error-message="errors.body"
            />
            <div class="text-caption text-grey-7">
              Words in braces:
              <span v-for="p in EMAIL_PLACEHOLDERS" :key="p" class="templates-placeholder"><code v-text="braced(p)" /> {{ PLACEHOLDER_HELP[p] }}</span>
            </div>
            <div v-if="current" class="text-caption text-grey-7">
              {{ current.version === 0 ? 'Ready-made: not changed yet.' : `Version ${current.version}.` }}
            </div>
            <div class="ustp-actions">
              <q-btn type="submit" unelevated no-caps color="primary" label="Save" />
              <q-btn flat no-caps label="Cancel" @click="editing = false" />
              <q-btn v-if="current" flat no-caps color="negative" label="Remove" @click="remove(current)" />
            </div>
          </q-form>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-card flat bordered>
            <q-card-section>
              <h3 class="text-subtitle2 q-my-none">Preview</h3>
              <div class="text-caption text-grey-7">{{ preview.caption }}</div>
            </q-card-section>
            <q-card-section class="q-pt-none">
              <div v-if="form.channel === 'email'" class="text-weight-medium">{{ preview.subject }}</div>
              <div class="templates-preview">{{ preview.body }}</div>
            </q-card-section>
          </q-card>
        </q-card-section>
      </q-card>
    </template>
  </div>
</template>

<style scoped>
.templates-placeholder {
  display: block;
}
.templates-preview {
  white-space: pre-wrap;
  margin-top: 8px;
}
</style>
