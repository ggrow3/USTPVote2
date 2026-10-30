<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { memoryMatches, searchWords, type RoomActionView, type RoomDecisionView, type RoomMemory } from 'ustp-domain';
import { attempt, dialog } from '../dialogs.js';
import { forget, memory, updateAction } from './api.js';
import { dueLabel, messageTime, overdue } from './room-text.js';

/**
 * `/memory` and `/forget` (design §5.10): everything the assistant keeps besides the chat itself, the group's
 * decisions and action items, searched here in the browser; whoever added an item, or a Membership Admin, deletes it
 * for good.
 */
const props = defineProps<{
  /** Search for this when opened. */
  query: string;
  /** Changes when memory changes, so an open panel reloads. */
  memorySeq: number;
  moderator: boolean;
  /** An item to scroll to and mark, from an answer's sources. */
  highlight: string | null;
}>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ edit: [item: RoomActionView] }>();

const q = ref('');
const all = ref<RoomMemory | null>(null);
const tab = ref<'decisions' | 'actions'>('decisions');
let loads = 0;

/** Loads memory; a load overtaken by a later one is dropped. */
async function load(): Promise<RoomMemory | null> {
  const n = ++loads;
  await attempt(async () => {
    const loaded = await memory();
    if (n === loads) all.value = loaded;
  });
  return all.value;
}

/** What the search matches: every word in an item's text, quote or due date. */
const data = computed<(RoomMemory & { readonly q: string | null }) | null>(() => {
  if (!all.value) return null;
  const words = searchWords(q.value ?? '');
  if (!words.length) return { ...all.value, q: null };
  return {
    ...all.value,
    decisions: all.value.decisions.filter((d) => memoryMatches(d, words)),
    actions: all.value.actions.filter((a) => memoryMatches(a, words)),
    q: q.value,
  };
});

watch(open, async (shown) => {
  if (!shown) return;
  q.value = props.query;
  all.value = null;
  const loaded = await load();
  if (props.highlight) {
    const isAction = loaded?.actions.some((a) => a.itemId === props.highlight);
    tab.value = isAction ? 'actions' : 'decisions';
    await nextTick();
    document.getElementById(`mem-${props.highlight}`)?.scrollIntoView({ block: 'center' });
  } else if (loaded && !loaded.decisions.length && loaded.actions.length) {
    tab.value = 'actions';
  }
});
watch(
  () => props.memorySeq,
  () => {
    if (open.value) void load();
  },
);

const openActions = computed(() => data.value?.actions.filter((a) => a.status === 'open').length ?? 0);

async function toggle(item: RoomActionView, done: boolean) {
  const asAdmin = !item.editable;
  await attempt(async () => {
    await updateAction(item.itemId, { task: item.text, ownerId: item.owner.accountId, due: item.due, status: done ? 'done' : 'open' }, asAdmin);
    await load();
  });
}

function remove(item: RoomDecisionView | RoomActionView) {
  dialog({
    title: item.kind === 'decision' ? 'Forget this decision?' : 'Forget this action item?',
    message: `“${item.text}” is deleted for good, with the room’s note about it. The assistant will no longer know it.`,
    cancel: { flat: true, noCaps: true, label: 'Keep it' },
    ok: { unelevated: true, noCaps: true, color: 'negative', label: 'Forget it' },
  }).onOk(() => {
    void attempt(async () => {
      await forget(item.itemId, !item.forgettable);
      await load();
    }, 'Forgotten');
  });
}

const mayForget = (item: RoomDecisionView | RoomActionView) => item.forgettable || props.moderator;
const mayEdit = (item: RoomActionView) => item.editable || props.moderator;
</script>

