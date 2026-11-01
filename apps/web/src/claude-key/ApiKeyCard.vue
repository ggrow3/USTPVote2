<script setup lang="ts">
import { computed, ref } from 'vue';
import { checkApiKey, type ApiKeysStatus, type ApiKeyStatus } from 'ustp-domain';
import { announce, focusFirstInvalid, focusSoon } from '../a11y.js';
import { errorMessage } from '../api.js';
import { attempt, dialog } from '../dialogs.js';
import { addApiKey, removeApiKey } from './api.js';
import { apiKeyHintText, apiKeyStatusText, KEY_TITLES, KEY_USES, removeConfirmText } from './api-keys-text.js';
import { asSentence } from './claude-key-text.js';

/**
 * One public-records service's key under Admin › API keys (design §5.6): what it is for, which key is in use, and a
 * password field to add or replace the one added here, or remove it. The key is sent once and never shown again.
 */
const props = defineProps<{ status: ApiKeyStatus; tried: boolean }>();
const emit = defineEmits<{ changed: [status: ApiKeysStatus] }>();

const key = ref('');
const error = ref('');
const saving = ref(false);
const title = computed(() => KEY_TITLES[props.status.name]);
const use = computed(() => KEY_USES[props.status.name]);
const set = computed(() => props.status.source !== 'none');
const statusId = computed(() => `api-key-${props.status.name}-status`);

async function save() {
  const pasted = key.value.trim();
  const checked = pasted ? checkApiKey(props.status.name, pasted) : ({ ok: false, reason: 'paste the key first' } as const);
  if (!checked.ok) {
    error.value = asSentence(checked.reason);
    await focusFirstInvalid();
    return;
  }
  error.value = '';
  saving.value = true;
  try {
    const all = await addApiKey(props.status.name, pasted);
    key.value = '';
    emit('changed', all);
    const hint = all.keys.find((k) => k.name === props.status.name)?.hint;
    announce(hint ? `${title.value} saved. It ends in ${hint}.` : `${title.value} saved.`);
    await focusSoon(`#${statusId.value}`);
  } catch (e) {
    error.value = asSentence(errorMessage(e));
    await focusFirstInvalid();
  } finally {
    saving.value = false;
  }
}

function remove() {
  dialog({
    title: `Remove the ${title.value}?`,
    message: removeConfirmText(props.status),
    cancel: true,
    focus: 'cancel',
    ok: { label: 'Remove the key', color: 'negative', noCaps: true },
  }).onOk(async () => {
    const ok = await attempt(async () => {
      emit('changed', await removeApiKey(props.status.name));
    });
    if (ok) {
      announce(`${title.value} removed.`);
      await focusSoon(`#${statusId.value}`);
    }
  });
}
</script>

<template>
  <q-card flat bordered tag="section" :aria-labelledby="`api-key-${status.name}-heading`">
    <q-card-section>
      <h2 :id="`api-key-${status.name}-heading`" class="text-subtitle1">{{ title }}</h2>
      <div class="text-caption text-grey-7">
        {{ use.text }}
        <a :href="use.url" target="_blank" rel="noopener noreferrer">{{ use.where }}</a>.
      </div>
    </q-card-section>

    <q-card-section class="q-pt-none">
      <p :id="statusId" tabindex="-1" class="api-key-status">
        <q-icon :name="set ? 'key' : 'key_off'" size="20px" aria-hidden="true" class="q-mr-xs" />{{ apiKeyStatusText(status) }}
      </p>
    </q-card-section>

    <q-card-section class="q-pt-none">
      <form class="ustp-form" novalidate @submit.prevent="save">
        <q-input
          v-model="key"
          outlined
          dense
          type="password"
          :name="`api-key-${status.name}`"
          autocomplete="off"
          spellcheck="false"
          :label="status.source === 'app' ? 'New key, to replace the one added here' : title"
          :hint="apiKeyHintText(status.name, tried)"
          :error="!!error"
          :error-message="error"
          :disable="saving"
        />
        <div class="ustp-actions">
          <q-btn type="submit" color="primary" no-caps :loading="saving" :label="status.source === 'app' ? 'Replace the key' : 'Save the key'" />
          <q-btn v-if="status.source === 'app'" flat color="negative" no-caps label="Remove the key" :disable="saving" @click="remove" />
        </div>
      </form>
    </q-card-section>
  </q-card>
</template>

<style scoped>
.api-key-status {
  display: flex;
  align-items: flex-start;
  margin: 0;
  outline-offset: 4px;
}
</style>
