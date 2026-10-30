<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ROOM_LIMITS, type RoomActionView, type RoomPerson } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { addAction, updateAction } from './api.js';

/**
 * `/todo` (design §5.10): an action item with its owner, someone in the room, and an optional due date; or an existing
 * one changed. A name appears in the room's memory only as an action item's owner.
 */
const props = defineProps<{
  people: readonly RoomPerson[];
  /** Prefilled task for a new item. */
  task: string;
  /** The item to change, or null for a new one. */
  item: RoomActionView | null;
  myId: string;
  /** Change it as a Membership Admin (it is neither theirs nor added by them). */
  asAdmin: boolean;
}>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [] }>();

const text = ref('');
const ownerId = ref<string | null>(null);
const due = ref('');
const busy = ref(false);
const owners = computed(() => props.people.map((p) => ({ value: p.accountId, label: p.accountId === props.myId ? `${p.name} (you)` : p.name })));

watch(open, (shown) => {
  if (!shown) return;
  text.value = props.item?.text ?? props.task;
  ownerId.value = props.item?.owner.accountId ?? props.myId;
  due.value = props.item?.due ?? '';
});

async function save() {
  if (!text.value.trim() || !ownerId.value) return;
  busy.value = true;
  const fields = { task: text.value.trim(), ownerId: ownerId.value, due: due.value || null };
  const done = await attempt(
    () => (props.item ? updateAction(props.item.itemId, { ...fields, status: props.item.status }, props.asAdmin) : addAction(fields)),
    props.item ? 'Action item saved' : 'Action item added',
  );
  busy.value = false;
  if (done) {
    emit('saved');
    open.value = false;
  }
}
</script>

<template>
  <q-dialog v-model="open" :aria-label="item ? 'Change the action item' : 'Add an action item'">
    <q-card class="room-dialog">
      <q-card-section>
        <h2 class="text-h6">{{ item ? 'Change the action item' : 'Add an action item' }}</h2>
        <div class="text-caption text-grey-7">Kept until 90 days after it is done.</div>
      </q-card-section>
      <q-card-section class="ustp-form">
        <q-input v-model="text" outlined autogrow autofocus label="What needs doing" :maxlength="ROOM_LIMITS.task" />
        <q-select v-model="ownerId" outlined emit-value map-options :options="owners" label="Owner" hint="Someone in the room" />
        <q-input v-model="due" outlined type="date" label="Due (optional)" stack-label clearable />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat no-caps label="Cancel" @click="open = false" />
        <q-btn unelevated no-caps color="primary" :label="item ? 'Save' : 'Add'" :disable="!text.trim() || !ownerId" :loading="busy" @click="save" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.room-dialog {
  width: min(560px, 100vw - 32px);
}
</style>
