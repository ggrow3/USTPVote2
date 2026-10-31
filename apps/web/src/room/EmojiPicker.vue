<script setup lang="ts">
import { computed, ref } from 'vue';
import { EMOJI_GROUPS, findEmojis, type Emoji } from './emoji.js';

/**
 * The composer's emoji button (design §5.10): a menu of emojis by group, searched by name; Enter in the search takes
 * the first found. Picking one closes it, and the room page puts the emoji where the caret was.
 */
defineProps<{ disable?: boolean }>();
const emit = defineEmits<{ pick: [emoji: string] }>();

const open = ref(false);
const query = ref('');
const found = computed(() => findEmojis(query.value));

function pick(e: Emoji) {
  open.value = false;
  emit('pick', e.char);
}

function pickFirst() {
  if (found.value[0]) pick(found.value[0]);
}
</script>

<template>
  <q-btn flat round dense icon="mood" color="grey-8" aria-label="Add an emoji" :disable="disable">
    <q-tooltip>Emoji</q-tooltip>
    <q-menu v-model="open" anchor="top right" self="bottom right" :offset="[0, 6]" @hide="query = ''">
      <div class="emoji-picker">
        <q-input v-model="query" dense outlined autofocus clearable placeholder="Search emoji" aria-label="Search emoji" @keydown.enter.prevent="pickFirst" />
        <div class="emoji-picker__scroll">
          <template v-if="query.trim()">
            <div v-if="found.length" class="emoji-picker__grid" role="group" aria-label="Emojis found">
              <button v-for="e in found" :key="e.char" type="button" class="emoji-picker__emoji" :title="e.name" :aria-label="e.name" @click="pick(e)">
                {{ e.char }}
              </button>
            </div>
            <div v-else class="text-grey-7 q-pa-sm">No emoji by that name.</div>
          </template>
          <template v-else>
            <section v-for="g in EMOJI_GROUPS" :key="g.name" :aria-label="g.name">
              <div class="emoji-picker__label text-grey-7">{{ g.name }}</div>
              <div class="emoji-picker__grid" role="group" :aria-label="g.name">
                <button v-for="e in g.emojis" :key="e.char" type="button" class="emoji-picker__emoji" :title="e.name" :aria-label="e.name" @click="pick(e)">
                  {{ e.char }}
                </button>
              </div>
            </section>
          </template>
        </div>
      </div>
    </q-menu>
  </q-btn>
</template>

<style scoped>
.emoji-picker {
  width: min(320px, calc(100vw - 32px));
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.emoji-picker__scroll {
  max-height: 260px;
  overflow-y: auto;
}
.emoji-picker__label {
  font-size: 0.75rem;
  margin: 6px 2px 2px;
}
.emoji-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
}
.emoji-picker__emoji {
  font-size: 1.35rem;
  line-height: 1;
  height: 36px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  padding: 0;
}
.emoji-picker__emoji:hover {
  background: rgba(128, 128, 128, 0.18);
}
.emoji-picker__emoji:focus-visible {
  outline: 2px solid var(--q-primary);
  outline-offset: -2px;
}
</style>
