<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { createPartnerSchema, PARTNER_LIMITS, partnerConsentSchema, updatePartnerSchema, type PartnerRecord } from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { confirmAction } from './admin-forms.js';
import { addPartner, adminPartners, recordConsent, removePartner, savePartner, withdrawConsent } from './api.js';
import { longDate } from './comms-text.js';

/**
 * Partner groups for Communications Admins (design §10.17): the team's list of allied groups, the events they co-host,
 * and their consent to be named in public. A group is on the public Partners page, and named on its events, only once
 * its consent is recorded here, and leaves them at once when it is withdrawn. Every change but to the notes alone is in
 * the audit ledger.
 */
const list = ref<PartnerRecord[] | null>(null);

interface Form {
  name: string;
  description: string;
  website: string;
  notes: string;
}
const editing = ref(false);
const current = ref<PartnerRecord | null>(null);
const blank = (): Form => ({ name: '', description: '', website: '', notes: '' });
const form = ref<Form>(blank());
const errors = ref<FieldErrors>({});
const busy = ref(false);

/** Recording consent: who at the group agreed, how, and that they did. */
const consent = ref({ from: '', note: '', agreed: false });
const consentErrors = ref<FieldErrors>({});

async function load() {
  await attempt(async () => {
    list.value = await adminPartners();
  });
}

const toForm = (p: PartnerRecord): Form => ({ name: p.name, description: p.description, website: p.website, notes: p.notes });

function startNew() {
  current.value = null;
  form.value = blank();
  editing.value = true;
  errors.value = {};
}

function open(p: PartnerRecord) {
  current.value = p;
  form.value = toForm(p);
  editing.value = true;
  errors.value = {};
  consent.value = { from: '', note: '', agreed: false };
  consentErrors.value = {};
}

const dirty = computed(() => editing.value && (!current.value || JSON.stringify(toForm(current.value)) !== JSON.stringify(form.value)));

async function save() {
  const partner = current.value;
  const checked = partner ? validate(updatePartnerSchema, { ...form.value, basedOn: partner.version }) : validate(createPartnerSchema, form.value);
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  errors.value = {};
  let saved = null as PartnerRecord | null;
  busy.value = true;
  try {
    await attempt(
      async () => {
        try {
          saved = partner
            ? await savePartner(partner.partnerId, checked.data as Parameters<typeof savePartner>[1])
            : await addPartner(checked.data as Parameters<typeof addPartner>[0]);
        } catch (err) {
          errors.value = apiFieldErrors(err);
          throw err;
        }
      },
      partner ? 'Saved' : 'Added to the list: it is not named in public until its consent is recorded',
    );
  } finally {
    busy.value = false;
  }
  if (saved) {
    open(saved);
    await load();
  }
}

async function record() {
  const partner = current.value;
  if (!partner) return;
  const checked = validate(partnerConsentSchema, { basedOn: partner.version, from: consent.value.from, note: consent.value.note });
  if (!checked.ok || !consent.value.agreed) {
    consentErrors.value = { ...(checked.ok ? {} : checked.errors), ...(consent.value.agreed ? {} : { agreed: 'confirm that the group agreed' }) };
    return;
  }
  consentErrors.value = {};
  let saved = null as PartnerRecord | null;
  await attempt(async () => {
    saved = await recordConsent(partner.partnerId, checked.data);
  }, 'Consent recorded: the group is on the Partners page');
  if (saved) {
    open(saved);
    await load();
  }
}

async function withdraw() {
  const partner = current.value;
  if (!partner) return;
  const ok = await confirmAction(
    'Stop listing this group?',
    `“${partner.name}” leaves the Partners page at once, and its events no longer name it. Its consent is cleared; record it again if the group agrees again. This is recorded in the audit ledger.`,
    'Stop listing',
  );
  if (!ok) return;
  let saved = null as PartnerRecord | null;
  await attempt(async () => {
    saved = await withdrawConsent(partner.partnerId, partner.version);
  }, 'No longer listed');
  if (saved) {
    open(saved);
    await load();
  }
}

