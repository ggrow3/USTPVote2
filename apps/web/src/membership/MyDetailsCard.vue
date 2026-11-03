<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, reactive, ref } from 'vue';
import { memberDetailsSchema } from 'ustp-domain';
import { focusFirstInvalid, focusSoon } from '../a11y.js';
import { errorMessage } from '../api.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { refreshMe, session } from '../session.js';
import DetailsFields from './DetailsFields.vue';
import { updateMyDetails } from './api.js';
import { consentText, detailsForm, placeText, type DetailsForm } from './member-text.js';

/**
 * The signed-in member's own details and email opt-ins (design §5.2), for the account page. The legal name is shown
 * but corrected only by a Membership Admin.
 */
const $q = useQuasar();
const m = computed(() => session.me?.member ?? null);
const editing = ref(false);
const saving = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive({ details: null as DetailsForm | null, newsletter: false, announcements: false });
let original = '';
const NOT_GIVEN = 'Not given';

function start() {
  if (!m.value) return;
  Object.assign(form, {
    details: detailsForm(m.value),
    newsletter: !!m.value.communications?.newsletter,
    announcements: !!m.value.communications?.announcements,
  });
  original = JSON.stringify(form);
  errors.value = {};
  editing.value = true;
  void focusSoon('#my-details-form input');
}

function stop() {
  editing.value = false;
  void focusSoon('#edit-my-details');
}

async function save() {
  if (JSON.stringify(form) === original) {
    errors.value = { _: 'Nothing has changed.' };
    return;
  }
  const checked = validate(memberDetailsSchema, {
    ...form.details,
    state: form.details?.state ?? '',
    country: form.details?.country ?? undefined,
    newsletter: form.newsletter,
    announcements: form.announcements,
  });
  if (!checked.ok) {
    errors.value = checked.errors;
    return focusFirstInvalid();
  }
  saving.value = true;
  try {
    await updateMyDetails(checked.data);
    await refreshMe();
    $q.notify({ type: 'positive', message: 'Your details are saved' });
    stop();
  } catch (e) {
    errors.value = { _: errorMessage(e), ...apiFieldErrors(e) };
    await focusFirstInvalid();
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <q-card v-if="m" flat bordered>
    <q-card-section class="ustp-header">
      <div>
        <h2 class="text-subtitle1">Your details</h2>
        <div class="text-caption text-grey-7">
          What the party has on file for your membership. If your legal name is wrong, a Membership Admin can correct it.
        </div>
      </div>
      <q-btn v-if="!editing" id="edit-my-details" outline no-caps color="primary" label="Edit details" @click="start" />
    </q-card-section>

    <q-card-section v-if="!editing">
      <dl class="ustp-facts">
        <dt>Legal name</dt>
        <dd>{{ m.legalName }}</dd>
        <dt>Preferred name</dt>
        <dd :class="{ 'text-grey-7': !m.preferredName }">{{ m.preferredName ?? NOT_GIVEN }}</dd>
        <dt>{{ m.country ? 'Country' : 'State or territory' }}</dt>
        <dd>{{ placeText(m) }}</dd>
        <dt>City</dt>
        <dd :class="{ 'text-grey-7': !m.contact?.city }">{{ m.contact?.city || NOT_GIVEN }}</dd>
        <dt>{{ m.country ? 'Postal code' : 'ZIP code' }}</dt>
        <dd :class="{ 'text-grey-7': !m.contact?.postalCode }">{{ m.contact?.postalCode || NOT_GIVEN }}</dd>
        <dt>Phone</dt>
        <dd :class="{ 'text-grey-7': !m.contact?.phone }">{{ m.contact?.phone ?? NOT_GIVEN }}</dd>
        <dt>USTP newsletter</dt>
        <dd>{{ consentText(m.communications?.newsletter) }}</dd>
        <dt>Party announcements and calls to vote</dt>
        <dd>{{ consentText(m.communications?.announcements) }}</dd>
      </dl>
    </q-card-section>

    <q-card-section v-else-if="form.details">
      <q-form id="my-details-form" class="ustp-form" @submit.prevent="save">
        <DetailsFields v-model="form.details" :errors="errors" own />
        <fieldset class="ustp-fieldset">
          <legend class="text-body2">Party email</legend>
          <div class="ustp-options">
            <q-checkbox v-model="form.newsletter" label="Send me the USTP newsletter." />
            <q-checkbox v-model="form.announcements" label="Email me party announcements and calls to vote." />
          </div>
        </fieldset>
        <q-banner v-if="errors._" class="bg-negative text-white" rounded>{{ errors._ }}</q-banner>
        <div class="ustp-actions">
          <q-btn type="submit" color="primary" no-caps label="Save" :loading="saving" />
          <q-btn flat no-caps label="Cancel" :disable="saving" @click="stop" />
        </div>
      </q-form>
    </q-card-section>
  </q-card>
</template>
