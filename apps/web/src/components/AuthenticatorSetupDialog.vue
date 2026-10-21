<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue';
import { errorMessage } from '../api.js';
import { confirmIdentity } from '../dialogs.js';
import { auth, usingEmulators } from '../firebase.js';
import { beginAuthenticatorSetup, CODE_PATTERN, finishAuthenticatorSetup, type AuthenticatorSetup } from '../mfa.js';

const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ enrolled: [] }>();

// shallowRef: Firebase's TotpSecret is a class instance that must not be wrapped in a reactive proxy.
const setup = shallowRef<AuthenticatorSetup | null>(null);
const code = ref('');
const name = ref('Authenticator app');
const busy = ref(false);
const error = ref<string | null>(null);

function isRecentLoginError(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'auth/requires-recent-login';
}

/** Explains the setup failures an admin can actually run into. */
function setupError(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (usingEmulators) return 'The local Auth emulator does not support authenticator apps; try this against a real project.';
  if (code === 'auth/operation-not-allowed') {
    return 'Authenticator apps are not enabled for this project yet (Identity Platform multi-factor settings). Ask a System Admin.';
  }
  if (code === 'auth/unverified-email') return 'Verify your email address first.';
  return errorMessage(e);
}

/** Runs a step that Firebase may refuse until the user re-authenticates; retries once after they do. */
async function withRecentLogin<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    if (!isRecentLoginError(e) || !(await confirmIdentity())) throw e;
    return step();
  }
}

watch(open, async (isOpen) => {
  setup.value = null;
  code.value = '';
  error.value = null;
  if (!isOpen || !auth.currentUser) return;
  busy.value = true;
  try {
    setup.value = await withRecentLogin(() => beginAuthenticatorSetup(auth.currentUser!));
  } catch (e) {
    error.value = setupError(e);
  } finally {
    busy.value = false;
  }
});

async function finish() {
  if (!setup.value || !auth.currentUser) return;
  if (!CODE_PATTERN.test(code.value.trim())) {
    error.value = 'Enter the 6-digit code your app shows.';
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await withRecentLogin(() => finishAuthenticatorSetup(auth.currentUser!, setup.value!, code.value, name.value || 'Authenticator app'));
    open.value = false;
    emit('enrolled');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <q-dialog v-model="open" persistent>
    <q-card style="width: 420px; max-width: 95vw">
      <q-card-section class="text-h6">Set up an authenticator app</q-card-section>
      <q-card-section v-if="busy && !setup" class="row justify-center"><q-spinner size="lg" /></q-card-section>
      <q-card-section v-if="setup" class="q-gutter-md">
        <div>
          1. In an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, …), scan this code.
        </div>
        <div class="row justify-center">
          <img :src="setup.qrDataUrl" alt="QR code for your authenticator app" width="200" height="200" />
        </div>
        <div class="text-caption">
          Can't scan it? Enter this key instead: <code style="word-break: break-all">{{ setup.key }}</code>
        </div>
        <div>2. Enter the 6-digit code the app shows.</div>
        <q-input v-model="code" outlined dense inputmode="numeric" autocomplete="one-time-code" maxlength="6" label="Code" />
        <q-input v-model="name" outlined dense label="Name for this device" />
      </q-card-section>
      <q-banner v-if="error" class="bg-negative text-white q-mx-md" rounded>{{ error }}</q-banner>
      <q-card-actions align="right">
        <q-btn v-close-popup flat label="Cancel" :disable="busy" />
        <q-btn color="primary" label="Turn on" :loading="busy && !!setup" :disable="!setup" @click="finish" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
