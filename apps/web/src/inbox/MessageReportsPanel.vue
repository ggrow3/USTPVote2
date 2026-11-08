<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { MessageReportView } from 'ustp-domain';
import { askReason, attempt } from '../dialogs.js';
import { closeMessageReport, messageReports } from './api.js';
import { whenText } from './inbox-text.js';

/**
 * Messages members reported (design §10.13), for Membership Admins, beside the forum's reports: the one message, who
 * wrote it, who reported it and why. Nothing else of the conversation. Closing one records what was done about it.
 */
const reports = ref<MessageReportView[] | null>(null);
const open = computed(() => reports.value?.filter((r) => r.status === 'open') ?? []);
const closed = computed(() => reports.value?.filter((r) => r.status === 'closed').slice(0, 10) ?? []);

async function load() {
  await attempt(async () => {
    reports.value = await messageReports();
  });
}

async function close(r: MessageReportView) {
  const note = await askReason('Close this report', 'Say what was done about it, for the other Membership Admins (for example, that you spoke to the member).');
  if (note === null) return;
  if (await attempt(() => closeMessageReport(r.reportId, note), 'Report closed')) await load();
}

onMounted(load);
</script>

<template>
  <section class="ustp-stack" aria-labelledby="message-reports">
    <h2 id="message-reports" class="text-subtitle1">Reported messages</h2>
    <p class="text-grey-7 q-my-none">
      Messages members sent each other that the one who got it reported. You see that message alone, never the rest of the
      conversation.
    </p>
    <div v-if="!reports" class="text-grey-7">Loading…</div>
    <div v-else-if="!open.length" class="text-grey-7">Nothing is waiting.</div>
    <q-list v-else bordered separator class="rounded-borders">
      <q-item v-for="r in open" :key="r.reportId">
        <q-item-section>
          <q-item-label>From {{ r.fromName ?? '[deleted]' }}, reported by {{ r.reportedByName ?? '[deleted]' }}</q-item-label>
          <q-item-label caption class="message-report__quote">{{ r.body }}</q-item-label>
          <q-item-label caption>Why: “{{ r.reason }}” · sent {{ whenText(r.sentAt) }}, reported {{ whenText(r.createdAt) }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-btn flat dense no-caps color="primary" label="Close" @click="close(r)" />
        </q-item-section>
      </q-item>
    </q-list>
    <template v-if="closed.length">
      <h3 class="text-subtitle2 q-mb-none">Closed lately</h3>
      <q-list bordered separator class="rounded-borders">
        <q-item v-for="r in closed" :key="r.reportId">
          <q-item-section>
            <q-item-label>From {{ r.fromName ?? '[deleted]' }}, reported by {{ r.reportedByName ?? '[deleted]' }}</q-item-label>
            <q-item-label caption>Closed by {{ r.closedByName ?? 'a Membership Admin' }} {{ r.closedAt ? whenText(r.closedAt) : '' }}<template v-if="r.note">: “{{ r.note }}”</template></q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </template>
  </section>
</template>

<style scoped>
.message-report__quote {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border-left: 3px solid rgba(127, 127, 127, 0.5);
  padding-left: 8px;
  margin: 4px 0;
}
</style>
