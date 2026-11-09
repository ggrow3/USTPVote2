<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { InboxPage, InboxStatus, InboxThreadSummary } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { inboxPage } from './api.js';
import { whenText } from './inbox-text.js';
import { INBOX_STATUS_COLOURS, INBOX_STATUS_LABELS } from './membership-inbox-text.js';
import WriteToMemberDialog from './WriteToMemberDialog.vue';

/**
 * The membership inbox (design §10.13), the Membership Admins' shared view of every conversation between the membership
 * team and a member: those that need an answer first, which ones are whose, and a way to write to a member.
 */
const status = ref<InboxStatus | 'all'>('open');
const assigned = ref<'anyone' | 'me' | 'nobody'>('anyone');
const threads = ref<InboxThreadSummary[] | null>(null);
const next = ref<string | null>(null);
const counts = ref<InboxPage['counts']>({ open: 0, openMine: 0 });
const writing = ref(false);

async function load(after?: string) {
  await attempt(async () => {
    const page = await inboxPage({ status: status.value, assigned: assigned.value === 'anyone' ? undefined : assigned.value, after });
    threads.value = after ? [...(threads.value ?? []), ...page.threads] : [...page.threads];
    next.value = page.next;
    counts.value = page.counts;
  });
}

watch([status, assigned], () => void load());
onMounted(() => void load());
</script>

<template>
  <section class="ustp-stack" aria-labelledby="inbox-heading">
    <div class="ustp-header">
      <div>
        <h2 id="inbox-heading" class="text-subtitle1">Membership inbox</h2>
        <p class="text-grey-7 q-my-none">
          Conversations between the membership team and members, one member each. Members write here from their Messages
          page; you write to one from here or from their record. Every Membership Admin sees them all. Kept two years after
          the last message.
        </p>
      </div>
      <q-btn unelevated no-caps color="primary" icon="edit" label="Write to a member" @click="writing = true" />
    </div>
    <div class="row q-gutter-md items-center">
      <q-btn-toggle
        v-model="status"
        no-caps
        unelevated
        toggle-color="primary"
        aria-label="Which conversations"
        :options="[
          { value: 'open', label: `Needs an answer (${counts.open})` },
          { value: 'answered', label: 'Answered' },
          { value: 'closed', label: 'Closed' },
          { value: 'all', label: 'All' },
        ]"
      />
      <q-btn-toggle
        v-model="assigned"
        no-caps
        unelevated
        toggle-color="primary"
        aria-label="Whose"
        :options="[
          { value: 'anyone', label: 'Anyone’s' },
          { value: 'me', label: `Mine (${counts.openMine} need an answer)` },
          { value: 'nobody', label: 'Nobody’s' },
        ]"
      />
    </div>
    <div v-if="!threads" class="text-grey-7">Loading…</div>
    <p v-else-if="!threads.length" class="text-grey-7">No conversations here.</p>
    <q-list v-else bordered separator class="rounded-borders">
      <q-item v-for="t in threads" :key="t.threadId" clickable :to="`/admin/inbox/${t.threadId}`">
        <q-item-section>
          <q-item-label>
            <span class="text-weight-medium">{{ t.memberName }}</span>
            · {{ t.subject }}
          </q-item-label>
          <q-item-label caption lines="1">{{ t.lastFrom === 'team' ? 'Team: ' : `${t.memberName}: ` }}{{ t.lastText }}</q-item-label>
          <q-item-label caption>{{ t.assignedToName ? `Given to ${t.assignedToName}` : 'For the whole team' }}</q-item-label>
        </q-item-section>
        <q-item-section side top>
          <q-item-label caption>{{ whenText(t.lastMessageAt) }}</q-item-label>
          <q-badge :color="INBOX_STATUS_COLOURS[t.status]" :label="INBOX_STATUS_LABELS[t.status]" />
        </q-item-section>
      </q-item>
    </q-list>
    <div v-if="next">
      <q-btn flat no-caps color="primary" icon="expand_more" label="More" @click="load(next)" />
    </div>
    <WriteToMemberDialog v-model="writing" />
  </section>
</template>
