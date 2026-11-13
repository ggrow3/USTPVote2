<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CERTIFICATE_ISSUER, type CertificateSettingsRecord } from 'ustp-domain';
import { api } from '../api.js';
import { attempt } from '../dialogs.js';

/**
 * The party's LinkedIn organization for course certificates (design §10.8, "Sharing a certificate"), set by System and
 * Site Admins: with it, LinkedIn's Add to profile names the party with its page and logo; without, by name only.
 */
const saved = ref<CertificateSettingsRecord | null>(null);
const id = ref('');
const busy = ref(false);
const problem = computed(() => (id.value.trim() && !/^\d{1,20}$/.test(id.value.trim()) ? 'The digits of the organization ID, nothing else' : null));
const changed = computed(() => (id.value.trim() || null) !== (saved.value?.linkedInOrganizationId ?? null));

onMounted(() =>
  attempt(async () => {
    saved.value = await api<CertificateSettingsRecord>('GET', '/v1/admin/certificate-settings');
    id.value = saved.value.linkedInOrganizationId ?? '';
  }),
);

async function save() {
  if (problem.value || !changed.value) return;
  busy.value = true;
  try {
    await attempt(async () => {
      saved.value = await api<CertificateSettingsRecord>('PUT', '/v1/admin/certificate-settings', { linkedInOrganizationId: id.value.trim() || null });
      id.value = saved.value.linkedInOrganizationId ?? '';
    }, 'Saved');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <q-card flat bordered>
    <q-card-section>
      <h2 class="text-subtitle1 q-my-none">Course certificates on LinkedIn</h2>
      <p class="text-caption text-grey-8 q-mb-md">
        Learners add their certificates to their LinkedIn profiles with one button. LinkedIn names the issuer by the party's
        organization ID, with its page and logo; without one it shows the words "{{ CERTIFICATE_ISSUER }}". The ID is the
        number in the address of the party's LinkedIn page as its admins see it (linkedin.com/company/<em>12345678</em>/admin).
      </p>
      <q-form class="row items-start q-gutter-sm" @submit.prevent="save">
        <q-input
          v-model="id"
          outlined
          dense
          class="col"
          label="LinkedIn organization ID"
          inputmode="numeric"
          :error="!!problem"
          :error-message="problem ?? undefined"
          hint="Leave empty to name the party in words."
        />
        <q-btn type="submit" color="primary" no-caps label="Save" :disable="!changed || !!problem" :loading="busy" />
      </q-form>
    </q-card-section>
  </q-card>
</template>
