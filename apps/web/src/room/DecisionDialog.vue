<script setup lang="ts">
import { ref, watch } from 'vue';
import { ROOM_LIMITS, type RoomMessageView } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { decide } from './api.js';

/**
 * `/decide` (design §5.10): a decision, logged as the group's. Logged from a message, it keeps what that message said,
 * so the record outlives the message.
 */
const props = defineProps<{ from: RoomMessageView | null; text: string }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ logged: [] }>();

const value = ref('');
const busy = ref(false);
watch(open, (shown) => {
  if (shown) value.value = props.text;
});

async function save() {
  if (!value.value.trim()) return;
  busy.value = true;
  const done = await attempt(() => decide({ text: value.value.trim(), messageId: props.from?.messageId ?? null }), 'Decision logged');
  busy.value = false;
  if (done) {
    emit('logged');
    open.value = false;
  }
}
</script>

<template>
  <q-dialog v-model="open" aria-label="Log a decision">
    <q-card class="room-dialog">
      <q-card-section>
        <h2 class="text-h6">Log a decision</h2>
        <div class="text-caption text-grey-7">
          Recorded as the group’s decision, with today’s date, and kept until someone removes it. Everyone in the room sees
          it, and the assistant answers from it.
        </div>
      </q-card-section>
      <q-card-section class="ustp-form">
        <q-banner v-if="from" class="bg-grey-2 text-black" rounded dense>
          From {{ from.author?.name }}: “{{ from.body.length > 200 ? `${from.body.slice(0, 200)}…` : from.body }}”
        </q-banner>
        <q-input v-model="value" outlined autogrow autofocus label="What was decided" :maxlength="ROOM_LIMITS.decision" />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat no-caps label="Cancel" @click="open = false" />
        <q-btn unelevated no-caps color="primary" label="Log decision" :disable="!value.trim()" :loading="busy" @click="save" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.room-dialog {
  width: min(560px, 100vw - 32px);
}
</style>
