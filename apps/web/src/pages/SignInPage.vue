<script setup lang="ts">
import type { UserCredential } from 'firebase/auth';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { SignInProvider } from 'ustp-domain';
import { api, errorMessage } from '../api.js';
import { auth } from '../firebase.js';
import { session, whenSignedIn } from '../session.js';
import {
  completeEmailLink,
  MIN_PASSWORD_LENGTH,
  passwordProblem,
  pendingEmailLink,
  PROVIDER_LABELS,
  sendEmailLink,
  signInWithPassword,
  signInWithProvider,
  signUpWithPassword,
  type FederatedProvider,
} from '../sign-in.js';

const route = useRoute();
const router = useRouter();

const enabled = ref<Record<SignInProvider, boolean> | null>(null);
const federated = computed(() =>
  (['google.com', 'microsoft.com', 'apple.com'] as const).filter((p) => enabled.value?.[p]),
);
const mode = ref<'signin' | 'signup' | 'link'>('signin');
const email = ref('');
const password = ref('');
const busy = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const emailLink = pendingEmailLink(auth);

const passwordHint = computed(() =>
  mode.value === 'signup' && password.value ? passwordProblem(password.value) : null,
);

onMounted(async () => {
  try {
    enabled.value = await api<Record<SignInProvider, boolean>>('GET', '/v1/sign-in-methods');
  } catch (e) {
    error.value = `Could not load sign-in options: ${errorMessage(e)}`;
  }
  if (emailLink.isLink && emailLink.email) await run(() => completeEmailLink(auth, emailLink.email!));
});

async function run(action: () => Promise<UserCredential | void>) {
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    const credential = await action();
    if (!credential) return;
    await whenSignedIn(credential.user.uid);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : null;
    await router.replace(redirect ?? (session.me?.member ? '/account' : '/register'));
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function withProvider(p: FederatedProvider) {
  return run(() => signInWithProvider(auth, p));
}

function submitEmail() {
  if (mode.value === 'signin') return run(() => signInWithPassword(auth, email.value, password.value));
  if (mode.value === 'signup') return run(() => signUpWithPassword(auth, email.value, password.value));
  return run(async () => {
    await sendEmailLink(auth, email.value);
    notice.value = `We sent a sign-in link to ${email.value}. Open it in this browser.`;
  });
}
</script>

<template>
  <q-page padding class="row justify-center">
    <div style="width: 100%; max-width: 440px">
      <div class="text-h5 q-mb-md">Sign in</div>
      <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>{{ error }}</q-banner>
      <q-banner v-if="notice" class="bg-positive text-white q-mb-md" rounded>{{ notice }}</q-banner>

      <q-card v-if="emailLink.isLink && !emailLink.email" flat bordered class="q-mb-md">
        <q-card-section>
          <div class="text-subtitle1 q-mb-sm">Finish signing in with your email link</div>
          <q-input v-model="email" type="email" label="The email address the link was sent to" outlined dense />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn color="primary" label="Continue" :loading="busy" @click="run(() => completeEmailLink(auth, email))" />
        </q-card-actions>
      </q-card>

      <div class="column q-gutter-sm q-mb-lg">
        <q-btn
          v-for="p in federated"
          :key="p"
          outline
          color="primary"
          no-caps
          :disable="busy"
          :label="`Continue with ${PROVIDER_LABELS[p]}`"
          @click="withProvider(p)"
        />
      </div>

      <q-card v-if="enabled?.password" flat bordered>
        <q-tabs v-model="mode" dense align="justify" class="text-primary">
          <q-tab name="signin" label="Email & password" no-caps />
          <q-tab name="signup" label="Create account" no-caps />
          <q-tab name="link" label="Email me a link" no-caps />
        </q-tabs>
        <q-separator />
        <q-form class="q-pa-md q-gutter-md" @submit.prevent="submitEmail">
          <q-input v-model="email" type="email" label="Email" outlined dense autocomplete="email" />
          <q-input
            v-if="mode !== 'link'"
            v-model="password"
            type="password"
            label="Password"
            outlined
            dense
            :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'"
            :error="!!passwordHint"
            :error-message="passwordHint ?? undefined"
            :hint="mode === 'signup' ? `At least ${MIN_PASSWORD_LENGTH} characters. No other rules.` : undefined"
          />
          <q-btn
            type="submit"
            color="primary"
            class="full-width"
            :loading="busy"
            :label="mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send link'"
          />
        </q-form>
      </q-card>
    </div>
  </q-page>
</template>
