<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ROLES, roleChangeSchema, type ApprovalRequestRecord, type Role } from 'ustp-domain';
import { api } from '../../api.js';
import { aRole, describeRequest, reviewLink } from '../../approval-text.js';
import { askReason, attempt } from '../../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../../forms.js';
import { hasRole, session } from '../../session.js';

const pending = ref<ApprovalRequestRecord[]>([]);
/** An empty list only means "nothing pending" once a load has succeeded. */
const listState = ref<'loading' | 'ready' | 'failed'>('loading');
const me = computed(() => session.me?.account?.accountId);
const isSystemAdmin = computed(() => hasRole('system_admin'));
const request = reactive({ accountId: '', role: 'membership_admin' as Role, change: 'grant' as 'grant' | 'revoke', reason: '' });
const errors = ref<FieldErrors>({});

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

async function submitRequest() {
  const checked = validate(roleChangeSchema, { ...request, accountId: request.accountId.trim() });
  if (!checked.ok) {
    errors.value = checked.errors;
    return;
  }
  errors.value = {};
  const ok = await attempt(async () => {
    try {
      await api('POST', '/v1/admin/roles', checked.data);
    } catch (e) {
      errors.value = apiFieldErrors(e);
      throw e;
    }
  }, 'Request created; a second System Admin must approve it');
  if (ok) {
    request.accountId = '';
    request.reason = '';
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div class="column q-gutter-lg" style="max-width: 860px">
    <div>
      <div class="row items-center q-mb-sm">
        <h2 class="text-subtitle1">Pending two-person requests</h2>
        <q-btn flat dense icon="refresh" aria-label="Refresh requests" @click="load" />
      </div>
      <div v-if="listState === 'failed'" class="text-grey-7">Could not load requests.</div>
      <div v-else-if="listState === 'ready' && !pending.length" class="text-grey-7">Nothing waiting for a decision.</div>
      <q-list v-else bordered separator>
        <q-item v-for="r in pending" :key="r.id">
          <q-item-section>
            <q-item-label>
              {{ describe(r) }} for <code>{{ r.subject }}</code>
              <router-link v-if="reviewLink(r)" :to="reviewLink(r)!" class="q-ml-sm">
                Review<span class="sr-only"> {{ describe(r) }}</span>
              </router-link>
            </q-item-label>
            <q-item-label caption>
              Requested {{ new Date(r.requestedAt).toLocaleString() }} by <code>{{ r.requestedBy }}</code> · expires
              {{ new Date(r.expiresAt).toLocaleDateString() }}
            </q-item-label>
            <q-item-label class="q-mt-xs">“{{ r.reason }}”</q-item-label>
            <q-item-label v-if="blocker(r)" caption class="text-orange-10">{{ blocker(r) }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="row q-gutter-xs">
              <q-btn dense color="positive" label="Approve" :disable="!!blocker(r)" @click="decide(r, 'approve')">
                <span class="sr-only"> {{ describe(r) }}</span>
              </q-btn>
              <q-btn dense flat color="negative" label="Reject" :disable="!!blocker(r)" @click="decide(r, 'reject')">
                <span class="sr-only"> {{ describe(r) }}</span>
              </q-btn>
            </div>
          </q-item-section>
        </q-item>
      </q-list>
    </div>

    <q-card v-if="isSystemAdmin" flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">Request a role change</h2>
        <div class="text-caption text-grey-7">
          Takes effect when a different System Admin approves. Auditors cannot hold any other role.
        </div>
      </q-card-section>
      <q-form class="q-px-md q-pb-md q-gutter-md" @submit.prevent="submitRequest">
        <q-input
          v-model="request.accountId"
          outlined
          dense
          label="Account ID"
          hint="Copy it from the Members tab or the person's Account page."
          :error="!!errors.accountId"
          :error-message="errors.accountId"
        />
        <div class="row q-gutter-md">
          <q-btn-toggle
            v-model="request.change"
            no-caps
            toggle-color="primary"
            role="group"
            aria-label="Change"
            :options="[
              { label: 'Grant', value: 'grant' },
              { label: 'Revoke', value: 'revoke' },
            ]"
          />
          <q-select v-model="request.role" outlined dense style="min-width: 220px" label="Role" :options="[...ROLES]" />
        </div>
        <q-input v-model="request.reason" outlined dense autogrow label="Reason" :error="!!errors.reason" :error-message="errors.reason" />
        <q-btn type="submit" color="primary" label="Create request" />
      </q-form>
    </q-card>
  </div>
</template>
