<script setup lang="ts">
import { computed, ref } from 'vue';
import { amendmentText, type ProposalSnapshotRecord } from 'ustp-domain';
import { textToCapture, type QuestionDraft } from './question-model.js';

/**
 * The text a yes / no / abstain question puts to the vote (design §6.4, §6.5), written in place or chosen from the
 * texts already captured. A text is captured, immutable and hashed, when its field is left with changes; a bylaws
 * amendment comes from the bylaws editor (§6.6) and is shown, never edited, here.
 */
const props = defineProps<{
  question: QuestionDraft;
  texts: readonly ProposalSnapshotRecord[];
  number: number;
  error?: string;
}>();
const emit = defineEmits<{
  /** A saved text was chosen: save now. */
  edited: [delay: number];
  /** The field was left with changes: capture the text and save. */
  commit: [];
  /** The field changed without being left yet. */
  typing: [];
}>();

const q = props.question;
const attached = computed(() => props.texts.find((t) => t.snapshotId === q.proposalSnapshotId) ?? null);
const waiting = computed(() => textToCapture(q, props.texts));
const filter = ref('');
const choices = computed(() => {
  const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
  return props.texts
    .filter((t) => words.every((w) => `${t.title} ${t.body}`.toLowerCase().includes(w)))
    .slice(0, 50)
    .map((t) => ({
      label: t.title,
      caption: `${t.amendment ? `Bylaws amendment to version ${t.amendment.base.version} · ` : ''}captured ${new Date(t.capturedAt).toLocaleDateString()} · hash ${t.contentHash.slice(0, 8)}…`,
      value: t.snapshotId,
    }));
});

function search(text: string, update: (fn: () => void) => void) {
  update(() => (filter.value = text));
}

function choose(snapshotId: string | null) {
  if (!snapshotId) return;
  const text = props.texts.find((t) => t.snapshotId === snapshotId);
  q.proposalSnapshotId = snapshotId;
  q.text = text && !text.amendment ? text.body : '';
  emit('edited', 0);
}

function useOwnText() {
  q.proposalSnapshotId = null;
  q.text = '';
  emit('edited', 0);
}
</script>

<template>
  <div class="ustp-form">
    <template v-if="attached?.amendment">
      <div>
        <div class="text-weight-medium">Changes to the bylaws, version {{ attached.amendment.base.version }}</div>
        <div class="ustp-amendment q-mt-xs">{{ amendmentText(attached.amendment) }}</div>
        <div class="q-mt-xs" style="white-space: pre-wrap"><span class="text-weight-medium">Reasons given: </span>{{ attached.body }}</div>
        <div class="text-caption text-grey-7 q-mt-xs">
          Written in the bylaws editor, so it is not changed here · content hash <code>{{ attached.contentHash.slice(0, 16) }}…</code>
        </div>
      </div>
      <q-btn flat dense no-caps color="primary" label="Write a text instead" @click="useOwnText">
        <span class="sr-only">&nbsp;for question {{ number }}</span>
      </q-btn>
    </template>
    <q-input
      v-else
      v-model="q.text"
      outlined
      autogrow
      type="textarea"
      hide-bottom-space
      input-style="min-height: 6em"
      label="Text members vote on"
      :data-text="q.id"
      :error="!!error"
      :error-message="error"
      :hint="
        waiting
          ? 'Saved when you leave this field. Once saved, a text never changes: editing it saves a new one.'
          : attached
            ? `Saved and fixed · content hash ${attached.contentHash.slice(0, 16)}…`
            : 'Paste or write the full text. It is saved when you leave this field.'
      "
      @update:model-value="emit('typing')"
      @change="emit('commit')"
    />
    <q-select
      :model-value="null"
      outlined
      dense
      use-input
      hide-selected
      input-debounce="0"
      emit-value
      :options="choices"
      :label="attached ? 'Or use another saved text' : 'Or use a saved text'"
      hint="Texts captured before, bylaws amendments included. Type words from a title or text to find one."
      hide-bottom-space
      @filter="search"
      @update:model-value="choose"
    >
      <template #option="scope">
        <q-item v-bind="scope.itemProps">
          <q-item-section>
            <q-item-label>{{ scope.opt.label }}</q-item-label>
            <q-item-label caption>{{ scope.opt.caption }}</q-item-label>
          </q-item-section>
        </q-item>
      </template>
      <template #no-option>
        <q-item><q-item-section class="text-grey-7">No saved text has those words.</q-item-section></q-item>
      </template>
    </q-select>
  </div>
</template>
