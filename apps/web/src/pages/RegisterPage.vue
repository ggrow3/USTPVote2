<script setup lang="ts">
import { sendEmailVerification } from 'firebase/auth';
import { useQuasar } from 'quasar';
import { computed, reactive, ref, watch } from 'vue';
import { createApplicationSchema, MINIMUM_MEMBER_AGE, type ApplicationRecord, type BylawsRecord } from 'ustp-domain';
import { focusFirstInvalid, focusSoon, usePageTitle } from '../a11y.js';
import { api, errorMessage } from '../api.js';
import { auth } from '../firebase.js';
import { apiFieldErrors, STATES, validate, type FieldErrors } from '../forms.js';
import { refreshMe, refreshUser, session } from '../session.js';

const $q = useQuasar();
usePageTitle('Register');
const bylaws = ref<BylawsRecord | null>(null);
const bylawsError = ref<string | null>(null);
const applications = ref<ApplicationRecord[]>([]);
const agreed = ref(false);
const busy = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive({
  legalName: '',
  preferredName: '',
  dateOfBirth: '',
  state: null as string | null,
  city: '',
  postalCode: '',
  phone: '',
  statement: '',
  interests: '',
  skills: '',
  referral: '',
  volunteer: false,
  runForOffice: false,
  newsletter: false,
  announcements: false,
  attestsAge: false,
  supportsPlatform: false,
});
/** Optional text fields go to the API only when filled in. */
const optional = (value: string) => value.trim() || undefined;

const status = computed(() => session.me?.member?.status ?? null);
const canApply = computed(() => status.value === null || status.value === 'rejected' || status.value === 'resigned');
const lastDecision = computed(() => applications.value.find((a) => a.status !== 'pending') ?? null);
const stateOptions = STATES.map((s) => ({ label: `${s.name} (${s.code})`, value: s.code }));

watch(
  () => session.me?.account?.accountId,
  async (accountId) => {
    if (!accountId) return;
    applications.value = await api<ApplicationRecord[]>('GET', '/v1/registration/applications/me').catch(() => []);
    if (canApply.value && !bylaws.value) {
      bylaws.value = await api<BylawsRecord>('GET', '/v1/bylaws/current').catch((e) => {
        bylawsError.value = errorMessage(e);
        return null;
      });
    }
  },
  { immediate: true },
);

async function resendVerification() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await sendEmailVerification(user, { url: `${location.origin}/register` });
    $q.notify({ message: `Verification email sent to ${user.email}` });
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  }
}

async function checkVerified() {
  await refreshUser();
  if (!session.user?.emailVerified) $q.notify({ message: 'Not verified yet. Open the link in the email, then try again.' });
}

