<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import { APP_NAME } from '../app-name.js';
import PageShell from '../components/PageShell.vue';
import PasswordInput from '../components/PasswordInput.vue';
import TwoStepCodeCard from '../components/TwoStepCodeCard.vue';
import { emailAction, identityPlatformActionPage } from '../email-action.js';
import { auth } from '../firebase.js';
import { startPath } from '../governance/navigation.js';
import { PASSWORD_HINT, PasswordRejected, passwordResetEmail, resetPassword, signInWithPassword } from '../sign-in.js';
import { useSignInFlow } from '../sign-in-flow.js';

/**
 * Where Identity Platform's account emails lead (design §4): a password-reset link chooses the new password here, with
 * the same checks as signing up, then signs in with it; any other link goes on to Identity Platform's own page.
 */
const router = useRouter();
const action = emailAction(location.href, identityPlatformActionPage(auth));
usePageTitle(action.kind === 'reset-password' ? 'Choose a new password' : 'Account email link');

/** The login the reset link is for, once Identity Platform has confirmed the link. */
const email = ref<string | null>(null);
const checking = ref(action.kind === 'reset-password');
const linkError = ref<string | null>(null);
const password = ref('');
const passwordError = ref<string | null>(null);
/** The new password is saved; signing in with it comes next. */
const changed = ref(false);

const { busy, error, challenge, code, run, submitCode } = useSignInFlow(() => router.replace(startPath()));

onMounted(async () => {
  if (action.kind === 'elsewhere') return location.replace(action.url);
  if (action.kind !== 'reset-password') return;
  try {
    email.value = await passwordResetEmail(auth, action.oobCode);
  } catch (e) {
    linkError.value = errorMessage(e);
  } finally {
    checking.value = false;
  }
});

function save() {
  if (action.kind !== 'reset-password' || !email.value) return;
  const address = email.value;
  passwordError.value = null;
  return run(async () => {
    try {
      await resetPassword(auth, action.oobCode, address, password.value);
    } catch (e) {
      if (!(e instanceof PasswordRejected)) throw e;
      passwordError.value = e.message;
      return;
    }
    changed.value = true;
    // Resetting ends every session of the login, this browser's too, so sign in again with the new password.
    return signInWithPassword(auth, address, password.value);
  });
}
</script>

<template>
  <PageShell width="narrow">
    <div class="ustp-content ustp-narrow">
      <template v-if="action.kind === 'elsewhere'">
        <h1 class="text-h5">Opening your link…</h1>
        <p role="status">If nothing happens, <a :href="action.url">continue here</a>.</p>
      </template>

      <template v-else-if="action.kind === 'incomplete'">
        <h1 class="text-h5">This link is incomplete</h1>
        <p>
          This page opens the links in {{ APP_NAME }}'s account emails, and this one is missing its code. Open the link
          from the email again, or copy all of it. To reset a password, choose “Forgot password?” on the
          <router-link to="/signin">sign-in page</router-link>.
        </p>
      </template>

      <template v-else>
        <h1 class="text-h5">Choose a new password</h1>
        <q-banner v-if="error" class="bg-negative text-white" rounded>{{ error }}</q-banner>

        <div v-if="checking" class="row justify-center">
          <q-spinner size="lg" />
          <span class="sr-only" role="status">Checking your link…</span>
        </div>

        <template v-else-if="linkError">
          <q-banner class="bg-negative text-white" rounded>{{ linkError }}</q-banner>
          <p>
            For a new link, choose “Forgot password?” on the <router-link to="/signin">sign-in page</router-link>.
            Each link works once, for an hour.
          </p>
        </template>

        <TwoStepCodeCard v-else-if="challenge" v-model:code="code" :busy="busy" @submit="submitCode" @cancel="challenge = null" />

        <q-card v-else-if="changed" flat bordered>
          <q-card-section role="status">
            Your password is changed, and {{ email }} is signed out everywhere else.
            <template v-if="!busy">Sign in with the new password to continue.</template>
          </q-card-section>
          <q-card-section v-if="!busy" class="ustp-actions">
            <q-btn color="primary" label="Sign in" to="/signin" />
          </q-card-section>
        </q-card>

        <q-card v-else flat bordered>
          <q-form class="ustp-form q-pa-md" @submit.prevent="save">
            <div>
              For <strong>{{ email }}</strong>. Saving it signs this login out everywhere else, and signs you in here
              with the new password.
            </div>
            <!-- For password managers, so they save the new password under the right login. -->
            <input type="email" name="username" autocomplete="username" :value="email" hidden readonly />
            <PasswordInput
              v-model="password"
              label="New password"
              outlined
              dense
              autofocus
              autocomplete="new-password"
              :hint="PASSWORD_HINT"
              :error="!!passwordError"
              :error-message="passwordError ?? undefined"
            />
            <div class="ustp-actions">
              <q-btn type="submit" color="primary" :loading="busy" label="Save and sign in" />
            </div>
          </q-form>
        </q-card>
      </template>
    </div>
  </PageShell>
</template>
