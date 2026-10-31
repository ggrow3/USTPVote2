<script setup lang="ts">
import { computed } from 'vue';
import { ROOM_REACTION_EMOJI, ROOM_REACTIONS, type RoomMessageView, type RoomReaction, type RoomSource, type VoteValue } from 'ustp-domain';
import { linkParts } from '../forum/forum-text.js';
import VoteButtons from '../forum/VoteButtons.vue';
import { answerParts, messageName, messageTime, reactionLabel, SOURCE_LABELS } from './room-text.js';

/**
 * One message in the members' room (design §5.10): a member's (a question for the assistant marked as such, with
 * "thinking" while it waits), the assistant's answer with its numbered sources or a joke someone asked for, or a
 * notice of what someone did. A member's message or an answer takes up and down votes, as the forum's posts do, and
 * emoji reactions: its score and how many gave each reaction are shown, never who. While a message has neither, its
 * vote and reaction buttons show only when it is pointed at or focused, so the chat stays quiet.
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
  vote: [message: RoomMessageView, value: VoteValue];
  react: [message: RoomMessageView, reaction: RoomReaction, on: boolean];
}>();

const m = computed(() => props.message);
const parts = computed(() => (m.value.kind === 'assistant' ? answerParts(m.value.body, m.value.sources.length) : linkParts(m.value.body)));
const canDelete = computed(() => !m.value.deleted && (m.value.deletable || props.moderator));
const canDecide = computed(() => m.value.kind === 'member' && !m.value.deleted);
const sourceId = (n: number) => `src-${m.value.messageId}-${n}`;
const name = computed(() => messageName(m.value));
const idle = computed(() => m.value.score === 0 && m.value.myVote === 0 && !m.value.reactions.length);
const given = computed(() => new Set(m.value.reactions.filter((r) => r.mine).map((r) => r.reaction)));
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
        <div class="room-msg__actions">
          <div v-if="m.reactable" class="room-msg__tools" :class="{ 'room-msg__tools--idle': idle }">
            <VoteButtons row :score="m.score" :my-vote="m.myVote" :what="name" @vote="(v) => emit('vote', m, v)" />
            <q-btn flat round dense size="sm" icon="add_reaction" color="grey-7" :aria-label="`React to ${name}`">
              <q-tooltip>React</q-tooltip>
              <q-menu auto-close anchor="bottom right" self="top right">
                <div class="room-react-menu" role="group" :aria-label="`Reactions to ${name}`">
                  <q-btn
                    v-for="r in ROOM_REACTIONS"
                    :key="r"
                    flat
                    dense
                    class="room-react-menu__emoji"
                    :class="{ 'room-react-menu__emoji--mine': given.has(r) }"
                    :aria-label="ROOM_REACTION_EMOJI[r].label"
                    :aria-pressed="given.has(r)"
                    @click="emit('react', m, r, !given.has(r))"
                  >
                    <span aria-hidden="true">{{ ROOM_REACTION_EMOJI[r].emoji }}</span>
                  </q-btn>
                </div>
              </q-menu>
            </q-btn>
          </div>
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
      <div v-if="m.reactions.length" class="room-reactions" role="group" aria-label="Reactions">
        <q-btn
          v-for="r in m.reactions"
          :key="r.reaction"
          unelevated
          dense
          no-caps
          rounded
          class="room-reaction"
          :class="{ 'room-reaction--mine': r.mine }"
          :aria-label="reactionLabel(ROOM_REACTION_EMOJI[r.reaction].label, r.count, r.mine)"
          :aria-pressed="r.mine"
          @click="emit('react', m, r.reaction, !r.mine)"
        >
          <span aria-hidden="true">{{ ROOM_REACTION_EMOJI[r.reaction].emoji }}</span>
          <span class="room-reaction__count" aria-hidden="true">{{ r.count }}</span>
          <q-tooltip>{{ reactionLabel(ROOM_REACTION_EMOJI[r.reaction].label, r.count, r.mine) }}</q-tooltip>
        </q-btn>
      </div>
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
  flex-wrap: wrap;
  align-items: center;
  gap: 0 6px;
  min-height: 24px;
}
.room-msg__name {
  font-weight: 600;
}
.room-time {
  font-size: 0.8em;
  margin-left: 6px;
  white-space: nowrap;
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
.room-msg__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  /* On a narrow screen the buttons wrap below the name together, still to the right. */
  margin-left: auto;
}
.room-msg__tools {
  display: flex;
  align-items: center;
  gap: 2px;
}
/* Pointing devices see a quiet message's buttons on hover or focus; touch screens always see them. */
@media (hover: hover) {
  .room-msg__tools--idle {
    opacity: 0;
    transition: opacity 0.12s;
  }
  .room-msg:hover .room-msg__tools--idle,
  .room-msg:focus-within .room-msg__tools--idle {
    opacity: 1;
  }
}
.room-reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.room-reaction {
  background: rgba(128, 128, 128, 0.12);
  border: 1px solid transparent;
  padding: 0 8px;
  min-height: 26px;
  font-size: 0.9rem;
}
.room-reaction--mine {
  background: rgba(25, 118, 210, 0.12);
  border-color: var(--q-primary);
}
.room-reaction__count {
  margin-left: 4px;
  font-weight: 600;
  font-size: 0.8rem;
}
.room-react-menu {
  display: flex;
  padding: 4px;
}
.room-react-menu__emoji {
  font-size: 1.35rem;
  min-width: 40px;
  min-height: 40px;
}
.room-react-menu__emoji--mine {
  background: rgba(25, 118, 210, 0.15);
}
.room-notice {
  text-align: center;
  font-size: 0.875em;
  padding: 4px 8px;
  overflow-wrap: anywhere;
}
</style>