async function submit() {
  if (!bylaws.value) return;
  if (!agreed.value) {
    errors.value = { _: 'You must agree to the bylaws to apply.' };
    return;
  }
  const checked = validate(createApplicationSchema, {
    bylawsVersion: bylaws.value.version,
    bylawsHash: bylaws.value.contentHash,
    legalName: form.legalName,
    preferredName: optional(form.preferredName),
    dateOfBirth: form.dateOfBirth,
    attestsAge: form.attestsAge,
    supportsPlatform: form.supportsPlatform,
    state: form.state ?? '',
    city: form.city,
    postalCode: form.postalCode,
    phone: optional(form.phone),
    statement: optional(form.statement),
    interests: optional(form.interests),
    skills: optional(form.skills),
    volunteer: form.volunteer,
    runForOffice: form.runForOffice,
    referral: optional(form.referral),
    newsletter: form.newsletter,
    announcements: form.announcements,
  });
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  busy.value = true;
  errors.value = {};
  try {
    await api('POST', '/v1/registration/applications', checked.data);
    await refreshMe();
    applications.value = await api<ApplicationRecord[]>('GET', '/v1/registration/applications/me');
    $q.notify({ type: 'positive', message: 'Application submitted' });
    await focusSoon('#application-status');
  } catch (e) {
    errors.value = { _: errorMessage(e), ...apiFieldErrors(e) };
    await focusFirstInvalid();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <q-page padding>
    <h1 class="text-h5 q-mb-md">Register as a member</h1>
    <div style="max-width: 760px">
      <div v-if="!session.ready" class="text-grey-7">Loading…</div>

      <q-card v-else-if="!session.user" flat bordered>
        <q-card-section>Sign in or create a login first. You will then be able to read the bylaws and apply.</q-card-section>
        <q-card-actions>
          <q-btn color="primary" label="Sign in" :to="{ path: '/signin', query: { redirect: '/register' } }" />
        </q-card-actions>
      </q-card>

      <q-card v-else-if="status === 'applicant'" flat bordered>
        <q-card-section>
          <h2 id="application-status" class="text-subtitle1">Your application is being reviewed</h2>
          <div class="text-grey-7">
            Submitted {{ applications[0] ? new Date(applications[0].submittedAt).toLocaleString() : '' }}. A Membership
            Admin will decide it; you will see the outcome here.
          </div>
        </q-card-section>
      </q-card>

      <q-card v-else-if="!canApply" flat bordered>
        <q-card-section>
          You are a member (status <q-badge :label="status ?? ''" color="primary" />).
          <router-link to="/account">Manage your account</router-link>.
        </q-card-section>
      </q-card>

      <q-card v-else-if="!session.user.emailVerified" flat bordered>
        <q-card-section>
          <h2 class="text-subtitle1">Verify your email address</h2>
          <div class="text-grey-7">
            We need a verified address for {{ session.user.email }} before you can apply. Check your inbox for the
            verification link.
          </div>
        </q-card-section>
        <q-card-actions>
          <q-btn color="primary" label="I've verified it" @click="checkVerified" />
          <q-btn flat color="primary" label="Resend email" @click="resendVerification" />
        </q-card-actions>
      </q-card>

      <template v-else>
        <q-banner v-if="lastDecision?.status === 'rejected'" class="bg-orange-1 text-black q-mb-md" rounded>
          Your previous application was not approved: {{ lastDecision.decisionReason }}
        </q-banner>
        <q-banner v-if="bylawsError" class="bg-negative text-white q-mb-md" rounded>{{ bylawsError }}</q-banner>

        <q-card v-if="bylaws" flat bordered class="q-mb-md">
          <q-card-section>
            <h2 id="bylaws-title" class="text-subtitle1">{{ bylaws.title }}</h2>
            <div class="text-caption text-grey-7">
              Version {{ bylaws.version }} · SHA-256 <code>{{ bylaws.contentHash.slice(0, 16) }}…</code>
            </div>
          </q-card-section>
          <q-separator />
          <!-- A focusable region, so the text can be scrolled with the keyboard too (WCAG 2.1.1). -->
          <div
            class="q-pa-md"
            style="height: 260px; overflow-y: auto; white-space: pre-wrap"
            tabindex="0"
            role="region"
            aria-labelledby="bylaws-title"
          >{{ bylaws.text }}</div>
          <q-separator />
          <q-card-section>
            <q-checkbox v-model="agreed" label="I have read these bylaws and agree to abide by them." />
          </q-card-section>
        </q-card>

        <q-form v-if="bylaws" class="q-gutter-md" @submit.prevent="submit">
          <fieldset class="register-section">
            <legend class="text-subtitle1">About you</legend>
            <q-input
              v-model="form.legalName"
              outlined
              label="Legal name"
              autocomplete="name"
              :error="!!errors.legalName"
              :error-message="errors.legalName"
            />
            <q-input v-model="form.preferredName" outlined label="Preferred name (optional)" autocomplete="nickname" />
            <q-input
              v-model="form.dateOfBirth"
              outlined
              stack-label
              type="date"
              label="Date of birth"
              autocomplete="bday"
              :hint="`Members must be at least ${MINIMUM_MEMBER_AGE}. Kept with your application only, for the membership review.`"
              :error="!!errors.dateOfBirth"
              :error-message="errors.dateOfBirth"
            />
          </fieldset>

          <fieldset class="register-section">
            <legend class="text-subtitle1">Where you live and how to reach you</legend>
            <div class="text-caption text-grey-7 q-mb-sm">We never ask for your street address.</div>
            <q-select
              v-model="form.state"
              outlined
              emit-value
              map-options
              :options="stateOptions"
              label="State or territory"
              :error="!!errors.state"
              :error-message="errors.state"
            />
            <div class="row q-col-gutter-md">
              <q-input
                v-model="form.city"
                class="col-12 col-sm-8"
                outlined
                label="City"
                autocomplete="address-level2"
                :error="!!errors.city"
                :error-message="errors.city"
              />
              <q-input
                v-model="form.postalCode"
                class="col-12 col-sm-4"
                outlined
                label="ZIP code"
                inputmode="numeric"
                autocomplete="postal-code"
                :error="!!errors.postalCode"
                :error-message="errors.postalCode"
              />
            </div>
            <q-input
              v-model="form.phone"
              outlined
              type="tel"
              label="Phone (optional)"
              autocomplete="tel"
              :error="!!errors.phone"
              :error-message="errors.phone"
            />
          </fieldset>

          <fieldset class="register-section">
            <legend class="text-subtitle1">Your interest in USTP</legend>
            <q-input v-model="form.statement" outlined autogrow type="textarea" label="Why do you want to join? (optional)" />
            <q-input v-model="form.interests" outlined autogrow type="textarea" label="Issues you care most about (optional)" />
            <q-input v-model="form.skills" outlined autogrow type="textarea" label="Skills or experience you could contribute (optional)" />
            <q-input v-model="form.referral" outlined label="How did you hear about USTP? (optional)" />
            <q-checkbox v-model="form.volunteer" label="I'd like to volunteer." />
            <q-checkbox v-model="form.runForOffice" label="I'm interested in running for party or public office." />
          </fieldset>

          <fieldset class="register-section">
            <legend class="text-subtitle1">Staying in touch</legend>
            <div class="text-caption text-grey-7 q-mb-sm">Optional. You can withdraw either at any time.</div>
            <q-checkbox v-model="form.newsletter" label="Send me the USTP newsletter." />
            <q-checkbox v-model="form.announcements" label="Email me party announcements and calls to vote." />
          </fieldset>

          <fieldset class="register-section">
            <legend class="text-subtitle1">Confirmations</legend>
            <q-checkbox v-model="form.attestsAge" :label="`I am at least ${MINIMUM_MEMBER_AGE} years old.`" />
            <div v-if="errors.attestsAge" class="text-negative text-caption q-ml-lg">{{ errors.attestsAge }}</div>
            <q-checkbox v-model="form.supportsPlatform" label="I support the platform and goals of the US Transhumanist Party." />
            <div v-if="errors.supportsPlatform" class="text-negative text-caption q-ml-lg">{{ errors.supportsPlatform }}</div>
          </fieldset>

          <q-banner v-if="errors._" class="bg-negative text-white" rounded>{{ errors._ }}</q-banner>
          <q-btn type="submit" color="primary" label="Submit application" :loading="busy" />
        </q-form>
      </template>
    </div>
  </q-page>
</template>

<style scoped>
.register-section {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.register-section legend {
  padding: 0;
  margin-bottom: 8px;
}
</style>
