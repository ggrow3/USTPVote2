<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { NEWSLETTER_LIMITS, NEWSLETTER_PENDING_DAYS, newsletterSignupSchema } from 'ustp-domain';
import { focusFirstInvalid, usePageTitle } from '../a11y.js';
import { APP_NAME } from '../app-name.js';
import { errorMessage } from '../api.js';
import CommsNav from '../communications/CommsNav.vue';
import PageShell from '../components/PageShell.vue';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { session } from '../session.js';
import { newsletterOpen, signUpForNewsletter } from './api.js';

/**
 * The newsletter's sign-up form (design §10.15), for people not ready to join: an email address and, if they like, a
 * name to be greeted by. Nothing comes until they confirm from the email that follows (double opt-in); unsubscribing
 * deletes the address. The page never says whether an address was on the list already.
 */
usePageTitle('Newsletter');
const open = ref<boolean | null>(null);
const blank = () => ({ email: '', name: '', website: '' });
const form = ref(blank());
const errors = ref<FieldErrors>({});
const sending = ref(false);
const sentTo = ref<string | null>(null);
const failure = ref<string | null>(null);

onMounted(async () => {
  try {
    open.value = (await newsletterOpen()).open;
  } catch {
    open.value = false;
  }
});

async function send() {
  failure.value = null;
  const checked = validate(newsletterSignupSchema, form.value);
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  errors.value = {};
  sending.value = true;
  try {
    await signUpForNewsletter(checked.data);
    sentTo.value = checked.data.email;
    form.value = blank();
  } catch (e) {
    errors.value = apiFieldErrors(e);
    failure.value = errorMessage(e);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <CommsNav />
      <div>
        <h1 class="text-h5 q-mb-xs">The party's newsletter</h1>
        <div class="text-grey-8">
          Not ready to join the U.S. Transhumanist Party? Get its news and calls to action by email: elections, campaigns,
          events and courses, written by the party's administrators.
        </div>
      </div>

      <q-banner v-if="session.me?.member?.status === 'active'" class="bg-blue-1 text-black" rounded>
        You are a member: party email comes to you as one, if you chose it. Change that on
        <router-link to="/account">your Account page</router-link>.
      </q-banner>

      <q-card v-if="sentTo" flat bordered role="status">
        <q-card-section>
          <h2 class="text-subtitle1">Check your inbox</h2>
          <p>
            If {{ sentTo }} is not on the list yet, an email is on its way to it with a link to confirm. Nothing more comes
            until you do, and a sign-up never confirmed is deleted within {{ NEWSLETTER_PENDING_DAYS }} days.
          </p>
          <p class="q-mb-none text-grey-8">Nothing after a few minutes? Look in your spam folder, or sign up again in an hour.</p>
        </q-card-section>
      </q-card>

      <q-banner v-else-if="open === false" class="bg-orange-1 text-black" rounded role="status">
        The newsletter is not taking sign-ups just now. Please try again later.
      </q-banner>

      <q-form v-else-if="open" class="ustp-form ustp-narrow" novalidate @submit.prevent="send">
        <q-input
          v-model="form.email"
          outlined
          type="email"
          label="Your email"
          autocomplete="email"
          :maxlength="NEWSLETTER_LIMITS.email"
          :error="!!errors.email"
          :error-message="errors.email"
        />
        <q-input
          v-model="form.name"
          outlined
          label="Your name (optional)"
          hint="So the newsletter can greet you by it"
          autocomplete="given-name"
          :maxlength="NEWSLETTER_LIMITS.name"
          :error="!!errors.name"
          :error-message="errors.name"
        />
        <!-- Left empty by people; hidden from them and from screen readers. -->
        <div class="newsletter-trap" aria-hidden="true">
          <label>Website <input v-model="form.website" type="text" tabindex="-1" autocomplete="off" /></label>
        </div>
        <q-banner v-if="failure" class="bg-orange-1 text-black" rounded role="alert">{{ failure }}</q-banner>
        <div class="ustp-actions">
          <q-btn type="submit" unelevated no-caps color="primary" label="Sign up" :loading="sending" />
        </div>
        <div class="text-caption text-grey-7">
          We email you a link to confirm; you are on the list only once you press it. Each newsletter has a link to leave
          the list, which deletes your address. Your address is used for nothing else, and {{ APP_NAME }} never knows whether
          you open an email.
        </div>
      </q-form>

      <q-spinner v-else size="32px" aria-label="Loading" />

      <p class="text-grey-8">
        Ready to take part? <router-link to="/register">Apply to join</router-link> to vote in party elections, join teams
        and take the courses' quizzes.
      </p>
    </div>
  </PageShell>
</template>

<style scoped>
.newsletter-trap {
  position: absolute;
  left: -10000px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
</style>
