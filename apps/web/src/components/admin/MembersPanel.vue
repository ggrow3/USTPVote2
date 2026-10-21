<script setup lang="ts">
import { useQuasar } from 'quasar';
import { onMounted, ref } from 'vue';
import type { MemberRecord, MemberStatus, StatusHistoryRecord } from 'ustp-domain';
import { api } from '../../api.js';
import { askReason, attempt } from '../../dialogs.js';
import { session } from '../../session.js';

const PAGE = 50;
/** Admin status changes the API accepts from each status; applications are decided in their own tab. */
const NEXT: Partial<Record<MemberStatus, MemberStatus[]>> = {
  active: ['suspended', 'lapsed', 'resigned'],
  lapsed: ['active', 'resigned'],
  suspended: ['active', 'resigned'],
};

const $q = useQuasar();
const filter = ref<MemberStatus | null>('active');
const rows = ref<MemberRecord[]>([]);
const more = ref(false);
const history = ref<{ member: MemberRecord; entries: StatusHistoryRecord[] } | null>(null);

async function load(reset = true) {
  const after = reset ? undefined : rows.value.at(-1)?.accountId;
  const query = new URLSearchParams({ limit: String(PAGE) });
  if (filter.value) query.set('status', filter.value);
  if (after) query.set('after', after);
  await attempt(async () => {
    const page = await api<MemberRecord[]>('GET', `/v1/admin/members?${query}`);
    rows.value = reset ? page : [...rows.value, ...page];
    more.value = page.length === PAGE;
  });
}

async function change(member: MemberRecord, to: MemberStatus) {
  const reason = await askReason(`Change status to ${to}`, `${member.legalName}: ${member.status} → ${to}.`);
  if (reason === null) return;
  if (await attempt(() => api('POST', `/v1/admin/members/${member.accountId}/status`, { to, reason }), 'Status changed')) {
    await load();
  }
}

async function showHistory(member: MemberRecord) {
  await attempt(async () => {
    history.value = { member, entries: await api<StatusHistoryRecord[]>('GET', `/v1/admin/members/${member.accountId}/history`) };
  });
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
  $q.notify({ message: 'Account ID copied' });
}

onMounted(() => load());
</script>

<template>
  <div>
    <div class="row items-center q-gutter-sm q-mb-md">
      <q-select
        v-model="filter"
        dense
        outlined
        clearable
        style="min-width: 180px"
        label="Status"
        :options="['applicant', 'active', 'lapsed', 'suspended', 'resigned', 'rejected']"
        @update:model-value="load()"
      />
    </div>
    <q-markup-table flat bordered dense>
      <thead>
        <tr>
          <th class="text-left">Name</th>
          <th class="text-left">State</th>
          <th class="text-left">Status</th>
          <th class="text-left">Member since</th>
          <th class="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in rows" :key="m.accountId">
          <td>
            {{ m.legalName }}
            <q-btn flat dense round size="xs" icon="content_copy" aria-label="Copy account ID" @click="copy(m.accountId)" />
          </td>
          <td>{{ m.state }}</td>
          <td><q-badge :label="m.status" /></td>
          <td>{{ m.memberSince ? new Date(m.memberSince).toLocaleDateString() : '—' }}</td>
          <td class="text-right">
            <q-btn flat dense no-caps label="History" @click="showHistory(m)" />
            <q-btn-dropdown
              v-if="NEXT[m.status] && m.accountId !== session.me?.account?.accountId"
              flat
              dense
              no-caps
              label="Change"
            >
              <q-list dense>
                <q-item v-for="to in NEXT[m.status]" :key="to" v-close-popup clickable @click="change(m, to)">
                  <q-item-section>{{ to }}</q-item-section>
                </q-item>
              </q-list>
            </q-btn-dropdown>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="5" class="text-grey-7">No members{{ filter ? ` with status ${filter}` : '' }}.</td>
        </tr>
      </tbody>
    </q-markup-table>
    <q-btn v-if="more" flat no-caps class="q-mt-sm" label="Load more" @click="load(false)" />

    <q-dialog :model-value="!!history" @update:model-value="history = null">
      <q-card v-if="history" style="min-width: 420px">
        <q-card-section class="text-h6">{{ history.member.legalName }} — status history</q-card-section>
        <q-list separator>
          <q-item v-for="h in history.entries" :key="h.ledgerSeq">
            <q-item-section>
              <q-item-label>{{ h.from ?? 'none' }} → {{ h.to }}</q-item-label>
              <q-item-label caption>
                {{ new Date(h.at).toLocaleString() }} · ledger #{{ h.ledgerSeq }}<span v-if="h.reason"> · {{ h.reason }}</span>
              </q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>
    </q-dialog>
  </div>
</template>