async function remove() {
  const partner = current.value;
  if (!partner) return;
  const ok = await confirmAction(
    'Remove this group from the list?',
    `“${partner.name}” leaves the team's list and the public pages, and the events it co-hosted no longer name it. This is recorded in the audit ledger and cannot be undone.`,
    'Remove',
  );
  if (ok && (await attempt(() => removePartner(partner.partnerId), 'Removed'))) {
    editing.value = false;
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <p class="text-grey-7">
      The groups the party co-hosts events with and offers its courses to. A group is named in public, on the
      <router-link to="/partners">Partners page</router-link> and on its events, only once you record here that it agreed to
      be; until then it is on this list only. The Partners page also gives every visitor the course embed.
    </p>
    <div class="ustp-actions">
      <q-btn v-if="!editing" unelevated no-caps color="primary" icon="add" label="Add a group" @click="startNew" />
    </div>

    <q-card v-if="editing" flat bordered>
      <q-card-section class="ustp-header">
        <div>
          <h2 class="text-subtitle1">{{ current ? current.name : 'New group' }}</h2>
          <div v-if="current" class="text-caption text-grey-7">
            <q-badge :color="current.consent ? 'positive' : 'grey-7'" :label="current.consent ? 'Listed' : 'Not listed'" />
            · added {{ longDate(current.createdAt) }} · version {{ current.version }}
          </div>
        </div>
      </q-card-section>
      <q-card-section>
        <q-form class="ustp-form" novalidate @submit.prevent="save">
          <q-input v-model="form.name" outlined label="Name" :maxlength="PARTNER_LIMITS.name" counter :error="!!errors.name" :error-message="errors.name" />
          <q-input
            v-model="form.description"
            outlined
            type="textarea"
            autogrow
            label="What the group does (optional)"
            hint="Shown on the Partners page once it is listed; in the group's own words, if it gave some."
            :maxlength="PARTNER_LIMITS.description"
            counter
          />
          <q-input v-model="form.website" outlined dense label="Its site (optional)" placeholder="https://" :error="!!errors.website" :error-message="errors.website" />
          <q-input
            v-model="form.notes"
            outlined
            type="textarea"
            autogrow
            label="Notes for the team (optional)"
            hint="Never shown in public: who to talk to there, what was agreed."
            :maxlength="PARTNER_LIMITS.notes"
          />
          <div class="ustp-actions">
            <q-btn type="submit" unelevated no-caps color="primary" :label="current ? 'Save changes' : 'Add to the list'" :disable="!dirty" :loading="busy" />
            <q-btn v-if="current" flat no-caps color="negative" label="Remove from the list" @click="remove" />
            <q-btn flat no-caps label="Close" @click="editing = false" />
          </div>
        </q-form>
      </q-card-section>

      <q-separator v-if="current" />
      <q-card-section v-if="current?.consent">
        <h3 class="text-body1 text-weight-medium q-my-none">Listed in public</h3>
        <p class="q-mb-sm">
          Since {{ longDate(current.consent.recordedAt) }}: {{ current.consent.from }} agreed<template v-if="current.consent.note"> ({{ current.consent.note }})</template>.
        </p>
        <q-btn outline no-caps color="negative" label="Stop listing it" @click="withdraw" />
        <div class="text-caption text-grey-7 q-mt-xs">If the group asks to be taken off, do this at once.</div>
      </q-card-section>
      <q-card-section v-else-if="current">
        <h3 class="text-body1 text-weight-medium q-my-none">List it in public</h3>
        <p class="text-grey-7 q-mb-sm">Only once someone who may speak for the group has agreed that the party names it.</p>
        <div class="ustp-form">
          <q-input
            v-model="consent.from"
            outlined
            dense
            label="Who agreed"
            placeholder="Jo Smith, chair"
            :maxlength="PARTNER_LIMITS.consentFrom"
            :error="!!consentErrors.from"
            :error-message="consentErrors.from"
          />
          <q-input v-model="consent.note" outlined dense label="How (optional)" placeholder="By email, 10 November" :maxlength="PARTNER_LIMITS.consentNote" />
          <q-checkbox v-model="consent.agreed" label="The group agreed to be named on this site as a partner of the party" />
          <div v-if="consentErrors.agreed" class="text-negative text-caption" role="alert">{{ consentErrors.agreed }}</div>
          <div class="ustp-actions">
            <q-btn unelevated no-caps color="primary" icon="handshake" label="Record consent and list it" :disable="dirty" @click="record" />
          </div>
          <div v-if="dirty" class="text-caption text-grey-7">Save the changes above first.</div>
        </div>
      </q-card-section>
    </q-card>

    <div v-if="list && list.length === 0 && !editing" class="text-grey-7">No groups yet.</div>
    <q-list v-else-if="list" bordered separator class="rounded-borders">
      <q-item v-for="p in list" :key="p.partnerId" clickable :active="editing && current?.partnerId === p.partnerId" @click="open(p)">
        <q-item-section>
          <q-item-label>{{ p.name }}</q-item-label>
          <q-item-label v-if="p.website" caption>{{ p.website }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge :color="p.consent ? 'positive' : 'grey-7'" :label="p.consent ? 'Listed' : 'Not listed'" />
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>
