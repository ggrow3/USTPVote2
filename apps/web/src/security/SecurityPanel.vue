<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  ANALYTICS_EXCLUDED_PATHS,
  describeUserAgent,
  MEASUREMENT_ID_PATTERN,
  SIGN_IN_LOG_MAX,
  SIGN_IN_LOG_PERIODS,
  SIGN_IN_RETENTION_DAYS,
  type SignInLog,
  type SiteAnalyticsRecord,
} from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { usingEmulators } from '../firebase.js';
import { hasRole } from '../session.js';
import { saveSiteAnalytics, signInLog, siteAnalyticsSettings } from './api.js';
import PageVisitsSection from './PageVisitsSection.vue';
import {
  filterSignIns,
  identityLogsUrl,
  methodLabel,
  newAddressIds,
  signInsCsv,
  signInsCsvFileName,
  summarizeSignIns,
} from './sign-ins.js';

/**
 * Sign-in traffic and site analytics (design §10.7): System Admins and Auditors read the log and the page visits;
 * System Admins set Google Analytics.
 */

const days = ref<number>(30);
const log = ref<SignInLog | null>(null);
const loading = ref(false);
const search = ref('');

const shown = computed(() => (log.value ? filterSignIns(log.value.signIns, search.value) : []));
const summary = computed(() => summarizeSignIns(shown.value));
const flagged = computed(() => (log.value ? newAddressIds(log.value.signIns) : new Set<string>()));
const periodOptions = SIGN_IN_LOG_PERIODS.map((d) => ({ value: d, label: d === 1 ? 'Last 24 hours' : `Last ${d} days` }));
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;

async function loadLog() {
  loading.value = true;
  await attempt(async () => {
    log.value = await signInLog(days.value);
  });
  loading.value = false;
}
watch(days, loadLog);

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

function exportCsv() {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob(['﻿', signInsCsv(shown.value)], { type: 'text/csv;charset=utf-8' }));
  link.href = url;
  link.download = signInsCsvFileName(new Date());
  link.click();
  URL.revokeObjectURL(url);
}

// --- Google Analytics (System Admins) ---
const isSystemAdmin = computed(() => hasRole('system_admin'));
const analytics = ref<SiteAnalyticsRecord | null>(null);
const measurementId = ref('');
const draftId = computed(() => measurementId.value.trim().toUpperCase() || null);
const idError = computed(() => (draftId.value && !MEASUREMENT_ID_PATTERN.test(draftId.value) ? 'Looks like G-ABC123XYZ9' : undefined));
const analyticsChanged = computed(() => !!analytics.value && draftId.value !== analytics.value.measurementId);

async function loadAnalytics() {
  await attempt(async () => {
    analytics.value = await siteAnalyticsSettings();
    measurementId.value = analytics.value.measurementId ?? '';
  });
}

async function saveAnalytics(id: string | null) {
  if (!analytics.value) return;
  await attempt(
    async () => {
      analytics.value = await saveSiteAnalytics({ basedOn: analytics.value!.version, measurementId: id });
      measurementId.value = analytics.value.measurementId ?? '';
    },
    id ? 'Saved. Pages load Google Analytics from their next visit.' : 'Google Analytics is off.',
  );
}

onMounted(() => {
  void loadLog();
  if (isSystemAdmin.value) void loadAnalytics();
});
</script>

