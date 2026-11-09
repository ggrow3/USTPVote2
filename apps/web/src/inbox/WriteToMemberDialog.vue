<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { useRouter } from 'vue-router';
import { MAX_INBOX_MESSAGE, MAX_INBOX_SUBJECT, type MemberMatch } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { searchMembersToEmail } from '../notifications/api.js';
import MemberPicker from '../offices/MemberPicker.vue';
import { startInboxConversation } from './api.js';

/**
 * A Membership Admin writes to one member for the membership team (design §10.13), from the inbox (choosing the member)
 * or from the member's record (`member` given). It goes to them in the app and by email, as membership business; the
 * conversation then opens.
 */
const props = defineProps<{ modelValue: boolean; member?: { readonly accountId: string; readonly name: string } | null }>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();
const router = useRouter();
const titleId = useId();

const chosen = ref<MemberMatch | null>(null);
const subject = ref('');
const body = ref('');
const sending = ref(false);
const to = computed(() => props.member ?? (chosen.value ? { accountId: chosen.value.accountId, name: chosen.value.preferredName || chosen.value.legalName } : null));
const ready = computed(() => !!to.value && !!subject.value.trim() && !!body.value.trim());

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    chosen.value = null;
    subject.value = '';
    body.value = '';
  },
);

async function send() {
  const member = to.value;
  if (!member || !ready.value || sending.value) return;
  sending.value = true;
  let threadId: string | null = null;
  await attempt(async () => {
    threadId = (await startInboxConversation({ accountId: member.accountId, subject: subject.value.trim(), body: body.value.trim() })).threadId;
  }, `Sent to ${member.name}`);
  sending.value = false;
  if (!threadId) return;
  emit('update:modelValue', false);
  await router.push(`/admin/inbox/${threadId}`);
}
</script>

<template>
  <q-dialog :model-value="modelValue" :aria-labelledby="titleId" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <q-card class="ustp-dialog ustp-dialog--wide">
      <q-card-section>
        <h2 :id="titleId" class="text-h6 q-my-none">{{ member ? `Write to ${member.name}` : 'Write to a member' }}</h2>
        <p class="text-grey-7 q-mb-none">
          From the membership team: the member sees the team, not your name, and the other Membership Admins see the
          whole conversation. It reaches them on the site and by email, as membership business, whether or not they chose
          news and announcements. To write to many members, use Email members instead.
        </p>
      </q-card-section>
      <q-form class="ustp-form" @submit.prevent="send">
        <q-card-section class="ustp-stack">
          <MemberPicker v-if="!member" v-model="chosen" :search="searchMembersToEmail" :unavailable="() => null" action="Writes to" />
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
</template>
