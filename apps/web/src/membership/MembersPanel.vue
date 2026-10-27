<script setup lang="ts">
import { useQuasar } from 'quasar';
import { onMounted, ref } from 'vue';
import { adminStatusChanges, type MemberRecord, type MemberStatus, type StatusHistoryRecord } from 'ustp-domain';
import { askReason, attempt } from '../dialogs.js';
import { session } from '../session.js';
import { changeMemberStatus, memberHistory, members } from './api.js';

const PAGE = 50;

const $q = useQuasar();
const filter = ref<MemberStatus | null>('active');
const rows = ref<MemberRecord[]>([]);
const more = ref(false);
/** An empty table only means "no members" once a load has succeeded. */
const listState = ref<'loading' | 'ready' | 'failed'>('loading');
const history = ref<{ member: MemberRecord; entries: StatusHistoryRecord[] } | null>(null);

async function load(reset = true) {
  const after = reset ? undefined : rows.value.at(-1)?.accountId;
  const ok = await attempt(async () => {
    const page = await members({ status: filter.value, after, limit: PAGE });
    rows.value = reset ? page : [...rows.value, ...page];
    more.value = page.length === PAGE;
  });
  listState.value = ok ? 'ready' : 'failed';
}

async function change(member: MemberRecord, to: MemberStatus) {
  const reason = await askReason(`Change status to ${to}`, `${member.legalName}: ${member.status} → ${to}.`);
  if (reason === null) return;
  if (await attempt(() => changeMemberStatus(member.accountId, { to, reason }), 'Status changed')) {
    await load();
  }
}

async function showHistory(member: MemberRecord) {
  await attempt(async () => {
    history.value = { member, entries: await memberHistory(member.accountId) };
  });
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
  $q.notify({ message: 'Account ID copied' });
}

onMounted(() => load());
</script>

<template>
  <div class="ustp-content">
    <div class="ustp-toolbar">
      <q-select
        v-model="filter"
        dense
        outlined
        clearable
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
            <router-link :to="`/admin/members/${m.accountId}`">{{ m.legalName }}</router-link>
            <q-btn flat dense round size="sm" icon="content_copy" :aria-label="`Copy account ID of ${m.legalName}`" @click="copy(m.accountId)" />
          </td>
          <td>{{ m.state }}</td>
          <td><q-badge :label="m.status" /></td>
          <td>{{ m.memberSince ? new Date(m.memberSince).toLocaleDateString() : '—' }}</td>
          <td class="text-right">
            <q-btn flat dense no-caps label="History" @click="showHistory(m)">
              <span class="sr-only"> of {{ m.legalName }}</span>
            </q-btn>
            <q-btn-dropdown
              v-if="adminStatusChanges(m.status).length > 0 && m.accountId !== session.me?.account?.accountId"
              flat
              dense
              no-caps
              label="Change"
              :aria-label="`Change status of ${m.legalName}`"
            >
              <q-list dense>
                <q-item v-for="to in adminStatusChanges(m.status)" :key="to" v-close-popup clickable @click="change(m, to)">
                  <q-item-section>{{ to }}</q-item-section>
                </q-item>
              </q-list>
            </q-btn-dropdown>
          </td>
        </tr>
        <tr v-if="listState === 'failed'">
          <td colspan="5" class="text-grey-7">Could not load members.</td>
        </tr>
        <tr v-else-if="listState === 'ready' && !rows.length">
          <td colspan="5" class="text-grey-7">No members{{ filter ? ` with status ${filter}` : '' }}.</td>
        </tr>
      </tbody>
    </q-markup-table>
    <q-btn v-if="more" flat no-caps label="Load more" @click="load(false)" />

    <q-dialog :model-value="!!history" aria-labelledby="history-title" @update:model-value="history = null">
      <q-card v-if="history" class="ustp-dialog">
        <q-card-section>
          <h2 id="history-title" class="text-h6">{{ history.member.legalName }} — status history</h2>
        </q-card-section>
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