<template>
  <div class="ustp-content">
    <section class="ustp-content" aria-labelledby="sign-ins-title">
      <div>
        <h2 id="sign-ins-title" class="text-subtitle1">Sign-ins</h2>
        <div class="text-caption text-grey-7">
          Kept {{ SIGN_IN_RETENTION_DAYS }} days, then deleted. Never in the public ledger.
        </div>
      </div>
      <p>
        Each time someone signs in, or confirms it is them before an approval, the api records who it was, how they
        signed in, the address the request came from and their browser. The address is the one Firebase Hosting
        reported; the whole forwarded chain is in the CSV. Failed attempts never reach the api:
        <template v-if="!usingEmulators && projectId">
          they are in
          <a :href="identityLogsUrl(projectId)" target="_blank" rel="noopener">Identity Platform's request logs</a>
          in Cloud Logging, with every successful one, for those with access to the project.
        </template>
        <template v-else>they are in Identity Platform's request logs in Cloud Logging, outside the emulators.</template>
      </p>

      <div class="row q-col-gutter-sm items-end">
        <div class="col-12 col-sm-4">
          <q-select v-model="days" :options="periodOptions" emit-value map-options outlined dense label="Period" />
        </div>
        <div class="col-12 col-sm-5">
          <q-input v-model="search" outlined dense clearable label="Search email, account, address, method or browser" />
        </div>
        <div class="col-12 col-sm-3 row q-gutter-sm justify-end">
          <q-btn flat round icon="refresh" aria-label="Reload the sign-ins" :loading="loading" @click="loadLog" />
          <q-btn outline no-caps icon="file_download" :disable="!shown.length" @click="exportCsv">Export CSV</q-btn>
        </div>
      </div>

      <div v-if="log" class="row q-gutter-md text-body2" role="status">
        <span>{{ plural(summary.signIns, 'sign-in') }}</span>
        <span>{{ plural(summary.people, 'login') }}</span>
        <span>{{ summary.addresses === 1 ? '1 address' : `${summary.addresses} addresses` }}</span>
        <span>{{ summary.withMfa }} with two-step</span>
      </div>
      <q-banner v-if="log?.truncated" class="bg-orange-2 text-black" rounded>
        More than {{ SIGN_IN_LOG_MAX }} sign-ins in this period: only the newest are shown. Pick a shorter period.
      </q-banner>

      <q-markup-table v-if="log" flat bordered dense wrap-cells class="sign-ins">
        <caption class="sr-only">Sign-ins, newest first</caption>
        <thead>
          <tr>
            <th scope="col" class="text-left">When</th>
            <th scope="col" class="text-left">Who</th>
            <th scope="col" class="text-left">Method</th>
            <th scope="col" class="text-left">Two-step</th>
            <th scope="col" class="text-left">IP address</th>
            <th scope="col" class="text-left">Browser</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in shown" :key="r.id">
            <td>{{ when(r.signedInAt) }}</td>
            <td>
              {{ r.email ?? 'No email' }}
              <div v-if="!r.accountId" class="text-caption text-grey-7">No account yet</div>
            </td>
            <td>{{ methodLabel(r.provider) }}</td>
            <td>{{ r.mfa ? 'Yes' : 'No' }}</td>
            <td>
              <code>{{ r.ip ?? 'Unknown' }}</code>
              <q-badge v-if="flagged.has(r.id)" color="orange-3" text-color="black" class="q-ml-xs">New for this login</q-badge>
            </td>
            <td :title="r.userAgent ?? undefined">{{ describeUserAgent(r.userAgent) }}</td>
          </tr>
          <tr v-if="!shown.length">
            <td colspan="6" class="text-grey-7">No sign-ins {{ search ? 'match the search' : 'in this period' }}.</td>
          </tr>
        </tbody>
      </q-markup-table>
    </section>

    <PageVisitsSection />

    <section v-if="isSystemAdmin" class="ustp-content" aria-labelledby="analytics-title">
      <div>
        <h2 id="analytics-title" class="text-subtitle1">Google Analytics</h2>
        <div class="text-caption text-grey-7">
          <template v-if="analytics?.measurementId">On: {{ analytics.measurementId }}.</template>
          <template v-else-if="analytics">Off.</template>
        </div>
      </div>
      <p>
        With a Google Analytics 4 measurement ID, the site's public pages report page views to Google Analytics. Pages
        under {{ ANALYTICS_EXCLUDED_PATHS.join(', ') }} never load it, so it sees nothing of ballots, receipts,
        signing in, accounts or the admin console. It never receives who someone is, and browsers that send Global
        Privacy Control are left out. Google Analytics 4 does not keep IP addresses; the sign-in log above does.
      </p>
      <q-card v-if="analytics" flat bordered>
        <q-card-section class="ustp-form">
          <q-input
            v-model="measurementId"
            outlined
            dense
            label="Measurement ID"
            hint="From Google Analytics: Admin › Data streams › your web stream. Empty switches it off."
            :error="!!idError"
            :error-message="idError"
          />
        </q-card-section>
        <q-card-section class="ustp-actions">
          <q-btn color="primary" label="Save" :disable="!analyticsChanged || !!idError" @click="saveAnalytics(draftId)" />
          <q-btn flat color="primary" label="Switch off" :disable="!analytics.measurementId" @click="saveAnalytics(null)" />
        </q-card-section>
      </q-card>
    </section>
  </div>
</template>

<style scoped>
.sign-ins {
  max-height: 70vh;
  overflow: auto;
}
.sign-ins code {
  font-size: 0.9em;
  word-break: break-all;
}
</style>
