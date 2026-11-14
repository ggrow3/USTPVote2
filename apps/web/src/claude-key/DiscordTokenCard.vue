<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { checkDiscordToken, type DiscordTokenStatus } from 'ustp-domain';
import { announce, focusFirstInvalid, focusSoon } from '../a11y.js';
import { errorMessage } from '../api.js';
import { asSentence, TOKEN_INTRO, TOKEN_REMOVE_CONFIRM, TOKEN_WHERE, tokenStatusText, tokenTriedText } from '../communications/discord-text.js';
import { attempt, dialog } from '../dialogs.js';
import { addDiscordToken, discordTokenStatus, removeDiscordToken } from './api.js';

/**
 * Admin › API keys (design §10.18): a System Admin adds, replaces or removes the Discord bot's token. It is typed into
 * a password field, sent once, and never shown again.
 */
const status = ref<DiscordTokenStatus | null>(null);
const token = ref('');
const error = ref('');
const saving = ref(false);

onMounted(() =>
  attempt(async () => {
    status.value = await discordTokenStatus();
  }),
);

async function save() {
  const pasted = token.value.trim();
  const checked = pasted ? checkDiscordToken(pasted) : ({ ok: false, reason: 'paste the token first' } as const);
  if (!checked.ok) {
    error.value = asSentence(checked.reason);
    await focusFirstInvalid();
    return;
  }
  error.value = '';
  saving.value = true;
  try {
    status.value = await addDiscordToken(pasted);
    token.value = '';
    announce(status.value.hint ? `Token saved. It ends in ${status.value.hint}.` : 'Token saved.');
    await focusSoon('#discord-token-status');
  } catch (e) {
    error.value = asSentence(errorMessage(e));
    await focusFirstInvalid();
  } finally {
    saving.value = false;
  }
}

function remove() {
  dialog({
    title: "Remove the Discord bot's token?",
    message: TOKEN_REMOVE_CONFIRM,
    cancel: true,
    focus: 'cancel',
    ok: { label: 'Remove the token', color: 'negative', noCaps: true },
  }).onOk(async () => {
    const ok = await attempt(async () => {
      status.value = await removeDiscordToken();
    });
    if (ok) {
      announce('Token removed.');
      await focusSoon('#discord-token-status');
    }
  });
}
</script>

<template>
  <q-card v-if="status" flat bordered tag="section" aria-labelledby="discord-token-heading">
    <q-card-section>
      <h2 id="discord-token-heading" class="text-subtitle1">Discord bot token</h2>
      <div class="text-caption text-grey-7">{{ TOKEN_INTRO }}</div>
    </q-card-section>

    <q-card-section class="q-pt-none">
      <p id="discord-token-status" tabindex="-1" class="discord-token-status">
        <q-icon :name="status.unavailable ? 'warning' : status.set ? 'key' : 'key_off'" size="20px" aria-hidden="true" class="q-mr-xs" />{{ tokenStatusText(status) }}
      </p>
    </q-card-section>

    <q-card-section v-if="!status.unavailable" class="q-pt-none">
      <form class="ustp-form" novalidate @submit.prevent="save">
        <q-input
          v-model="token"
          outlined
          dense
          type="password"
          name="discord-bot-token"
          autocomplete="off"
          spellcheck="false"
          :label="status.set ? 'New token, to replace the one in use' : 'Discord bot token'"
          :hint="`${TOKEN_WHERE} ${tokenTriedText(status.tried)}`"
          :error="!!error"
          :error-message="error"
          :disable="saving"
        />
        <div class="ustp-actions">
          <q-btn type="submit" color="primary" no-caps :loading="saving" :label="status.set ? 'Replace the token' : 'Save the token'" />
          <q-btn v-if="status.set" flat color="negative" no-caps label="Remove the token" :disable="saving" @click="remove" />
        </div>
      </form>
    </q-card-section>
  </q-card>
</template>

<style scoped>
.discord-token-status {
  display: flex;
  align-items: flex-start;
  outline-offset: 4px;
}
</style>
