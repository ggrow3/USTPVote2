<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { usePageTitle } from '../a11y.js';
usePageTitle('Verify Academy Certificate');
function printCertificate() { window.print(); }
const route = useRoute();
const loading = ref(true);
const result = ref<{valid:boolean;certificateId?:string;learnerName?:string;courseTitle?:string;courseVersion?:number;issuedAt?:string}>({valid:false});
watch(() => route.params.id, async id => {
  loading.value = true; result.value = {valid:false};
  try { result.value = await api('GET', '/v1/academy/certificates/verify/' + encodeURIComponent(String(id))); }
  catch { result.value = {valid:false}; }
  finally { loading.value = false; }
}, {immediate:true});
</script>
<template>
  <q-page padding class="certificate-page">
    <div class="certificate-wrapper">
      <q-btn class="no-print" flat icon="arrow_back" to="/academy" label="Back to Academy" />
      <q-spinner v-if="loading" size="36px" aria-label="Verifying certificate" />
      <q-card v-else-if="result.valid" bordered flat class="certificate">
        <q-card-section class="text-center">
          <div class="text-overline">Transhumanism Academy</div>
          <q-icon name="workspace_premium" color="deep-orange" size="64px" />
          <h1>Certificate of Completion</h1>
          <p>This certifies that</p>
          <h2>{{ result.learnerName }}</h2>
          <p>has completed all required lessons and passed all knowledge checks for</p>
          <h3>{{ result.courseTitle }}</h3>
          <p>Course version {{ result.courseVersion }} · Issued {{ result.issuedAt?.slice(0,10) }}</p>
          <p class="text-caption">Certificate ID: {{ result.certificateId }}</p>
          <p class="text-caption">Verify at this page's public URL. This certificate confirms completion of an introductory educational course, not professional accreditation.</p>
        </q-card-section>
      </q-card>
      <q-banner v-else class="bg-red-1 text-negative" role="status">Certificate not found, invalid, or revoked.</q-banner>
      <q-btn v-if="result.valid" class="no-print q-mt-md" color="deep-orange" icon="print" label="Print / Save as PDF" @click="printCertificate" />
    </div>
  </q-page>
</template>
<style scoped>
.certificate-wrapper { max-width: 900px; margin: 0 auto; }
.certificate { padding: 42px 20px; border: 8px double #b26b2c; }
.certificate h1 { font-size: clamp(2rem,5vw,3rem); line-height: 1.2; }
.certificate h2 { font-size: 2rem; }
.certificate h3 { font-size: 1.5rem; }
@media print { .no-print { display: none !important; } .certificate-page { padding: 0; } .certificate { break-inside: avoid; } }
</style>
