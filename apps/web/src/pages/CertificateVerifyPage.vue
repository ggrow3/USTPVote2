<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CERTIFICATE_ISSUER, certificateDate, certificatePagePath, type CertificateVerification, type Shareable } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api, errorMessage } from '../api.js';
import { APP_NAME } from '../app-name.js';
import ShareButtons from '../communications/ShareButtons.vue';

/**
 * A course certificate's public page (design §10.8, "Sharing a certificate"), at the address its QR code, its PDF and
 * LinkedIn link to: valid or not, which course and when, the holder's name only while they show it, share buttons and
 * the course for anyone to take. Search engines never list it; its link preview comes from the api (§15).
 */
const route = useRoute();
const router = useRouter();
const verification = ref<CertificateVerification | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
const certificateId = ref('');

const valid = computed(() => (verification.value?.valid ? verification.value : null));
usePageTitle(() => (valid.value?.courseTitle ? `Certificate: ${valid.value.courseTitle}` : 'Verify course certificate'));

const share = computed<Shareable | null>(() => {
  const found = valid.value;
  if (!found?.courseTitle) return null;
  return {
    title: `Certificate: ${found.courseTitle}`,
    text: `${found.holderName ? `${found.holderName} completed` : 'Completed:'} "${found.courseTitle}", a free course from the ${CERTIFICATE_ISSUER}.`,
    url: `${location.origin}${certificatePagePath(certificateId.value)}`,
    hashtags: ['Transhumanism'],
  };
});

async function load(id: string) {
  verification.value = null;
  if (!id) return;
  loading.value = true;
  error.value = null;
  try {
    verification.value = await api<CertificateVerification>('GET', `/v1/public/certificates/${encodeURIComponent(id)}`);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

function verifyEntered() {
  const id = certificateId.value.trim();
  if (id) void router.push(certificatePagePath(id));
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
    <div style="max-width: 720px; margin: auto">
      <q-skeleton v-if="loading" type="rect" height="320px" class="q-mb-lg" />
      <template v-else-if="valid">
        <section class="certificate q-pa-lg q-mb-lg" aria-labelledby="certificate-title">
          <div class="certificate__seal" aria-hidden="true"><q-icon name="workspace_premium" size="44px" /></div>
          <div class="text-overline">{{ CERTIFICATE_ISSUER }} · {{ APP_NAME }}</div>
          <h1 id="certificate-title" class="text-h4 q-my-sm">Certificate of completion</h1>
          <p v-if="valid.holderName" class="certificate__name">{{ valid.holderName }}</p>
          <p class="text-body1 q-mb-xs">{{ valid.holderName ? 'completed' : 'This certifies the completion of' }}</p>
          <p class="certificate__course">
            <router-link :to="`/course/${valid.courseId}`">{{ valid.courseTitle }}</router-link>
          </p>
          <p class="text-body2 q-mb-md">Issued {{ certificateDate(valid.issuedAt!) }} · course version {{ valid.courseVersion }}</p>
          <q-chip color="positive" text-color="white" icon="verified" role="status">Valid certificate</q-chip>
          <div class="text-caption text-grey-8 q-mt-sm">Certificate {{ certificateId }}</div>
        </section>

        <q-card flat bordered class="q-mb-lg">
          <q-card-section>
            <h2 class="text-h6 q-mt-none q-mb-xs">Take this course yourself</h2>
            <p class="q-mb-md">{{ valid.courseTitle }} is free, and open to everyone. Pass every lesson's quiz to earn a certificate of your own.</p>
            <q-btn color="primary" no-caps unelevated icon="school" label="Start the course" :to="`/course/${valid.courseId}`" />
          </q-card-section>
          <q-separator />
          <q-card-section v-if="share">
            <div class="text-subtitle2 q-mb-xs">Share this certificate</div>
            <ShareButtons :item="share" />
          </q-card-section>
        </q-card>
      </template>

      <h2 v-if="valid" class="text-h6">Check another certificate</h2>
      <h1 v-else class="text-h4">Verify a course certificate</h1>
      <p>Enter a certificate number or scan the QR code from a course certificate. A holder's name shows only if they chose to show it.</p>
      <q-form class="row q-gutter-sm q-mb-lg" @submit.prevent="verifyEntered">
        <q-input v-model="certificateId" outlined class="col" label="Certificate number" autocomplete="off" />
        <q-btn type="submit" color="primary" no-caps label="Verify" :loading="loading" />
      </q-form>
      <q-banner v-if="error" class="bg-negative text-white" rounded role="alert">{{ error }}</q-banner>
      <q-banner v-else-if="verification && !verification.valid" rounded class="bg-orange-1 text-black" role="status">
        <strong>No active certificate found.</strong> It may be mistyped, revoked, or not issued by this site.
      </q-banner>
    </div>
  </q-page>
</template>

<style scoped>
.certificate {
  position: relative;
  text-align: center;
  background: linear-gradient(160deg, #fffdf7, #fff4dc);
  color: #1a1a1a;
  border: 3px double #b8860b;
  border-radius: 12px;
}
.certificate__seal {
  color: #b8860b;
}
.certificate__name {
  font-size: 2rem;
  font-weight: 700;
  margin: 4px 0;
}
.certificate__course {
  font-size: 1.4rem;
  font-weight: 600;
  margin-bottom: 8px;
}
.certificate__course a {
  color: #0b2948;
}
</style>
