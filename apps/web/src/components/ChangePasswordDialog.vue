<script setup lang="ts">
import { ref, watch } from 'vue';
import { errorMessage } from '../api.js';
import { confirmPassword } from '../dialogs.js';
import { auth } from '../firebase.js';
import { changePassword, PASSWORD_HINT, PasswordRejected, sendPasswordReset } from '../sign-in.js';
import PasswordInput from './PasswordInput.vue';

/**
 * Changing the password of the login someone is signed in with (design §4): the current one, and the authenticator
 * code if they have one, to re-authenticate, and a new one with the same checks as signing up.
 */
const open = defineModel<boolean>({ required: true });
/** `signInAgain`: changed, but this session still needs to sign in again with the new password. */
const emit = defineEmits<{ changed: [signInAgain: boolean] }>();

const current = ref('');
const replacement = ref('');
const currentError = ref<string | null>(null);
const replacementError = ref<string | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);
const email = ref('');

/** Asked for when re-authenticating with the new password needs the authenticator code again. */
const RENEW_CODE = 'Your password is changed. To stay signed in, enter a new code from your authenticator app.';
/** Identity Platform's answers to a wrong current password. */
const WRONG_PASSWORD = new Set(['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/wrong-password']);

function clearMessages() {
  currentError.value = null;
  replacementError.value = null;
  error.value = null;
  notice.value = null;
}

watch(open, () => {
  current.value = '';
  replacement.value = '';
  email.value = auth.currentUser?.email ?? '';
  clearMessages();
});

async function save() {
  const user = auth.currentUser;
  if (!user) return;
  clearMessages();
  if (!current.value) {
    currentError.value = 'Enter your current password.';
    return;
  }
  if (replacement.value === current.value) {
    replacementError.value = 'That is your current password. Choose a new one.';
    return;
  }
  busy.value = true;
  try {
    const outcome = await changePassword(user, current.value, replacement.value, (password, step) =>
      confirmPassword(user, password, step === 'renew' ? RENEW_CODE : undefined),
    );
    if (outcome === 'cancelled') return;
    open.value = false;
    emit('changed', outcome === 'sign-in-again');
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    if (e instanceof PasswordRejected) replacementError.value = e.message;
    else if (typeof code === 'string' && WRONG_PASSWORD.has(code)) currentError.value = 'That is not your current password.';
    else error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

/** For a forgotten password, or a login that signs in with email links and has none yet. */
async function emailResetLink() {
  clearMessages();
  busy.value = true;
  try {
    await sendPasswordReset(auth, email.value);
    notice.value = `We have emailed ${email.value} a link to choose a new password. The link works once, for an hour.`;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <q-dialog v-model="open" persistent aria-labelledby="change-password-title">
    <q-card class="ustp-dialog">
      <q-card-section>
        <h2 id="change-password-title" class="text-h6">Change password</h2>
        <div class="text-caption text-grey-7">For {{ email }}. Changing it signs this login out everywhere else.</div>
      </q-card-section>
      <q-form @submit.prevent="save">
        <q-card-section class="ustp-form">
          <!-- For password managers, so they save the new password under the right login. -->
          <input type="email" name="username" autocomplete="username" :value="email" hidden readonly />
          <PasswordInput
            v-model="current"
            label="Current password"
            outlined
            dense
            autofocus
            autocomplete="current-password"
            :error="!!currentError"
            :error-message="currentError ?? undefined"
          />
          <PasswordInput
            v-model="replacement"
            label="New password"
            outlined
            dense
            autocomplete="new-password"
            :hint="PASSWORD_HINT"
            :error="!!replacementError"
            :error-message="replacementError ?? undefined"
          />
          <div class="text-caption">
            Forgotten it, or never had one because you sign in with email links?
            <q-btn
              flat
              dense
              no-caps
              color="primary"
              label="Email me a link to choose one"
              :disable="busy"
              @click="emailResetLink"
            />
          </div>
          <q-banner v-if="error" class="bg-negative text-white" rounded>{{ error }}</q-banner>
          <q-banner v-if="notice" class="bg-positive text-white" rounded role="status">{{ notice }}</q-banner>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat label="Cancel" :disable="busy" />
          <q-btn type="submit" color="primary" label="Change password" :loading="busy" />
        </q-card-actions>
      </q-form>
    </q-card>
  </q-dialog>
</template>
