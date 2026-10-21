<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { LedgerEntry } from 'ustp-domain';
import { api } from '../../api.js';
import { attempt } from '../../dialogs.js';

type Verification =
  | { ok: true; entries: number; head: string }
  | { ok: false; entries: number; seq: number | null; reason: string };

const PAGE = 50;
const entries = ref<LedgerEntry[]>([]);
const more = ref(false);
const verification = ref<Verification | null>(null);
const verifying = ref(false);

async function load(reset = true) {
  const after = reset ? 0 : (entries.value.at(-1)?.seq ?? 0);
  await attempt(async () => {
    const page = await api<LedgerEntry[]>('GET', `/v1/admin/audit/events?after=${after}&limit=${PAGE}`);
    entries.value = reset ? page : [...entries.value, ...page];
    more.value = page.length === PAGE;
  });
}

async function verify() {
  verifying.value = true;
  await attempt(async () => {
    verification.value = await api<Verification>('GET', '/v1/admin/audit/verify');
  }).finally(() => (verifying.value = false));
}

onMounted(() => load());
</script>

<template>
  <div class="column q-gutter-md">
    <q-card flat bordered style="max-width: 860px">
      <q-card-section class="row items-center q-gutter-md">
        <div class="col">
          <div class="text-subtitle1">Hash-chain verification</div>
          <div class="text-caption text-grey-7">Recomputes every entry's hash and link on the server.</div>
        </div>
        <q-btn color="primary" label="Verify ledger" :loading="verifying" @click="verify" />
      </q-card-section>
      <q-banner v-if="verification?.ok" class="bg-positive text-white">
        All {{ verification.entries }} entries verify. Head <code>{{ verification.head }}</code>
      </q-banner>
      <q-banner v-else-if="verification" class="bg-negative text-white">
        Verification failed at entry {{ verification.seq ?? '?' }}: {{ verification.reason }}
      </q-banner>
    </q-card>

    <q-markup-table flat bordered dense>
      <thead>
        <tr>
          <th class="text-left">#</th>
          <th class="text-left">Time</th>
          <th class="text-left">Type</th>
          <th class="text-left">Actor</th>
          <th class="text-left">Subject</th>
          <th class="text-left">Payload</th>
          <th class="text-left">Hash</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in entries" :key="e.seq">
          <td>{{ e.seq }}</td>
          <td>{{ new Date(e.at).toLocaleString() }}</td>
          <td>{{ e.type }}</td>
          <td><code>{{ e.actor.slice(0, 13) }}</code></td>
          <td><code>{{ e.subject?.slice(0, 13) ?? '' }}</code></td>
          <td style="max-width: 320px; white-space: normal"><code>{{ JSON.stringify(e.payload) }}</code></td>
          <td><code>{{ e.hash.slice(0, 12) }}…</code></td>
        </tr>
      </tbody>
    </q-markup-table>
    <q-btn v-if="more" flat no-caps label="Load more" @click="load(false)" />
  </div>
</template>
