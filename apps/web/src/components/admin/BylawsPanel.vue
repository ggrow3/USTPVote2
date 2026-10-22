<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { publishBylawsSchema, type BylawsRecord } from 'ustp-domain';
import { api } from '../../api.js';
import { focusFirstInvalid } from '../../a11y.js';
import { attempt } from '../../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../../forms.js';

const current = ref<BylawsRecord | null>(null);
const form = reactive({ version: '', title: 'USTP Bylaws', text: '' });
const errors = ref<FieldErrors>({});

async function load() {
  current.value = await api<BylawsRecord>('GET', '/v1/bylaws/current').catch(() => null);
}

async function publish() {
  const checked = validate(publishBylawsSchema, form);
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  errors.value = {};
  const ok = await attempt(async () => {
    try {
      await api('POST', '/v1/admin/bylaws', checked.data);
    } catch (e) {
      errors.value = apiFieldErrors(e);
      throw e;
    }
  }, `Bylaws ${form.version} published`);
  if (ok) {
    form.version = '';
    form.text = '';
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div class="column q-gutter-md" style="max-width: 760px">
    <q-card flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">Current bylaws</h2>
        <div v-if="current" class="text-grey-7">
          {{ current.title }} · version {{ current.version }} · published
          {{ new Date(current.publishedAt).toLocaleDateString() }} · SHA-256 <code>{{ current.contentHash }}</code>
        </div>
        <div v-else class="text-grey-7">None published yet. Applications cannot be submitted until one is.</div>
      </q-card-section>
    </q-card>

    <q-card flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">Publish a new version</h2>
        <div class="text-caption text-grey-7">
          Versions are permanent and recorded in the audit ledger. New applications must agree to the newest version.
        </div>
      </q-card-section>
      <q-form class="q-px-md q-pb-md q-gutter-md" @submit.prevent="publish">
        <q-input v-model="form.version" outlined dense label="Version (e.g. 2026.1)" :error="!!errors.version" :error-message="errors.version" />
        <q-input v-model="form.title" outlined dense label="Title" :error="!!errors.title" :error-message="errors.title" />
        <q-input
          v-model="form.text"
          outlined
          type="textarea"
          rows="10"
          label="Full text"
          :error="!!errors.text"
          :error-message="errors.text"
        />
        <q-btn type="submit" color="primary" label="Publish" />
      </q-form>
    </q-card>
  </div>
</template>
