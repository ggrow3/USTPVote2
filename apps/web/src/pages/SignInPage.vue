<script setup lang="ts">
import type { UserCredential } from 'firebase/auth';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { SignInProvider } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api, errorMessage } from '../api.js';
import TwoStepCodeCard from '../components/TwoStepCodeCard.vue';
import { auth } from '../firebase.js';
import { session } from '../session.js';
import {
  completeEmailLink,
  pendingEmailLink,
  PROVIDER_LABELS,
  sendEmailLink,
  signInWithPassword,
  signInWithProvider,
  type FederatedProvider,
} from '../sign-in.js';
import { useSignInFlow } from '../sign-in-flow.js';

const route = useRoute();
const router = useRouter();
usePageTitle('Sign in');

const enabled = ref<Record<SignInProvider, boolean> | null>(null);
const federated = computed(() =>
  (['google.com', 'microsoft.com', 'apple.com'] as const).filter((p) => enabled.value?.[p]),
);
const mode = ref<'signin' | 'link'>('signin');
const email = ref('');
const password = ref('');
const notice = ref<string | null>(null);
const emailLink = pendingEmailLink(auth);

const { busy, error, challenge, code, run, submitCode } = useSignInFlow(() => {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : null;
  return router.replace(redirect ?? (session.me?.member ? '/account' : '/register'));
});

/** Why the visitor is here, when a page that needs a sign-in sent them (the router passes it as `redirect`). */
const PURPOSES: readonly (readonly [string, string])[] = [
  ['/ballot', 'see your ballots and vote'],
  ['/admin', 'use the admin console'],
  ['/account', 'manage your account'],
];
const purpose = computed(() => {
  const page = typeof route.query.redirect === 'string' ? route.query.redirect.split(/[?#]/)[0] : null;
  return PURPOSES.find(([path]) => page === path || page?.startsWith(`${path}/`))?.[1];
});

onMounted(async () => {
  try {
    enabled.value = await api<Record<SignInProvider, boolean>>('GET', '/v1/sign-in-methods');
  } catch (e) {
    error.value = `Could not load sign-in options: ${errorMessage(e)}`;
  }
  if (emailLink.isLink && emailLink.email) await signIn(() => completeEmailLink(auth, emailLink.email!));
});

function signIn(action: () => Promise<UserCredential | void>) {
  notice.value = null;
  return run(action);
}

function withProvider(p: FederatedProvider) {
  return signIn(() => signInWithProvider(auth, p));
}

function submitEmail() {
  if (mode.value === 'signin') return signIn(() => signInWithPassword(auth, email.value, password.value));
  return signIn(async () => {
    await sendEmailLink(auth, email.value);
    notice.value = `We sent a sign-in link to ${email.value}. Open it in this browser.`;
  });
}
</script>

<template>
  <q-page padding>
    <div class="ustp-content ustp-narrow">
      <h1 class="text-h5">Sign in</h1>
      <p v-if="purpose">Sign in to {{ purpose }}.</p>
      <q-banner v-if="error" class="bg-negative text-white" rounded>{{ error }}</q-banner>
      <q-banner v-if="notice" class="bg-positive text-white" rounded role="status">{{ notice }}</q-banner>

      <TwoStepCodeCard v-if="challenge" v-model:code="code" :busy="busy" @submit="submitCode" @cancel="challenge = null" />

      <template v-else>
        <q-card v-if="emailLink.isLink && !emailLink.email" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Finish signing in with your email link</h2>
          </q-card-section>
          <q-card-section class="ustp-form">
            <q-input v-model="email" type="email" label="The email address the link was sent to" outlined dense />
            <div class="ustp-actions">
              <q-btn color="primary" label="Continue" :loading="busy" @click="signIn(() => completeEmailLink(auth, email))" />
            </div>
          </q-card-section>
        </q-card>

        <q-card flat bordered>
          <q-card-section v-if="federated.length" class="ustp-stack">
            <q-btn
              v-for="p in federated"
              :key="p"
              outline
              color="primary"
              no-caps
              class="full-width"
              :disable="busy"
              :label="`Continue with ${PROVIDER_LABELS[p]}`"
              @click="withProvider(p)"
            />
          </q-card-section>

          <template v-if="enabled?.password">
            <q-separator v-if="federated.length" />
            <q-tabs v-model="mode" dense align="justify" mobile-arrows class="text-primary">
              <q-tab id="signin-tab-signin" name="signin" label="Email & password" no-caps aria-controls="signin-panel" />
              <q-tab id="signin-tab-link" name="link" label="Email me a link" no-caps aria-controls="signin-panel" />
            </q-tabs>
            <q-separator />
            <q-form
              id="signin-panel"
              role="tabpanel"
              :aria-labelledby="`signin-tab-${mode}`"
              class="ustp-form q-pa-md"
              @submit.prevent="submitEmail"
            >
              <q-input v-model="email" type="email" label="Email" outlined dense autocomplete="email" />
              <q-input
                v-if="mode === 'signin'"
                v-model="password"
                type="password"
                label="Password"
                outlined
                dense
                autocomplete="current-password"
              />
              <div class="ustp-actions">
                <q-btn type="submit" color="primary" :loading="busy" :label="mode === 'signin' ? 'Sign in' : 'Send link'" />
              </div>
            </q-form>
          </template>

          <q-separator />
          <q-card-section>
            New to USTP? <router-link to="/register">Register as a member</router-link>: creating your login is the first
            step.
          </q-card-section>
        </q-card>
      </template>
    </div>
  </q-page>
</template>
