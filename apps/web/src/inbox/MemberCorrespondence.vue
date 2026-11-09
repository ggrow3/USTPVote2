<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { InboxThreadSummary, MailLogRow } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { memberEmails } from '../notifications/api.js';
import { LOG_KIND_LABELS, LOG_STATUS_COLOURS, LOG_STATUS_LABELS, logCause } from '../notifications/mail-log-text.js';
import { inboxPage } from './api.js';
import { whenText } from './inbox-text.js';
import { INBOX_STATUS_COLOURS, INBOX_STATUS_LABELS } from './membership-inbox-text.js';
import WriteToMemberDialog from './WriteToMemberDialog.vue';

/**
 * On a member's record, for Membership Admins (design §10.13): their conversations with the membership team, a way to
 * write to them, and the emails the site sent them, from the email log (§10.12): what each was, who caused it and what
 * its delivery reports said, never its words.
 */
const props = defineProps<{ accountId: string; name: string; isSelf: boolean }>();

const threads = ref<InboxThreadSummary[] | null>(null);
const emails = ref<MailLogRow[] | null>(null);
const nextEmails = ref<string | null>(null);
const writing = ref(false);

async function loadThreads() {
  await attempt(async () => {
    threads.value = [...(await inboxPage({ account: props.accountId, status: 'all' })).threads];
  });
}

async function loadEmails(after?: string) {
  await attempt(async () => {
    const page = await memberEmails(props.accountId, after);
    emails.value = after ? [...(emails.value ?? []), ...page.rows] : [...page.rows];
    nextEmails.value = page.next;
  });
}

const date = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

onMounted(() => Promise.all([loadThreads(), loadEmails()]));
</script>

<template>
  <q-card flat bordered>
    <q-card-section class="ustp-header">
      <div>
        <h2 class="text-subtitle1">Conversations with the membership team</h2>
        <p class="text-grey-7 q-my-none">Kept two years after the last message. The member sees the team, not who wrote.</p>
      </div>
      <q-btn v-if="!isSelf" unelevated no-caps color="primary" icon="edit" label="Write to this member" @click="writing = true" />
    </q-card-section>
    <q-card-section>
      <div v-if="!threads" class="text-grey-7">Loading…</div>
      <p v-else-if="!threads.length" class="text-grey-7 q-my-none">None yet.</p>
      <q-list v-else bordered separator class="rounded-borders">
        <q-item v-for="t in threads" :key="t.threadId" clickable :to="`/admin/inbox/${t.threadId}`">
          <q-item-section>
            <q-item-label>{{ t.subject }}</q-item-label>
            <q-item-label caption lines="1">{{ t.lastFrom === 'team' ? 'Team: ' : `${name}: ` }}{{ t.lastText }}</q-item-label>
          </q-item-section>
          <q-item-section side top>
            <q-item-label caption>{{ whenText(t.lastMessageAt) }}</q-item-label>
            <q-badge :color="INBOX_STATUS_COLOURS[t.status]" :label="INBOX_STATUS_LABELS[t.status]" />
          </q-item-section>
        </q-item>
      </q-list>
    </q-card-section>
    <q-separator />
    <q-card-section>
      <h3 class="text-subtitle2 q-mt-none">Emails sent to them</h3>
      <p class="text-grey-7">Every email the site sent them in the last 180 days, from the email log: what it was and how it went, never what it said.</p>
      <div v-if="!emails" class="text-grey-7">Loading…</div>
      <p v-else-if="!emails.length" class="text-grey-7 q-my-none">None.</p>
      <q-list v-else dense separator>
        <q-item v-for="e in emails" :key="e.messageId">
          <q-item-section>
            <q-item-label>
              {{ LOG_KIND_LABELS[e.kind] }}<template v-if="e.electionTitle"> ({{ e.electionTitle }})</template>
            </q-item-label>
            <q-item-label caption>
              {{ date(e.sentAt) }} · {{ logCause(e) }}
              <template v-if="e.kind === 'membership_message' && e.ref">
                · <router-link :to="`/admin/inbox/${e.ref}`">the conversation</router-link>
              </template>
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-badge :color="LOG_STATUS_COLOURS[e.status]" :label="LOG_STATUS_LABELS[e.status]" />
          </q-item-section>
        </q-item>
      </q-list>
      <q-btn v-if="nextEmails" flat no-caps dense color="primary" icon="expand_more" label="More" class="q-mt-sm" @click="loadEmails(nextEmails)" />
    </q-card-section>
    <WriteToMemberDialog v-model="writing" :member="{ accountId, name }" />
  </q-card>
</template>
