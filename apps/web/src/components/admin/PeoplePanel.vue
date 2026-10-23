<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, onMounted, ref } from 'vue';
import { ROLES, type AccountSummary, type Role } from 'ustp-domain';
import { announce } from '../../a11y.js';
import { api } from '../../api.js';
import { roleLabel } from '../../approval-text.js';
import { attempt } from '../../dialogs.js';
import { session } from '../../session.js';
import RoleChangeForm from './RoleChangeForm.vue';

const PAGE = 50;
const ROLE_FILTERS = [{ label: 'Any role', value: 'any' }, ...ROLES.map((r) => ({ label: roleLabel(r), value: r }))];

const $q = useQuasar();
const form = ref<InstanceType<typeof RoleChangeForm> | null>(null);
const email = ref<string | null>('');
const role = ref<Role | 'any' | null>(null);
const rows = ref<AccountSummary[]>([]);
const more = ref(false);
/** An empty table only means "nobody found" once a load has succeeded. */
const listState = ref<'loading' | 'ready' | 'failed'>('loading');
const me = computed(() => session.me?.account?.accountId);
/** Only the latest search may fill the table; typing can overtake a slow response. */
let latest = 0;

async function load(reset = true, { spoken = false } = {}) {
  const after = reset ? undefined : rows.value.at(-1)?.accountId;
  const query = new URLSearchParams({ limit: String(PAGE) });
  const prefix = email.value?.trim();
  if (prefix) query.set('email', prefix);
  if (role.value) query.set('role', role.value);
  if (after) query.set('after', after);
  const run = ++latest;
  let page: AccountSummary[] = [];
  const ok = await attempt(async () => {
    page = await api<AccountSummary[]>('GET', `/v1/admin/accounts?${query}`);
  });
  if (run !== latest) return;
  if (ok) {
    rows.value = reset ? page : [...rows.value, ...page];
    more.value = page.length === PAGE;
    if (spoken) announce(rows.value.length ? `${rows.value.length}${more.value ? ' or more' : ''} found` : 'Nobody found');
  }
  listState.value = ok ? 'ready' : 'failed';
}

const search = () => load(true, { spoken: true });

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
  $q.notify({ message: 'Account ID copied' });
}

const nameOf = (a: AccountSummary) => a.displayName ?? a.primaryEmail ?? a.accountId;

onMounted(() => load());
</script>

<template>
  <div class="ustp-content">
    <p class="text-grey-7">
      Everyone with an account, and the roles they hold. A role change below takes effect at once; it needs no second
      admin.
    </p>
    <div class="ustp-toolbar">
      <q-input
        v-model="email"
        dense
        outlined
        clearable
        debounce="300"
        label="Email starts with"
        @update:model-value="search"
      />
      <q-select
        v-model="role"
        dense
        outlined
        clearable
        emit-value
        map-options
        label="Holding a role"
        :options="ROLE_FILTERS"
        @update:model-value="search"
      />
      <q-btn flat dense icon="refresh" aria-label="Refresh people" @click="load()" />
    </div>
    <q-markup-table flat bordered dense>
      <thead>
        <tr>
          <th class="text-left">Name</th>
          <th class="text-left">Email</th>
          <th class="text-left">Membership</th>
          <th class="text-left">Roles</th>
          <th class="text-left">Account created</th>
          <th class="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in rows" :key="a.accountId">
          <td>
            {{ a.displayName ?? '—' }}<span v-if="a.accountId === me" class="text-grey-7">&nbsp;(you)</span>
          </td>
          <td>
            {{ a.primaryEmail ?? '—' }}
            <span v-if="a.primaryEmail && !a.emailVerified" class="text-caption text-deep-orange-10">&nbsp;unverified</span>
          </td>
          <td>
            <q-badge v-if="a.memberStatus" :label="a.memberStatus" />
            <span v-else class="text-grey-7">not a member</span>
          </td>
          <td>
            <q-chip v-for="r in a.roles" :key="r" dense color="primary" text-color="white">{{ roleLabel(r) }}</q-chip>
            <span v-if="!a.roles.length" class="text-grey-7">none</span>
          </td>
          <td>{{ new Date(a.createdAt).toLocaleDateString() }}</td>
          <td class="text-right text-no-wrap">
            <q-btn flat dense round size="sm" icon="content_copy" :aria-label="`Copy account ID of ${nameOf(a)}`" @click="copy(a.accountId)" />
            <q-btn v-if="a.accountId !== me" flat dense no-caps label="Change roles" @click="form?.choose(a)">
              <span class="sr-only">&nbsp;of {{ nameOf(a) }}</span>
            </q-btn>
          </td>
        </tr>
        <tr v-if="listState === 'failed'">
          <td colspan="6" class="text-grey-7">Could not load people.</td>
        </tr>
        <tr v-else-if="listState === 'ready' && !rows.length">
          <td colspan="6" class="text-grey-7">Nobody found.</td>
        </tr>
      </tbody>
    </q-markup-table>
    <q-btn v-if="more" flat no-caps label="Load more" @click="load(false)" />
    <RoleChangeForm ref="form" @changed="load()" />
  </div>
</template>
