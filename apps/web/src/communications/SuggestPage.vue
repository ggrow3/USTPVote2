<script setup lang="ts">
import { computed, ref } from 'vue';
import { SUGGESTION_LIMITS, SUGGESTION_RETENTION_DAYS, SUGGESTION_TOPICS, suggestionSchema, type SuggestionTopic } from 'ustp-domain';
import { focusFirstInvalid, usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { sendSuggestion } from './api.js';
import CommsNav from './CommsNav.vue';
import { SUGGESTION_TOPIC_LABELS } from './comms-text.js';

/**
 * The suggestions form (design §10.7): anyone may send the party an idea, member or not, signed in or not. A name and
 * email are optional and kept only with consent; Communications Admins read what arrives; it is deleted after a year.
 */
usePageTitle('Send a suggestion');
const topics = SUGGESTION_TOPICS.map((value) => ({ value, label: SUGGESTION_TOPIC_LABELS[value] }));
const blank = () => ({ topic: null as SuggestionTopic | null, message: '', name: '', email: '', consent: false, website: '' });
const form = ref(blank());
const errors = ref<FieldErrors>({});
const sending = ref(false);
const sent = ref(false);
const failure = ref<string | null>(null);
const contactGiven = computed(() => !!(form.value.name.trim() || form.value.email.trim()));

async function send() {
  failure.value = null;
  const checked = validate(suggestionSchema, form.value);
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  errors.value = {};
  sending.value = true;
  try {
    await sendSuggestion(checked.data);
    sent.value = true;
  } catch (e) {
    errors.value = apiFieldErrors(e);
    failure.value = errorMessage(e);
  } finally {
    sending.value = false;
  }
}

function again() {
  form.value = blank();
  sent.value = false;
}
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <CommsNav />
      <div>
        <h1 class="text-h5 q-mb-xs">Send a suggestion</h1>
        <div class="text-grey-7">
          An idea for a policy, a campaign or an event, a question for the party, or something about this site: anyone may
          write, member or not. The party's communications team reads every suggestion.
        </div>
      </div>

      <q-card v-if="sent" flat bordered>
        <q-card-section>
          <h2 class="text-subtitle1">Thank you</h2>
          <p>Your suggestion has reached the communications team.</p>
          <q-btn flat no-caps color="primary" label="Send another" @click="again" />
        </q-card-section>
      </q-card>

      <q-form v-else class="ustp-form" novalidate @submit.prevent="send">
        <q-select
          v-model="form.topic"
          outlined
          emit-value
          map-options
          :options="topics"
          label="What is it about?"
          :error="!!errors.topic"
          :error-message="errors.topic ? 'choose what it is about' : undefined"
        />
        <q-input
          v-model="form.message"
          outlined
          type="textarea"
          autogrow
          label="Your suggestion"
          :maxlength="SUGGESTION_LIMITS.message"
          counter
          :error="!!errors.message"
          :error-message="errors.message"
        />
        <fieldset class="ustp-fieldset">
          <legend>If you would like a reply (optional)</legend>
          <div class="ustp-form">
            <q-input v-model="form.name" outlined label="Your name" autocomplete="name" :maxlength="SUGGESTION_LIMITS.name" :error="!!errors.name" :error-message="errors.name" />
            <q-input
              v-model="form.email"
              outlined
              type="email"
              label="Your email"
              autocomplete="email"
              :error="!!errors.email"
              :error-message="errors.email"
            />
            <q-checkbox
              v-if="contactGiven"
              v-model="form.consent"
              :label="`Keep my name and email so the party can reply. They are deleted with my suggestion after ${SUGGESTION_RETENTION_DAYS / 365} year.`"
            />
            <div v-if="errors.consent" class="text-negative text-caption" role="alert">{{ errors.consent }}</div>
          </div>
        </fieldset>
        <!-- Left empty by people; hidden from them and from screen readers. -->
        <div class="suggest-trap" aria-hidden="true">
          <label>Website <input v-model="form.website" type="text" tabindex="-1" autocomplete="off" /></label>
        </div>
        <q-banner v-if="failure" class="bg-orange-1 text-black" rounded role="alert">{{ failure }}</q-banner>
        <div class="ustp-actions">
          <q-btn type="submit" unelevated no-caps color="primary" label="Send" :loading="sending" />
        </div>
        <div class="text-caption text-grey-7">
          Only the party's Communications Admins read suggestions. Each one, with any name and email, is deleted a year
          after it arrives. Leave your name and email out to stay anonymous.
        </div>
      </q-form>
    </div>
  </PageShell>
</template>

<style scoped>
.suggest-trap {
  position: absolute;
  left: -10000px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
</style>
