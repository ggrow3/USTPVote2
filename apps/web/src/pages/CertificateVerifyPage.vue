<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { CertificateVerification } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api, errorMessage } from '../api.js';

const route = useRoute();
const router = useRouter();
const verification = ref<CertificateVerification | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
const certificateId = ref('');
usePageTitle('Verify course certificate');

async function load(id: string) {
  if (!id) return;
  loading.value = true;
  error.value = null;
  try {
    verification.value = await api<CertificateVerification>('GET', `/v1/public/certificates/${encodeURIComponent(id)}`);
  } catch (e) {
    verification.value = null;
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

function verifyEntered() {
  const id = certificateId.value.trim();
  if (id) void router.push(`/course/certificates/${encodeURIComponent(id)}`);
}

watch(
  () => String(route.params.id ?? ''),
  (id) => {
    certificateId.value = id;
    void load(id);
  },
  { immediate: true },
);
</script>

<template>
  <q-page padding>
    <div style="max-width: 640px; margin: auto">
      <h1 class="text-h4">Verify a course certificate</h1>
      <p>Enter a certificate number or scan the QR code from a course certificate. Verification never reveals a learner’s name.</p>
      <q-form class="row q-gutter-sm q-mb-lg" @submit.prevent="verifyEntered">
        <q-input v-model="certificateId" outlined class="col" label="Certificate number" autocomplete="off" />
        <q-btn type="submit" color="primary" no-caps label="Verify" :loading="loading" />
      </q-form>
      <q-banner v-if="error" class="bg-negative text-white" rounded>{{ error }}</q-banner>
      <q-banner v-else-if="verification" rounded :class="verification.valid ? 'bg-green-1 text-black' : 'bg-orange-1 text-black'" role="status">
        <template v-if="verification.valid">
          <strong>Valid certificate.</strong> {{ verification.courseTitle }} · version {{ verification.courseVersion }} · completed {{ new Date(verification.issuedAt!).toLocaleDateString() }}.
        </template>
        <template v-else><strong>No active certificate found.</strong> It may be mistyped, revoked, or not issued by this site.</template>
      </q-banner>
    </div>
  </q-page>
</template>

