<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ageOn, placeText, queueSummaryText, waitingDays, waitsLong, waitText, type ApplicationRecord, type ApplicationStatus } from 'ustp-domain';
import { askReason, attempt } from '../dialogs.js';
import { session } from '../session.js';
import { applications, decideApplication } from './api.js';
import JoinFunnelCard from './JoinFunnelCard.vue';
import { applicationQueue, refreshApplicationQueue } from './queue.js';
import { answerText, localityText, memberClassText } from './member-text.js';

const status = ref<ApplicationStatus>('pending');
const rows = ref<ApplicationRecord[]>([]);

/** Where they live, their phone and their age, each only if given: an applicant outside the US may give none of the first. */
const contactLine = (a: ApplicationRecord) =>
  [
    localityText(a),
    a.contact?.phone,
    a.dateOfBirth ? `born ${a.dateOfBirth} (age ${ageOn(a.dateOfBirth, new Date())})` : null,
  ]
    .filter(Boolean)
    .join(' · ');
const loading = ref(false);
/** An empty list only means "none" once a load has succeeded. */
const listState = ref<'loading' | 'ready' | 'failed'>('loading');

async function load() {
  loading.value = true;
  const ok = await attempt(async () => {
    rows.value = await applications(status.value);
  });
  listState.value = ok ? 'ready' : 'failed';
  loading.value = false;
  now.value = new Date();
  void refreshApplicationQueue();
}

/** When the list was last loaded: waits are counted to then, so they do not change under the reader. */
const now = ref(new Date());
const waited = (a: ApplicationRecord) => waitText(waitingDays(a.submittedAt, now.value));

async function decide(app: ApplicationRecord, decision: 'approve' | 'reject') {
  const reason = await askReason(
    decision === 'approve' ? 'Approve application' : 'Reject application',
    `${app.legalName} (${placeText(app)}). A written reason is required and is recorded in the audit ledger` +
      (decision === 'reject' ? '; the applicant sees it.' : '.'),
  );
  if (reason === null) return;
  const ok = await attempt(
    () => decideApplication(app.applicationId, { decision, reason }),
    decision === 'approve' ? `${app.legalName} is now a member` : 'Application rejected',
  );
  if (ok) {
    rows.value = rows.value.filter((r) => r.applicationId !== app.applicationId);
    void refreshApplicationQueue();
  }
}

/** Which party email the applicant opted into. */
function partyEmail(a: ApplicationRecord): string {
  const chosen = [a.communications?.newsletter && 'newsletter', a.communications?.announcements && 'announcements'].filter(Boolean);
  return chosen.length ? chosen.join(' and ') : 'none';
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <JoinFunnelCard />
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
    <div v-if="status === 'pending' && applicationQueue.summary?.pending" class="text-body2" aria-live="polite">
      {{ queueSummaryText(applicationQueue.summary, now) }} Oldest first.
    </div>
    <div v-if="listState === 'failed'" class="text-grey-7">Could not load applications.</div>
    <div v-else-if="listState === 'ready' && !rows.length" class="text-grey-7">No {{ status }} applications.</div>
    <q-list v-else-if="rows.length" bordered separator>
      <q-item v-for="a in rows" :key="a.applicationId">
        <q-item-section>
          <q-item-label>
            <router-link :to="`/admin/members/${a.accountId}`">{{ a.legalName }}</router-link
            ><span v-if="a.preferredName"> ({{ a.preferredName }})</span> · {{ placeText(a) }}
            <q-badge
              v-if="a.status === 'pending'"
              :color="waitsLong(a.submittedAt, now) ? 'warning' : 'grey-7'"
              :text-color="waitsLong(a.submittedAt, now) ? 'black' : 'white'"
              class="q-ml-sm"
              :label="`Waiting ${waited(a)}`"
            />
          </q-item-label>
          <q-item-label v-if="a.contact && contactLine(a)" caption>{{ contactLine(a) }}</q-item-label>
          <q-item-label v-if="typeof a.usVoteEligible === 'boolean'" caption>
            {{ memberClassText(a.usVoteEligible) }} · agrees with the Core Ideals: {{ answerText(a.agreesWithCoreIdeals) }}
          </q-item-label>
          <q-item-label v-if="a.attestations" caption>
            Confirmed: at least {{ a.attestations.minimumAge }}<template v-if="a.attestations.supportsPlatform">, supports the platform</template
            ><span v-if="a.volunteer"> · wants to volunteer</span><span v-if="a.runForOffice"> · interested in running for office</span>
          </q-item-label>
          <q-item-label caption>
            Party email: {{ partyEmail(a) }}
          </q-item-label>
          <q-item-label caption>
            Submitted {{ new Date(a.submittedAt).toLocaleString() }} · {{ a.bylawsVersion ? `bylaws ${a.bylawsVersion}` : 'no bylaws in force' }} · account
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
