<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue';
import { useRouter } from 'vue-router';
import { MAX_INBOX_MESSAGE, MAX_INBOX_SUBJECT, type MyTeamThreadSummary } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { myTeamThreads, writeToTeam } from './api.js';
import { whenText } from './inbox-text.js';

/**
 * On the Messages page, for anyone with a member record, whatever its status (design §10.13): their conversations with
 * the membership team, and a way to start one. The team is the Membership Admins; they all read it.
 */
const router = useRouter();
const titleId = useId();
const threads = ref<MyTeamThreadSummary[] | null>(null);
const writing = ref(false);
const subject = ref('');
const body = ref('');
const sending = ref(false);
const ready = computed(() => !!subject.value.trim() && !!body.value.trim());

async function load() {
  await attempt(async () => {
    threads.value = await myTeamThreads();
  });
}

function open() {
  subject.value = '';
  body.value = '';
  writing.value = true;
}

async function send() {
  if (!ready.value || sending.value) return;
  sending.value = true;
  let threadId: string | null = null;
  await attempt(async () => {
    threadId = (await writeToTeam(subject.value.trim(), body.value.trim())).threadId;
  }, 'Sent to the membership team');
  sending.value = false;
  if (!threadId) return;
  writing.value = false;
  await router.push(`/messages/team/${threadId}`);
}

onMounted(load);
</script>

<template>
  <section class="q-mb-lg" aria-labelledby="team-conversations">
    <h2 id="team-conversations" class="text-subtitle1 q-mt-none q-mb-xs">Membership team</h2>
    <p class="text-grey-7 q-mt-none">Questions about your membership? The party’s membership team reads and answers these.</p>
    <q-btn unelevated no-caps color="primary" icon="edit" label="Write to the membership team" class="q-mb-sm" @click="open" />
    <q-list v-if="threads?.length" bordered separator class="rounded-borders">
      <q-item v-for="t in threads" :key="t.threadId" clickable :to="`/messages/team/${t.threadId}`" :class="{ 'text-weight-bold': t.unread > 0 }">
        <q-item-section>
          <q-item-label>{{ t.subject }}<template v-if="t.closed"> (closed)</template></q-item-label>
          <q-item-label caption lines="1">{{ t.lastFromTeam ? 'Team: ' : 'You: ' }}{{ t.lastText }}</q-item-label>
        </q-item-section>
        <q-item-section side top>
          <q-item-label caption>{{ whenText(t.lastMessageAt) }}</q-item-label>
          <q-badge v-if="t.unread" color="primary" :label="`${t.unread} new`" />
        </q-item-section>
      </q-item>
    </q-list>

    <q-dialog v-model="writing" :aria-labelledby="titleId">
      <q-card class="ustp-dialog ustp-dialog--wide">
        <q-card-section>
          <h2 :id="titleId" class="text-h6 q-my-none">Write to the membership team</h2>
          <p class="text-grey-7 q-mb-none">
            Every Membership Admin can read it, and one of them will answer here; you get their answer by email too.
            Conversations are kept for two years after the last message.
          </p>
        </q-card-section>
        <q-form class="ustp-form" @submit.prevent="send">
          <q-card-section class="ustp-stack">
            <q-input v-model="subject" outlined dense label="Subject" :maxlength="MAX_INBOX_SUBJECT" counter />
            <q-input v-model="body" outlined type="textarea" autogrow label="Message" :maxlength="MAX_INBOX_MESSAGE" counter hint="Plain text" />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn v-close-popup flat no-caps label="Cancel" />
            <q-btn type="submit" unelevated no-caps color="primary" icon="send" label="Send" :loading="sending" :disable="!ready" />
          </q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>
  </section>
</template>
