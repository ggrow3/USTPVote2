<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { ApprovalRequestRecord } from 'ustp-domain';
import { api } from '../../api.js';
import { aRole, describeRequest, reviewLink } from '../../approval-text.js';
import { askReason, attempt } from '../../dialogs.js';
import { hasRole, session } from '../../session.js';

const pending = ref<ApprovalRequestRecord[]>([]);
/** An empty list only means "nothing pending" once a load has succeeded. */
const listState = ref<'loading' | 'ready' | 'failed'>('loading');
const me = computed(() => session.me?.account?.accountId);

/** Why the current admin cannot decide a request, mirroring the server's two-person checks (design §10.2). */
function blocker(r: ApprovalRequestRecord): string | null {
  if (r.requestedBy === me.value) return 'You requested this; another admin must decide.';
  if (r.subject === me.value) return 'This affects your own account.';
  if (!hasRole(r.approverRole)) return `Needs ${aRole(r.approverRole)} to decide.`;
  return null;
}

const describe = describeRequest;

async function load() {
  const ok = await attempt(async () => {
    pending.value = await api<ApprovalRequestRecord[]>('GET', '/v1/admin/approvals?status=pending');
  });
  listState.value = ok ? 'ready' : 'failed';
}

async function decide(r: ApprovalRequestRecord, decision: 'approve' | 'reject') {
  const reason = await askReason(`${decision === 'approve' ? 'Approve' : 'Reject'}: ${describe(r)}`, r.reason);
  if (reason === null) return;
  const ok = await attempt(
    () => api('POST', `/v1/admin/approvals/${r.id}/decision`, { decision, reason }),
    decision === 'approve' ? 'Approved and executed' : 'Rejected',
  );
  if (ok) await load();
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <div class="ustp-header">
      <h2 class="text-subtitle1">Pending two-person requests</h2>
      <q-btn flat dense icon="refresh" aria-label="Refresh requests" @click="load" />
    </div>
    <p v-if="hasRole('system_admin')" class="text-grey-7">
      Role changes no longer come here: make them in the People tab, where they take effect at once.
    </p>
    <div v-if="listState === 'failed'" class="text-grey-7">Could not load requests.</div>
    <div v-else-if="listState === 'ready' && !pending.length" class="text-grey-7">Nothing waiting for a decision.</div>
    <q-list v-else bordered separator>
      <q-item v-for="r in pending" :key="r.id">
        <q-item-section>
          <q-item-label>
            {{ describe(r) }} for <code>{{ r.subject }}</code>
            <router-link v-if="reviewLink(r)" :to="reviewLink(r)!" class="q-ml-sm">
              Review<span class="sr-only">&nbsp;{{ describe(r) }}</span>
            </router-link>
          </q-item-label>
          <q-item-label caption>
            Requested {{ new Date(r.requestedAt).toLocaleString() }} by <code>{{ r.requestedBy }}</code> · expires
            {{ new Date(r.expiresAt).toLocaleDateString() }}
          </q-item-label>
          <q-item-label class="q-mt-xs">“{{ r.reason }}”</q-item-label>
          <q-item-label v-if="blocker(r)" caption class="text-deep-orange-10">{{ blocker(r) }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <div class="ustp-actions">
            <q-btn dense color="positive" label="Approve" :disable="!!blocker(r)" @click="decide(r, 'approve')">
              <span class="sr-only">&nbsp;{{ describe(r) }}</span>
            </q-btn>
            <q-btn dense flat color="negative" label="Reject" :disable="!!blocker(r)" @click="decide(r, 'reject')">
              <span class="sr-only">&nbsp;{{ describe(r) }}</span>
            </q-btn>
          </div>
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>
