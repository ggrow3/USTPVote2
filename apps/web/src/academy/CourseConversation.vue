<script setup lang="ts">
import { ref } from 'vue';
import type { CourseConversation, CourseMessageSender } from 'ustp-domain';
import { shortDateTime } from './course-map.js';

/**
 * A learner's conversation with a course's instructors (design §10.8), for either side: the messages, oldest first,
 * and a box to write in while messaging is on. The parent sends; this clears the box once it has.
 */
const props = defineProps<{
  conversation: CourseConversation;
  /** Who is reading: their own messages sit on the right. */
  viewer: CourseMessageSender;
  /** What to say while messaging is off. */
  offText: string;
  send: (body: string) => Promise<boolean>;
}>();

const draft = ref('');
const sending = ref(false);

async function submit() {
  const body = draft.value.trim();
  if (!body || sending.value) return;
  sending.value = true;
  try {
    if (await props.send(body)) draft.value = '';
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="course-conversation">
    <ol v-if="conversation.messages.length" class="course-conversation__list" aria-label="Messages">
      <li
        v-for="message in conversation.messages"
        :key="message.messageId"
        class="course-conversation__message"
        :class="message.from === viewer ? 'course-conversation__message--own' : 'course-conversation__message--other'"
      >
        <div class="text-caption text-weight-medium">
          {{ message.from === 'instructor' ? `${message.authorName} · instructor` : message.authorName }} ·
          <time :datetime="message.sentAt">{{ shortDateTime(message.sentAt) }}</time>
        </div>
        <div class="course-conversation__body">{{ message.body }}</div>
      </li>
    </ol>
    <p v-else-if="conversation.messaging" class="text-grey-7 q-mb-sm">No messages yet.</p>
    <form v-if="conversation.messaging" class="q-mt-sm" @submit.prevent="submit">
      <q-input v-model="draft" outlined type="textarea" autogrow maxlength="4000" counter label="Your message" :disable="sending" />
      <div class="row justify-end q-mt-xs">
        <q-btn type="submit" color="primary" no-caps icon="send" label="Send" :loading="sending" :disable="!draft.trim()" />
      </div>
    </form>
    <p v-else class="text-grey-7 q-mb-none" role="status">{{ offText }}</p>
  </div>
</template>

<style scoped>
.course-conversation__list { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 8px; max-height: 420px; overflow-y: auto; }
.course-conversation__message { max-width: 85%; border-radius: 8px; padding: 8px 12px; }
.course-conversation__message--own { align-self: flex-end; background: #e3ebff; color: #0b1f4d; }
.course-conversation__message--other { align-self: flex-start; background: #f1f3f6; color: #1f2937; }
.course-conversation__body { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