<template>
  <q-dialog v-model="open" position="right" full-height aria-label="The room’s memory">
    <q-card class="room-memory">
      <q-card-section class="row items-center no-wrap q-pb-sm">
        <div class="col">
          <h2 class="text-h6 q-my-none">Memory</h2>
          <div class="text-caption text-grey-7">Everything the assistant keeps besides the chat. Nothing about anyone as a person.</div>
        </div>
        <q-btn flat round dense icon="close" aria-label="Close" @click="open = false" />
      </q-card-section>
      <q-card-section class="q-py-sm">
        <q-input v-model="q" outlined dense clearable placeholder="Search decisions and action items" aria-label="Search memory">
          <template #prepend><q-icon name="search" /></template>
        </q-input>
      </q-card-section>
      <q-tabs v-model="tab" dense no-caps align="left" active-color="primary">
        <q-tab name="decisions" :label="`Decisions${data ? ` (${data.decisions.length})` : ''}`" />
        <q-tab name="actions" :label="`Action items${data ? ` (${openActions} open)` : ''}`" />
      </q-tabs>
      <q-separator />
      <q-card-section class="room-memory__list">
        <div v-if="!data" class="text-grey-7">Loading…</div>
        <template v-else-if="tab === 'decisions'">
          <div v-if="!data.decisions.length" class="text-grey-7">
            {{ data.q ? 'No decision matches.' : 'No decisions yet. Log one with /decide, or from a message’s menu.' }}
          </div>
          <q-list v-else separator>
            <q-item v-for="d in data.decisions" :id="`mem-${d.itemId}`" :key="d.itemId" :class="{ 'room-memory__hl': d.itemId === highlight }">
              <q-item-section>
                <q-item-label class="room-memory__text">{{ d.text }}</q-item-label>
                <q-item-label v-if="d.quote" caption class="room-memory__text">From the message: “{{ d.quote }}”</q-item-label>
                <q-item-label caption>Logged by {{ d.createdBy.name }}, {{ messageTime(d.createdAt) }}</q-item-label>
              </q-item-section>
              <q-item-section v-if="mayForget(d)" side>
                <q-btn flat round dense icon="delete_outline" :aria-label="`Forget “${d.text}”`" @click="remove(d)" />
              </q-item-section>
            </q-item>
          </q-list>
        </template>
        <template v-else>
          <div v-if="!data.actions.length" class="text-grey-7">
            {{ data.q ? 'No action item matches.' : 'No action items yet. Add one with /todo.' }}
          </div>
          <q-list v-else separator>
            <q-item v-for="a in data.actions" :id="`mem-${a.itemId}`" :key="a.itemId" :class="{ 'room-memory__hl': a.itemId === highlight }">
              <q-item-section side top>
                <q-checkbox
                  :model-value="a.status === 'done'"
                  :disable="!mayEdit(a)"
                  :aria-label="a.status === 'done' ? `Reopen “${a.text}”` : `Mark “${a.text}” done`"
                  @update:model-value="(v: boolean) => toggle(a, v)"
                />
              </q-item-section>
              <q-item-section>
                <q-item-label class="room-memory__text" :class="{ 'text-strike text-grey-7': a.status === 'done' }">{{ a.text }}</q-item-label>
                <q-item-label caption>
                  {{ a.owner.name }}<template v-if="a.due">
                    · <span :class="{ 'text-negative': a.status === 'open' && overdue(a.due) }">due {{ dueLabel(a.due) }}</span></template
                  ><template v-if="a.status === 'done' && a.doneAt"> · done {{ messageTime(a.doneAt) }}</template>
                </q-item-label>
              </q-item-section>
              <q-item-section v-if="mayEdit(a) || mayForget(a)" side>
                <div class="row no-wrap">
                  <q-btn v-if="mayEdit(a)" flat round dense icon="edit" :aria-label="`Change “${a.text}”`" @click="emit('edit', a)" />
                  <q-btn v-if="mayForget(a)" flat round dense icon="delete_outline" :aria-label="`Forget “${a.text}”`" @click="remove(a)" />
                </div>
              </q-item-section>
            </q-item>
          </q-list>
        </template>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.room-memory {
  width: min(440px, 100vw);
  display: flex;
  flex-direction: column;
}
.room-memory__list {
  flex: 1;
  overflow-y: auto;
}
.room-memory__text {
  overflow-wrap: anywhere;
}
.room-memory__hl {
  background: rgba(25, 118, 210, 0.1);
  border-radius: 6px;
}
</style>
