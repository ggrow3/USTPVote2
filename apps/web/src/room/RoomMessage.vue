<script setup lang="ts">
import { computed } from 'vue';
import type { RoomMessageView, RoomSource } from 'ustp-domain';
import { linkParts } from '../forum/forum-text.js';
import { answerParts, messageTime, SOURCE_LABELS } from './room-text.js';

/**
 * One message in the members' room (design §5.10): a member's (a question for the assistant marked as such, with
 * "thinking" while it waits), the assistant's answer with its numbered sources or a joke someone asked for, or a
 * notice of what someone did.
 */
const props = defineProps<{
  message: RoomMessageView;
  /** The assistant is still working on this question. */
  pending: boolean;
  /** A Membership Admin, who may delete anyone's message. */
  moderator: boolean;
}>();
const emit = defineEmits<{
  decide: [message: RoomMessageView];
  delete: [message: RoomMessageView];
  source: [source: RoomSource];
}>();

const m = computed(() => props.message);
const parts = computed(() => (m.value.kind === 'assistant' ? answerParts(m.value.body, m.value.sources.length) : linkParts(m.value.body)));
const canDelete = computed(() => !m.value.deleted && (m.value.deletable || props.moderator));
const canDecide = computed(() => m.value.kind === 'member' && !m.value.deleted);
const sourceId = (n: number) => `src-${m.value.messageId}-${n}`;
</script>

<template>
  <div v-if="m.kind === 'notice'" :id="`msg-${m.messageId}`" class="room-notice text-grey-7">
    <template v-if="m.deleted">A note was removed with what it was about.</template>
    <template v-else>
      <strong>{{ m.author?.name }}</strong> {{ m.body }}
    </template>
    <span class="room-time text-grey-7">{{ messageTime(m.createdAt) }}</span>
  </div>

  <div v-else :id="`msg-${m.messageId}`" class="room-msg" :class="{ 'room-msg--assistant': m.kind === 'assistant', 'room-msg--mine': m.mine }">
    <q-avatar
      size="32px"
      :color="m.kind === 'assistant' ? 'primary' : 'grey-4'"
      :text-color="m.kind === 'assistant' ? 'white' : 'grey-9'"
      :icon="m.kind === 'assistant' ? 'smart_toy' : undefined"
      aria-hidden="true"
    >
      <template v-if="m.kind !== 'assistant'">{{ (m.author?.name ?? '?').slice(0, 1) }}</template>
    </q-avatar>
    <div class="room-msg__main">
      <div class="room-msg__head">
        <span class="room-msg__name">{{ m.kind === 'assistant' ? 'Assistant' : m.author?.name }}</span>
        <q-badge v-if="m.ask" outline color="primary" label="/ask" class="q-ml-xs" />
        <span v-if="m.joke" class="room-joke-for text-grey-7">a lame joke for {{ m.author?.name }}</span>
        <span class="room-time text-grey-7">{{ messageTime(m.createdAt) }}</span>
        <q-space />
        <q-btn v-if="canDelete || canDecide" flat round dense size="sm" icon="more_horiz" :aria-label="`Actions for this message`">
          <q-menu auto-close>
            <q-list dense style="min-width: 180px">
              <q-item v-if="canDecide" clickable @click="emit('decide', m)">
                <q-item-section avatar><q-icon name="gavel" /></q-item-section>
                <q-item-section>Log as a decision</q-item-section>
              </q-item>
              <q-item v-if="canDelete" clickable @click="emit('delete', m)">
                <q-item-section avatar><q-icon name="delete" /></q-item-section>
                <q-item-section>Delete{{ m.mine ? '' : ' (Membership Admin)' }}</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </div>
      <div v-if="m.deleted" class="room-msg__gone text-grey-7">Message deleted.</div>
      <div v-else class="room-msg__body">
        <template v-for="(part, i) in parts" :key="i">
          <a v-if="'href' in part && part.href" :href="part.href" target="_blank" rel="noopener noreferrer nofollow ugc">{{ part.text }}</a>
          <a v-else-if="'cite' in part && part.cite" :href="`#${sourceId(part.cite)}`" class="room-cite" :aria-label="`Source ${part.cite}`">{{ part.text }}</a>
          <template v-else>{{ part.text }}</template>
        </template>
      </div>
      <ol v-if="m.kind === 'assistant' && m.sources.length" class="room-sources">
        <li v-for="(s, i) in m.sources" :id="sourceId(i + 1)" :key="s.id">
          <a href="#" @click.prevent="emit('source', s)">{{ SOURCE_LABELS[s.kind] }}</a>
          <span class="text-grey-7"> · {{ messageTime(s.at) }} · </span>{{ s.excerpt }}
        </li>
      </ol>
      <div v-if="pending" class="room-thinking" role="status">
        <q-spinner-dots size="18px" color="primary" /> The assistant is thinking… The first question after a quiet spell
        waits a minute or two while its model starts.
      </div>
    </div>
  </div>
</template>

<style scoped>
.room-msg {
  display: flex;
  gap: 10px;
  padding: 6px 4px;
  border-radius: 8px;
}
.room-msg--assistant {
  background: rgba(25, 118, 210, 0.06);
}
.room-msg__main {
  min-width: 0;
  flex: 1;
}
.room-msg__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
}
.room-msg__name {
  font-weight: 600;
}
.room-time {
  font-size: 0.8em;
  margin-left: 6px;
}
.room-joke-for {
  font-size: 0.8em;
  font-style: italic;
}
.room-msg__body {
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.room-msg__gone {
  font-style: italic;
}
.room-cite {
  font-size: 0.8em;
  vertical-align: super;
  text-decoration: none;
  margin: 0 1px;
}
.room-sources {
  margin: 6px 0 0;
  padding-left: 1.4em;
  font-size: 0.875em;
}
.room-sources li {
  overflow-wrap: anywhere;
}
.room-thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 0.875em;
}
.room-notice {
  text-align: center;
  font-size: 0.875em;
  padding: 4px 8px;
  overflow-wrap: anywhere;
}
</style>
