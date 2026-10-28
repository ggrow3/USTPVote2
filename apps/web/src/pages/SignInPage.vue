<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { usePageTitle } from '../a11y.js';
import PageShell from '../components/PageShell.vue';
import SignInForm from '../components/SignInForm.vue';

const route = useRoute();
usePageTitle('Sign in');

/** Where to return once signed in, when a page that needs a sign-in sent them here (the router passes it). */
const redirect = computed(() => (typeof route.query.redirect === 'string' ? route.query.redirect : null));

/** Why the visitor is here, when a page that needs a sign-in sent them. */
const PURPOSES: readonly (readonly [string, string])[] = [
  ['/ballot', 'see your ballots and vote'],
  ['/admin', 'use the admin console'],
  ['/account', 'manage your account'],
];
const purpose = computed(() => {
  const page = redirect.value?.split(/[?#]/)[0];
  return PURPOSES.find(([path]) => page === path || page?.startsWith(`${path}/`))?.[1];
});
</script>

<template>
  <PageShell width="narrow">
    <div class="ustp-content ustp-narrow">
      <h1 class="text-h5">Sign in</h1>
      <p v-if="purpose">Sign in to {{ purpose }}.</p>
      <SignInForm :redirect="redirect">
        <template #footer>
          <q-card-section>
            New to USTP? <router-link to="/register">Register as a member</router-link>: creating your login is the
            first step.
          </q-card-section>
        </template>
      </SignInForm>
    </div>
  </PageShell>
</template>
