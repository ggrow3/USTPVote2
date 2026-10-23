<script setup lang="ts">
import { computed, inject, onMounted, reactive, ref, watch } from 'vue';
import {
  checkRoleRequest,
  ROLES,
  roleChangeSchema,
  type AccountSummary,
  type Actor,
  type ApprovalRequestRecord,
  type Role,
} from 'ustp-domain';
import { focusSoon } from '../../a11y.js';
import { api } from '../../api.js';
import { aRole, describeRequest, reviewLink, roleLabel } from '../../approval-text.js';
import { askReason, attempt } from '../../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../../forms.js';
import { ROLE_CHANGE } from '../../role-change.js';
import { hasRole, session } from '../../session.js';

const ROLE_OPTIONS = ROLES.map((r) => ({ label: roleLabel(r), value: r }));

const pending = ref<ApprovalRequestRecord[]>([]);
/** An empty list only means "nothing pending" once a load has succeeded. */
const listState = ref<'loading' | 'ready' | 'failed'>('loading');
const me = computed(() => session.me?.account?.accountId);
const isSystemAdmin = computed(() => hasRole('system_admin'));
const request = reactive({ accountId: '', role: 'membership_admin' as Role, change: 'grant' as 'grant' | 'revoke', reason: '' });
const errors = ref<FieldErrors>({});

/** The person chosen from the People list; `byId` switches to typing an account ID instead. */
const picked = ref<AccountSummary | null>(null);
const byId = ref(false);
const people = ref<AccountSummary[]>([]);
const subjectId = computed(() => (byId.value ? request.accountId.trim() : (picked.value?.accountId ?? '')));

/** The caller as the API's two-person checks see them (actorOf on the server). */
const actor = computed<Actor>(() => ({
  accountId: me.value ?? '',
  roles: session.me?.roles ?? [],
  mfa: !!session.me && (session.me.mfa.signedInWithMfa || !session.me.mfa.required),
  authAgeSeconds: 0,
}));

/** Why the API would refuse this request, mirroring its checks (design §10.2); roles are unknown for a typed ID. */
const requestBlocker = computed(() => {
  if (!subjectId.value) return null;
  const subject = { accountId: subjectId.value, roles: byId.value ? null : (picked.value?.roles ?? null) };
  const check = checkRoleRequest(actor.value, subject, request.change, request.role, pending.value);
  return check.ok ? null : `${check.reason[0]!.toUpperCase()}${check.reason.slice(1)}.`;
});

const personLabel = (a: AccountSummary) => a.primaryEmail ?? a.displayName ?? a.accountId;
const rolesText = (roles: readonly Role[]) => (roles.length ? roles.map(roleLabel).join(', ') : 'no role');
const pickedSummary = computed(() => {
  const a = picked.value;
  if (!a || byId.value) return null;
  return `${a.displayName ?? personLabel(a)} holds ${rolesText(a.roles)}${a.memberStatus ? `; membership ${a.memberStatus}` : ''}.`;
});

async function searchPeople(text: string, update: (fn: () => void) => void, abort: () => void) {
  const query = new URLSearchParams({ limit: '20' });
  if (text.trim()) query.set('email', text.trim());
  let found: AccountSummary[] = [];
  const ok = await attempt(async () => {
    found = await api<AccountSummary[]>('GET', `/v1/admin/accounts?${query}`);
  });
  if (ok) update(() => (people.value = found));
  else abort();
}

// "Change roles" in the People tab lands here with that person chosen.
const handoff = inject(ROLE_CHANGE, null);
watch(
  () => handoff?.target.value,
  (target) => {
    if (!target) return;
    byId.value = false;
    picked.value = target.account;
    errors.value = {};
    void focusSoon('#role-change-title');
  },
  { immediate: true },
);

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
  const checked = validate(roleChangeSchema, { ...request, accountId: subjectId.value });
  if (!checked.ok) {
    errors.value = checked.errors;
    if (errors.value.accountId && !byId.value) errors.value.accountId = 'Choose a person.';
    return;
  }
  errors.value = {};
  if (requestBlocker.value) return;
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
    picked.value = null;
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
                Review<span class="sr-only">&nbsp;{{ describe(r) }}</span>
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

    <q-card v-if="isSystemAdmin" flat bordered>
      <q-card-section>
        <h2 id="role-change-title" class="text-subtitle1">Request a role change</h2>
        <div class="text-caption text-grey-7">
          Takes effect when a different System Admin approves. Auditors cannot hold any other role.
        </div>
      </q-card-section>
      <q-form class="q-px-md q-pb-md q-gutter-md" @submit.prevent="submitRequest">
        <div>
          <q-select
            v-if="!byId"
            v-model="picked"
            outlined
            dense
            use-input
            clearable
            input-debounce="300"
            label="Person"
            hint="Type the start of their email address."
            :options="people"
            :option-label="personLabel"
            option-value="accountId"
            :error="!!errors.accountId"
            :error-message="errors.accountId"
            @filter="searchPeople"
          >
            <template #option="scope">
              <q-item v-bind="scope.itemProps">
                <q-item-section>
                  <q-item-label>{{ personLabel(scope.opt) }}</q-item-label>
                  <q-item-label caption>
                    {{ scope.opt.displayName ?? 'No name' }} · holds {{ rolesText(scope.opt.roles) }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </template>
            <template #no-option>
              <q-item>
                <q-item-section class="text-grey-7">No account with that email.</q-item-section>
              </q-item>
            </template>
          </q-select>
          <q-input
            v-else
            v-model="request.accountId"
            outlined
            dense
            label="Account ID"
            hint="Copy it from the People tab or the person's Account page."
            :error="!!errors.accountId"
            :error-message="errors.accountId"
          />
          <div v-if="pickedSummary" class="text-caption q-mt-xs">{{ pickedSummary }}</div>
          <q-btn
            flat
            dense
            no-caps
            class="q-mt-xs"
            :label="byId ? 'Choose from the People list instead' : 'Enter an account ID instead'"
            @click="byId = !byId"
          />
        </div>
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
          <q-select
            v-model="request.role"
            outlined
            dense
            emit-value
            map-options
            style="min-width: 220px"
            label="Role"
            :options="ROLE_OPTIONS"
          />
        </div>
        <q-input v-model="request.reason" outlined dense autogrow label="Reason" :error="!!errors.reason" :error-message="errors.reason" />
        <div>
          <div aria-live="polite" class="text-caption text-orange-10" :class="{ 'q-mb-sm': requestBlocker }">{{ requestBlocker ?? '' }}</div>
          <q-btn type="submit" color="primary" label="Create request" :disable="!!requestBlocker" />
        </div>
      </q-form>
    </q-card>
  </div>
</template>
