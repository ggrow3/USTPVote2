<script setup lang="ts">
import { computed } from 'vue';
import { ROOM_VOICE_LIMITS, type RoomVoiceView } from 'ustp-domain';
import type { JokeVoice } from './joke-voice.js';
import { peopleLine } from './room-text.js';
import type { VoiceCall } from './voice.js';

/**
 * The room's call (design §5.10), over the chat: who is in it, a ring around whoever is speaking (heard in this browser),
 * the microphone's switch and the way out. The assistant appears in it only while it reads out a joke.
 */
const props = defineProps<{
  voice: readonly RoomVoiceView[];
  call: VoiceCall;
  jokes: JokeVoice;
}>();
const emit = defineEmits<{ join: []; leave: []; mute: [muted: boolean]; joke: [] }>();

const s = computed(() => props.call.state);
const inCall = computed(() => s.value.sessionId !== null);
const full = computed(() => props.voice.length >= ROOM_VOICE_LIMITS.participants && !props.voice.some((v) => v.mine));

/** The member's own switch shows at once; others' as the room last heard. */
const muted = (p: RoomVoiceView) => (p.mine ? s.value.muted : p.muted);

function label(p: RoomVoiceView): string {
  const parts = [p.mine ? 'You' : p.name];
  if (muted(p)) parts.push('muted');
  else if (s.value.speaking[p.accountId]) parts.push('speaking');
  const peer = s.value.peers[p.accountId];
  if (!p.mine && peer === 'connecting') parts.push('connecting');
  if (!p.mine && peer === 'failed') parts.push('could not connect');
  return parts.join(', ');
}
</script>

<template>
  <section class="voice-bar" :class="{ 'voice-bar--in': inCall }" aria-label="Voice call">
    <div class="voice-bar__people">
      <template v-if="!inCall">
        <q-icon name="headset_mic" size="20px" class="text-grey-7" aria-hidden="true" />
        <span v-if="voice.length">{{ voice.length }} in the call: {{ peopleLine(voice.map((p) => p.name)) }}</span>
        <span v-else class="text-grey-7">Nobody is in the call. Join to talk while you chat.</span>
      </template>
      <template v-else>
        <div
          v-for="p in voice"
          :key="p.accountId"
          class="voice-person"
          :class="{
            'voice-person--speaking': !muted(p) && s.speaking[p.accountId],
            'voice-person--waiting': !p.mine && s.peers[p.accountId] !== 'connected',
          }"
          role="img"
          :aria-label="label(p)"
        >
          <div class="voice-person__ring">
            <q-avatar size="36px" color="grey-4" text-color="grey-9">{{ p.name.slice(0, 1) }}</q-avatar>
            <q-icon v-if="muted(p)" name="mic_off" class="voice-person__badge" size="14px" />
            <q-icon v-else-if="!p.mine && s.peers[p.accountId] === 'failed'" name="sync_problem" class="voice-person__badge" size="14px" />
          </div>
          <span class="voice-person__name">{{ p.mine ? 'You' : p.name }}</span>
          <q-tooltip v-if="!p.mine && s.peers[p.accountId] === 'failed'" max-width="260px">
            Your browsers could not reach each other: one of your networks blocks direct calls.
          </q-tooltip>
        </div>
        <div
          v-if="jokes.state.present"
          class="voice-person voice-person--bot"
          :class="{ 'voice-person--speaking': jokes.state.speaking }"
          role="img"
          :aria-label="`Assistant${jokes.state.speaking ? ', speaking' : ''}`"
        >
          <div class="voice-person__ring">
            <q-avatar size="36px" color="primary" text-color="white" icon="smart_toy" />
          </div>
          <span class="voice-person__name">Assistant</span>
        </div>
      </template>
    </div>

    <div class="voice-bar__actions">
      <template v-if="!inCall">
        <q-btn
          unelevated
          no-caps
          color="positive"
          icon="call"
          label="Join voice"
          :loading="s.joining"
          :disable="full"
          @click="emit('join')"
        >
          <q-tooltip v-if="full">The call is full: {{ ROOM_VOICE_LIMITS.participants }} people at most.</q-tooltip>
        </q-btn>
      </template>
      <template v-else>
        <q-btn flat dense no-caps icon="sentiment_very_satisfied" label="Lame joke" @click="emit('joke')">
          <q-tooltip>The assistant joins the call to tell a lame joke (/joke)</q-tooltip>
        </q-btn>
        <q-btn
          round
          unelevated
          :color="s.muted ? 'negative' : 'grey-3'"
          :text-color="s.muted ? 'white' : 'grey-9'"
          :icon="s.muted ? 'mic_off' : 'mic'"
          :aria-label="s.muted ? 'Unmute' : 'Mute'"
          :aria-pressed="s.muted"
          @click="emit('mute', !s.muted)"
        >
          <q-tooltip>{{ s.muted ? 'Unmute' : 'Mute' }}</q-tooltip>
        </q-btn>
        <q-btn round unelevated color="negative" icon="call_end" aria-label="Leave the call" @click="emit('leave')">
          <q-tooltip>Leave the call (you stay in the chat)</q-tooltip>
        </q-btn>
      </template>
      <q-btn flat round dense size="sm" icon="info_outline" aria-label="About the call">
        <q-tooltip max-width="300px">
          Voice goes straight between browsers, encrypted, and is never recorded: the party’s servers only connect you.
          Others in the call can see your internet address, as in any direct call.
        </q-tooltip>
      </q-btn>
    </div>

    <div v-if="s.mutedTalking" class="voice-bar__hint" role="status">You’re muted. Unmute to be heard.</div>
  </section>
</template>

<style scoped>
.voice-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 8px 10px;
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 8px;
}
.voice-bar--in {
  border-color: rgba(33, 186, 69, 0.6);
  background: rgba(33, 186, 69, 0.05);
}
.voice-bar__people {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
}
.voice-bar__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.voice-bar__hint {
  flex-basis: 100%;
  font-size: 0.875em;
  color: var(--q-negative);
}
.voice-person {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 60px;
}
.voice-person__ring {
  position: relative;
  border-radius: 50%;
  padding: 2px;
  box-shadow: 0 0 0 2px transparent;
  transition: box-shadow 120ms ease-out;
}
.voice-person--speaking .voice-person__ring {
  box-shadow: 0 0 0 3px #21ba45;
  animation: voice-pulse 1.2s ease-in-out infinite;
}
.voice-person--waiting .voice-person__ring {
  opacity: 0.5;
}
.voice-person__badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  border-radius: 50%;
  padding: 2px;
  background: var(--q-negative);
  color: white;
}
.voice-person__name {
  max-width: 100%;
  font-size: 0.75em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@keyframes voice-pulse {
  50% {
    box-shadow: 0 0 0 5px rgba(33, 186, 69, 0.55);
  }
}
@media (prefers-reduced-motion: reduce) {
  .voice-person--speaking .voice-person__ring {
    animation: none;
  }
}
</style>
