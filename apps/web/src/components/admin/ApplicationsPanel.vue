<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ageOn, type ApplicationRecord, type ApplicationStatus } from 'ustp-domain';
import { api } from '../../api.js';
import { askReason, attempt } from '../../dialogs.js';
import { session } from '../../session.js';

const status = ref<ApplicationStatus>('pending');
const rows = ref<ApplicationRecord[]>([]);
const loading = ref(false);
/** An empty list only means "none" once a load has succeeded. */
const listState = ref<'loading' | 'ready' | 'failed'>('loading');

async function load() {
  loading.value = true;
  const ok = await attempt(async () => {
    rows.value = await api<ApplicationRecord[]>('GET', `/v1/admin/applications?status=${status.value}`);
  });
  listState.value = ok ? 'ready' : 'failed';
  loading.value = false;
}

async function decide(app: ApplicationRecord, decision: 'approve' | 'reject') {
  const reason = await askReason(
    decision === 'approve' ? 'Approve application' : 'Reject application',
    `${app.legalName} (${app.state}). A written reason is required and is recorded in the audit ledger` +
      (decision === 'reject' ? '; the applicant sees it.' : '.'),
  );
  if (reason === null) return;
  const ok = await attempt(
    () => api('POST', `/v1/admin/applications/${app.applicationId}/decision`, { decision, reason }),
    decision === 'approve' ? `${app.legalName} is now a member` : 'Application rejected',
  );
  if (ok) rows.value = rows.value.filter((r) => r.applicationId !== app.applicationId);
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <div class="ustp-toolbar">
      <q-btn-toggle
        v-model="status"
        no-caps
        toggle-color="primary"
        role="group"
        aria-label="Show applications"
        :options="[
          { label: 'Pending', value: 'pending' },
          { label: 'Approved', value: 'approved' },
          { label: 'Rejected', value: 'rejected' },
        ]"
        @update:model-value="load"
      />
      <q-btn flat dense icon="refresh" aria-label="Refresh applications" :loading="loading" @click="load" />
    </div>
    <div v-if="listState === 'failed'" class="text-grey-7">Could not load applications.</div>
    <div v-else-if="listState === 'ready' && !rows.length" class="text-grey-7">No {{ status }} applications.</div>
    <q-list v-else-if="rows.length" bordered separator>
      <q-item v-for="a in rows" :key="a.applicationId">
        <q-item-section>
          <q-item-label>
            {{ a.legalName }}<span v-if="a.preferredName"> ({{ a.preferredName }})</span> · {{ a.state }}
          </q-item-label>
          <q-item-label v-if="a.contact" caption>
            {{ a.contact.city }} {{ a.contact.postalCode }}<span v-if="a.contact.phone"> · {{ a.contact.phone }}</span>
            <span v-if="a.dateOfBirth"> · born {{ a.dateOfBirth }} (age {{ ageOn(a.dateOfBirth, new Date()) }})</span>
          </q-item-label>
          <q-item-label v-if="a.attestations" caption>
            Confirmed: at least {{ a.attestations.minimumAge }}, supports the platform<span v-if="a.volunteer"> · wants to volunteer</span
            ><span v-if="a.runForOffice"> · interested in running for office</span>
          </q-item-label>
          <q-item-label caption>
            Submitted {{ new Date(a.submittedAt).toLocaleString() }} · bylaws {{ a.bylawsVersion }} · account
            <code>{{ a.accountId }}</code>
          </q-item-label>
          <q-item-label v-if="a.statement" class="q-mt-xs" style="white-space: pre-wrap">{{ a.statement }}</q-item-label>
          <q-item-label v-if="a.interests" class="q-mt-xs" style="white-space: pre-wrap">Interests: {{ a.interests }}</q-item-label>
          <q-item-label v-if="a.skills" class="q-mt-xs" style="white-space: pre-wrap">Skills: {{ a.skills }}</q-item-label>
          <q-item-label v-if="a.referral" caption class="q-mt-xs">Heard about USTP: {{ a.referral }}</q-item-label>
          <q-item-label v-if="a.decisionReason" caption class="q-mt-xs">Decision: {{ a.decisionReason }}</q-item-label>
        </q-item-section>
        <q-item-section v-if="a.status === 'pending'" side>
          <div class="ustp-actions">
            <q-btn
              dense
              color="positive"
              label="Approve"
              :disable="a.accountId === session.me?.account?.accountId"
              @click="decide(a, 'approve')"
            >
              <span class="sr-only">&nbsp;{{ a.legalName }}</span>
            </q-btn>
            <q-btn
              dense
              flat
              color="negative"
              label="Reject"
              :disable="a.accountId === session.me?.account?.accountId"
              @click="decide(a, 'reject')"
            >
              <span class="sr-only">&nbsp;{{ a.legalName }}</span>
            </q-btn>
          </div>
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>
