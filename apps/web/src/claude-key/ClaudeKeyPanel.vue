<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { checkAnthropicKey, type AnthropicKeyStatus } from 'ustp-domain';
import { announce, focusFirstInvalid, focusSoon } from '../a11y.js';
import { errorMessage } from '../api.js';
import { attempt, dialog } from '../dialogs.js';
import { addAnthropicKey, anthropicKeyStatus, removeAnthropicKey } from './api.js';
import {
  asSentence,
  CHECK_NAMES,
  INTRO,
  keyStatusText,
  REMOVE_CONFIRM,
  savedAnnouncement,
  switchText,
  triedText,
  type ClaudeCheck,
} from './claude-key-text.js';

/**
 * Admin › API keys (design §5.6): a System Admin adds, replaces or removes the Anthropic API key the Claude checks use,
 * and sees how each check is switched. The key is typed into a password field, sent once, and never shown again.
 */
const status = ref<AnthropicKeyStatus | null>(null);
const key = ref('');
const error = ref('');
const saving = ref(false);
const CHECKS = Object.keys(CHECK_NAMES) as ClaudeCheck[];

async function load() {
  await attempt(async () => {
    status.value = await anthropicKeyStatus();
  });
}
onMounted(load);

async function save() {
  const pasted = key.value.trim();
  const checked = pasted ? checkAnthropicKey(pasted) : ({ ok: false, reason: 'paste the key first' } as const);
  if (!checked.ok) {
    error.value = asSentence(checked.reason);
    await focusFirstInvalid();
    return;
  }
  error.value = '';
  saving.value = true;
  try {
    status.value = await addAnthropicKey(pasted);
    key.value = '';
    announce(savedAnnouncement(status.value));
    await focusSoon('#claude-key-status');
  } catch (e) {
    error.value = asSentence(errorMessage(e));
    await focusFirstInvalid();
  } finally {
    saving.value = false;
  }
}

function remove() {
  dialog({
    title: 'Remove the Anthropic API key?',
    message: REMOVE_CONFIRM,
    cancel: true,
    focus: 'cancel',
    ok: { label: 'Remove the key', color: 'negative', noCaps: true },
  }).onOk(async () => {
    const ok = await attempt(async () => {
      status.value = await removeAnthropicKey();
    });
    if (ok) {
      announce('Key removed.');
      await focusSoon('#claude-key-status');
    }
  });
}
</script>

<template>
  <q-card v-if="status" flat bordered tag="section" aria-labelledby="claude-key-heading">
    <q-card-section>
      <h2 id="claude-key-heading" class="text-subtitle1">Anthropic API key</h2>
      <div class="text-caption text-grey-7">{{ INTRO }}</div>
    </q-card-section>

    <q-card-section class="q-pt-none ustp-stack">
      <p id="claude-key-status" tabindex="-1" class="claude-key-status">
        <q-icon :name="status.set ? 'key' : 'key_off'" size="20px" aria-hidden="true" class="q-mr-xs" />{{ keyStatusText(status) }}
      </p>
      <dl class="ustp-facts">
        <template v-for="c in CHECKS" :key="c">
          <dt>{{ CHECK_NAMES[c] }}</dt>
          <dd>{{ switchText(c, status.checks[c], status.set) }}</dd>
        </template>
      </dl>
    </q-card-section>

    <q-card-section class="q-pt-none">
      <form class="ustp-form" novalidate @submit.prevent="save">
        <q-input
          v-model="key"
          outlined
          dense
          type="password"
          name="anthropic-api-key"
          autocomplete="off"
          spellcheck="false"
          :label="status.set ? 'New key, to replace the one in use' : 'Anthropic API key'"
          :hint="`Starts with sk-ant-. Create one in Anthropic's Console under API keys. ${triedText(status.tried)}`"
          :error="!!error"
          :error-message="error"
          :disable="saving"
        />
        <div class="ustp-actions">
          <q-btn type="submit" color="primary" no-caps :loading="saving" :label="status.set ? 'Replace the key' : 'Save the key'" />
          <q-btn v-if="status.set" flat color="negative" no-caps label="Remove the key" :disable="saving" @click="remove" />
        </div>
      </form>
    </q-card-section>
  </q-card>
</template>

<style scoped>
.claude-key-status {
  display: flex;
  align-items: flex-start;
  outline-offset: 4px;
}
</style>
