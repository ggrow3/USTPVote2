<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import type { ElectionDetail, ProposalSnapshotRecord, PublicElectionCheck } from 'ustp-domain';
import { announce, focusElement, focusSoon } from '../a11y.js';
import { errorMessage } from '../api.js';
import { toLocalInput } from '../election-text.js';
import { offices } from '../offices/api.js';
import { captureProposalText, deleteQuestion as deleteQuestionApi, reorderQuestions, saveQuestion, updateElection } from './api.js';
import { announcements, saveStatusText, undoText } from './builder-text.js';
import { useDragReorder } from './drag-reorder.js';
import QuestionCard from './QuestionCard.vue';
import {
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  copyQuestion,
  detailsBody,
  detailsErrors,
  moveItem,
  newQuestion,
  questionBody,
  questionErrors,
  questionFromRecords,
  textToCapture,
  withType,
  type BallotDetails,
  type OptionDraft,
  type QuestionDraft,
  type QuestionType,
} from './question-model.js';
import { SaveQueue, type SaveStatus } from './save-queue.js';

/**
 * The ballot builder (design §6.5): the election's details and its questions, edited in place as voters will read
 * them, like a form builder. Every edit saves itself after a pause in typing, or at once for adding, moving and
 * deleting; the bar at the bottom says whether everything is saved and undoes deletes. Only drafts are built here.
 */
const props = defineProps<{
  detail: ElectionDetail;
  texts: readonly ProposalSnapshotRecord[];
  /** The election setup check's notes (design §6.9), shown beside their questions. */
  checkNotes: Pick<PublicElectionCheck, 'findings' | 'quotedLines' | 'checker'> | null;
}>();
const emit = defineEmits<{
  /** The stored ballot changed: the page rereads the problems, the hash and the checks. */
  saved: [];
  /** A text was captured, for the page's list of texts. */
  textCaptured: [text: ProposalSnapshotRecord];
  /** Discard what is not saved and load the ballot again. */
  reload: [];
}>();

const TYPING_DELAY_MS = 800;
const ICONS: Record<QuestionType, string> = {
  yes_no: 'how_to_vote',
  choose_one: 'radio_button_checked',
  choose_several: 'check_box',
  rank: 'format_list_numbered',
};

const electionId = props.detail.election.electionId;
const texts = ref<ProposalSnapshotRecord[]>([...props.texts]);
const byOrder = [...props.detail.contests].sort((a, b) => a.order - b.order);
const questions = ref<QuestionDraft[]>(byOrder.map((c) => reactive(questionFromRecords(c, props.detail.candidates, props.texts))));

// --- what the server holds -----------------------------------------------------------------------------------

/** Questions the api has (so a save updates rather than creates, and a delete is sent). */
const stored = new Set(questions.value.map((q) => q.id));
/** The body each question was last saved with, so an unchanged question is not sent again. */
const lastSent = new Map(questions.value.map((q) => [q.id, JSON.stringify(questionBody(q))]));
let lastOrder = questions.value.map((q) => q.id).join();

const e = props.detail.election;
const details = reactive<BallotDetails>({
  title: e.title,
  description: e.description,
  secrecy: e.secrecy,
  opensAt: toLocalInput(e.opensAt),
  closesAt: toLocalInput(e.closesAt),
  kAnonymity: e.kAnonymity,
});
let detailsSent = JSON.stringify(detailsBody(details));

// --- saving --------------------------------------------------------------------------------------------------

const status = ref<SaveStatus>({ state: 'saved', error: null, failedKey: null });
const queue = new SaveQueue({
  onChange: (next) => {
    const was = status.value.state;
    status.value = next;
    if (next.state === 'error' && was !== 'error') announce(announcements.saveFailed(next.error ?? ''), 'assertive');
    else if (was === 'error' && next.state === 'saved') announce(announcements.savedAgain);
  },
  describe: errorMessage,
});

/** Texts typed but not yet left (saved on leaving), and texts left with changes (to capture on the next save). */
const typingTexts = reactive(new Set<string>());
const committedTexts = new Set<string>();

const errorsOf = computed(() => Object.fromEntries(questions.value.map((q) => [q.id, questionErrors(q)])));
const detailsError = computed(() => detailsErrors(details));
const unsaved = computed(
  () => questions.value.filter((q) => Object.keys(errorsOf.value[q.id]!).length > 0).length + (Object.keys(detailsError.value).length ? 1 : 0),
);
const statusText = computed(() => saveStatusText(status.value, unsaved.value, typingTexts.size));
const failedQuestion = computed(() => (status.value.failedKey?.startsWith('question:') ? status.value.failedKey.slice(9) : null));

let savedTimer: ReturnType<typeof setTimeout> | undefined;
/** Tells the page, once saving pauses, that the stored ballot changed. */
function savedSoon() {
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => emit('saved'), 1000);
}

function saveSoon(q: QuestionDraft, delay = TYPING_DELAY_MS) {
  queue.schedule(`question:${q.id}`, () => saveQuestionNow(q.id), delay);
}

async function saveQuestionNow(id: string) {
  const index = questions.value.findIndex((q) => q.id === id);
  const q = questions.value[index];
  // Deleted meanwhile, or not valid yet: the fields say what to fix, and the next edit saves.
  if (!q || Object.keys(questionErrors(q)).length) return;
  if (committedTexts.has(id)) {
    if (textToCapture(q, texts.value)) {
      const text = await captureProposalText({ title: q.title.trim(), body: q.text });
      texts.value.unshift(text);
      emit('textCaptured', text);
      q.proposalSnapshotId = text.snapshotId;
    } else if (!q.text.trim() && !texts.value.find((t) => t.snapshotId === q.proposalSnapshotId)?.amendment) {
      // The field was emptied: the question no longer has a text.
      q.proposalSnapshotId = null;
    }
    committedTexts.delete(id);
  }
  const body = questionBody(q);
  const json = JSON.stringify(body);
  const creating = !stored.has(id);
  if (!creating && lastSent.get(id) === json) return;
  await saveQuestion(electionId, id, { ...body, ...(creating && { position: index + 1 }) });
  stored.add(id);
  lastSent.set(id, json);
  // The order the api gave a new question may differ from the page's when others are still being saved.
  if (creating) scheduleOrder();
  savedSoon();
}

function scheduleOrder() {
  queue.schedule('order', saveOrderNow);
}

async function saveOrderNow() {
  const ids = questions.value.map((q) => q.id).filter((id) => stored.has(id));
  if (ids.join() === lastOrder) return;
  await reorderQuestions(electionId, ids);
  lastOrder = ids.join();
  savedSoon();
}

function saveDetailsSoon(delay = TYPING_DELAY_MS) {
  queue.schedule('details', saveDetailsNow, delay);
}

async function saveDetailsNow() {
  if (Object.keys(detailsErrors(details)).length) return;
  const body = detailsBody(details);
  const json = JSON.stringify(body);
  if (json === detailsSent) return;
  await updateElection(electionId, body);
  detailsSent = json;
  savedSoon();
}

/** Saves everything now (the page is being left); resolves whether all of it was saved. */
async function flush(): Promise<boolean> {
  for (const id of typingTexts) commitText(questions.value.find((q) => q.id === id));
  const saved = await queue.flush();
  return saved && unsaved.value === 0;
}
defineExpose({ flush });

function commitText(q: QuestionDraft | undefined) {
  if (!q) return;
  typingTexts.delete(q.id);
  committedTexts.add(q.id);
  saveSoon(q, 0);
}

function typingText(q: QuestionDraft) {
  if (textToCapture(q, texts.value)) typingTexts.add(q.id);
  else typingTexts.delete(q.id);
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (status.value.state !== 'saved' || unsaved.value || typingTexts.size) event.preventDefault();
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload);
  clearTimeout(savedTimer);
});

// --- undo ----------------------------------------------------------------------------------------------------

interface UndoItem {
  readonly text: string;
  readonly restore: () => void;
}
const undoStack = ref<UndoItem[]>([]);
const lastUndo = computed(() => undoStack.value.at(-1) ?? null);

function pushUndo(item: UndoItem) {
  undoStack.value = [...undoStack.value.slice(-19), item];
}

function undo() {
  const item = undoStack.value.at(-1);
  if (!item) return;
  undoStack.value = undoStack.value.slice(0, -1);
  item.restore();
  announce(announcements.restored(item.text));
}

// --- questions -----------------------------------------------------------------------------------------------

/** The question focus was last in: "Add question" in the bar adds after it. */
const activeId = ref<string | null>(null);

const titleSelector = (id: string) => `[data-title="${CSS.escape(id)}"]`;

async function focusTitle(id: string) {
  await nextTick();
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(titleSelector(id));
  focusElement(field);
  field?.select();
}

function add(type: QuestionType, at = questions.value.length) {
  const q = reactive(newQuestion(type));
  questions.value.splice(at, 0, q);
  activeId.value = q.id;
  saveSoon(q, 0);
  announce(announcements.questionAdded(at + 1, type));
  void focusTitle(q.id);
}

function addAfterActive(type: QuestionType) {
  const i = questions.value.findIndex((q) => q.id === activeId.value);
  add(type, i < 0 ? questions.value.length : i + 1);
}

function setType(q: QuestionDraft, type: QuestionType) {
  Object.assign(q, withType(q, type));
  announce(announcements.typeChanged(type));
  saveSoon(q, 0);
}

function duplicate(index: number) {
  const copy = reactive(copyQuestion(questions.value[index]!));
  questions.value.splice(index + 1, 0, copy);
  activeId.value = copy.id;
  saveSoon(copy, 0);
  announce(announcements.questionCopied(index + 2, copy.title));
  void focusTitle(copy.id);
}

function remove(index: number) {
  const [q] = questions.value.splice(index, 1);
  if (!q) return;
  queue.cancel(`question:${q.id}`);
  typingTexts.delete(q.id);
  // A delete always goes through the queue, so it follows a create still being sent.
  queue.schedule(`delete:${q.id}`, async () => {
    if (!stored.has(q.id)) return;
    await deleteQuestionApi(electionId, q.id);
    stored.delete(q.id);
    lastSent.delete(q.id);
    lastOrder = questions.value.map((x) => x.id).filter((id) => stored.has(id)).join();
    savedSoon();
  });
  pushUndo({ text: undoText.question(q.title), restore: () => restore(q, index) });
  announce(announcements.questionDeleted(q.title));
  const next = questions.value[index] ?? questions.value[index - 1];
  void focusSoon(next ? `[data-question-heading="${CSS.escape(next.id)}"]` : '[data-add-question]');
}

function restore(q: QuestionDraft, index: number) {
  questions.value.splice(Math.min(index, questions.value.length), 0, q);
  // Not deleted yet: dropping the delete leaves the stored question as it was.
  queue.cancel(`delete:${q.id}`);
  saveSoon(q, 0);
  scheduleOrder();
  void focusTitle(q.id);
}

function move(index: number, to: number) {
  if (to < 0 || to >= questions.value.length || to === index) return;
  const focused = document.activeElement as HTMLElement | null;
  const q = questions.value[index]!;
  questions.value = moveItem(questions.value, index, to);
  announce(announcements.questionMoved(q.title, to + 1, questions.value.length));
  scheduleOrder();
  // The card moved in the page, which can drop focus: put it back, on the other move button once this one is disabled.
  void nextTick(() => {
    if (!focused?.isConnected) return;
    if (focused.matches('[data-move-up], [data-move-down]') && focused.hasAttribute('disabled')) {
      focusElement(document.querySelector(`[data-move-${focused.matches('[data-move-up]') ? 'down' : 'up'}="${CSS.escape(q.id)}"]`));
    } else if (document.activeElement !== focused) focusElement(focused);
  });
}

function optionRemoved(q: QuestionDraft, option: OptionDraft, index: number) {
  pushUndo({
    text: undoText.option(option.name),
    restore: () => {
      if (!questions.value.includes(q)) return;
      q.options.splice(Math.min(index, q.options.length), 0, option);
      saveSoon(q, 0);
      void focusSoon(`[data-option="${CSS.escape(option.id)}"]`);
    },
  });
}

const cards = ref<{ $el: HTMLElement }[]>([]);
const drag = useDragReorder({
  items: () => cards.value.map((c) => c.$el),
  onMove: (from, to) => move(from, to),
});

// --- offices -------------------------------------------------------------------------------------------------

const officeOptions = ref<{ label: string; value: string | null }[]>([{ label: 'No office', value: null }]);
onMounted(() => {
  void offices()
    .then(({ positions }) => {
      officeOptions.value = [
        { label: 'No office', value: null },
        ...positions.map((p) => ({ label: `${p.title} (${p.seats} ${p.seats === 1 ? 'seat' : 'seats'}, ${p.termMonths}-month term)`, value: p.positionId })),
      ];
    })
    .catch(() => {});
});

const errorOf = (q: QuestionDraft) => ({
  ...errorsOf.value[q.id],
  ...(failedQuestion.value === q.id && status.value.error ? { _: status.value.error } : {}),
});

</script>

<template>
  <div class="ustp-builder ustp-stack">
    <q-card flat bordered class="ustp-builder__head">
      <q-card-section class="ustp-form">
        <q-input
          v-model="details.title"
          outlined
          hide-bottom-space
          class="ustp-builder__title"
          label="Ballot title"
          :error="!!detailsError.title"
          :error-message="detailsError.title"
          @update:model-value="saveDetailsSoon()"
        />
        <q-input
          v-model="details.description"
          outlined
          dense
          autogrow
          hide-bottom-space
          label="Description (optional)"
          :error="!!detailsError.description"
          :error-message="detailsError.description"
          @update:model-value="saveDetailsSoon()"
        />
        <div class="ustp-row">
          <q-input
            v-model="details.opensAt"
            outlined
            dense
            type="datetime-local"
            stack-label
            hide-bottom-space
            label="Voting opens"
            :error="!!detailsError.opensAt"
            :error-message="detailsError.opensAt"
            @update:model-value="saveDetailsSoon(0)"
          />
          <q-input
            v-model="details.closesAt"
            outlined
            dense
            type="datetime-local"
            stack-label
            hide-bottom-space
            label="Voting closes"
            :error="!!detailsError.closesAt"
            :error-message="detailsError.closesAt"
            @update:model-value="saveDetailsSoon(0)"
          />
        </div>
        <q-btn-toggle
          v-model="details.secrecy"
          no-caps
          toggle-color="primary"
          role="group"
          aria-label="Ballot secrecy"
          :options="[
            { label: 'Secret ballot', value: 'secret' },
            { label: 'Open roll-call', value: 'open' },
          ]"
          @update:model-value="saveDetailsSoon(0)"
        />
      </q-card-section>
      <q-expansion-item
        v-if="details.secrecy === 'secret'"
        dense
        label="More settings"
        :caption="`Anonymity threshold: ${details.kAnonymity} ballots per sealed block`"
      >
        <q-card-section>
          <q-input
            v-model.number="details.kAnonymity"
            outlined
            dense
            type="number"
            min="2"
            hide-bottom-space
            label="Anonymity threshold (minimum ballots per sealed block)"
            :error="!!detailsError.kAnonymity"
            :error-message="detailsError.kAnonymity"
            @update:model-value="saveDetailsSoon()"
          />
        </q-card-section>
      </q-expansion-item>
    </q-card>

    <div v-if="!questions.length" class="text-body2 text-grey-7">No questions yet. Add the first one below.</div>
    <QuestionCard
      v-for="(q, i) in questions"
      :key="q.id"
      ref="cards"
      :question="q"
      :number="i + 1"
      :total="questions.length"
      :errors="errorOf(q)"
      :texts="texts"
      :offices="officeOptions"
      :drag-handle="drag.handle(i)"
      :check-notes="checkNotes"
      :class="{ 'ustp-question--held': drag.state.from === i }"
      :style="drag.itemStyle(i)"
      @focusin="activeId = q.id"
      @edited="(d) => saveSoon(q, d)"
      @type="(t) => setType(q, t)"
      @move="(by) => move(i, i + by)"
      @duplicate="duplicate(i)"
      @delete="remove(i)"
      @commit-text="commitText(q)"
      @typing-text="typingText(q)"
      @option-removed="(o, at) => optionRemoved(q, o, at)"
    />

    <div class="ustp-addbar" role="group" aria-labelledby="add-question-label">
      <span id="add-question-label" class="text-body2 text-weight-medium">Add a question:</span>
      <q-btn
        v-for="(t, n) in QUESTION_TYPES"
        :key="t"
        outline
        no-caps
        color="primary"
        :icon="ICONS[t]"
        :label="QUESTION_TYPE_LABELS[t]"
        v-bind="n === 0 ? { 'data-add-question': '' } : {}"
        @click="add(t)"
      />
    </div>

    <div class="ustp-savebar" role="region" aria-label="Saving">
      <div class="ustp-savebar__status" :data-state="unsaved || status.state === 'error' ? 'error' : status.state">
        <q-icon
          :name="status.state === 'error' || unsaved ? 'error_outline' : status.state === 'saving' ? 'sync' : 'cloud_done'"
          size="20px"
          aria-hidden="true"
        />
        <span>{{ statusText }}</span>
      </div>
      <div class="ustp-actions">
        <q-btn v-if="status.state === 'error'" flat dense no-caps color="primary" label="Try again" @click="queue.retry()" />
        <q-btn v-if="status.state === 'error'" flat dense no-caps color="primary" label="Reload the ballot" @click="emit('reload')" />
        <q-btn v-if="lastUndo" flat dense no-caps color="primary" icon="undo" :aria-label="`Undo ${lastUndo.text}`" @click="undo">
          Undo<span class="gt-xs">&nbsp;{{ lastUndo.text }}</span>
        </q-btn>
        <q-btn-dropdown flat dense no-caps color="primary" icon="add" label="Add question" :auto-close="true">
          <q-list>
            <q-item v-for="t in QUESTION_TYPES" :key="t" clickable @click="addAfterActive(t)">
              <q-item-section avatar><q-icon :name="ICONS[t]" /></q-item-section>
              <q-item-section>{{ QUESTION_TYPE_LABELS[t] }}</q-item-section>
            </q-item>
          </q-list>
        </q-btn-dropdown>
      </div>
    </div>
  </div>
</template>

<style>
/* The ballot builder (design §6.5). Shared by its question cards and option lists. */
.ustp-builder__title .q-field__native {
  font-size: 1.25rem;
  font-weight: 600;
}
.ustp-question {
  position: relative;
}
.ustp-question__handle {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  cursor: grab;
  touch-action: none;
  color: rgba(128, 128, 128, 0.9);
}
.ustp-question--held,
.ustp-option--held {
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
  cursor: grabbing;
}
.ustp-question__type {
  flex: 0 1 220px;
  min-width: 180px;
}
.ustp-question__title .q-field__native {
  font-size: 1.0625rem;
  font-weight: 500;
}
.ustp-question__notes {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.ustp-question__tools {
  padding: 4px 8px;
}
.ustp-options-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.ustp-option {
  padding: 4px 0;
  background: inherit;
}
.ustp-option__row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ustp-option__name {
  flex: 1 1 auto;
  min-width: 0;
}
.ustp-option__marker {
  display: inline-flex;
  justify-content: center;
  min-width: 24px;
  color: rgba(128, 128, 128, 0.95);
}
.ustp-option__detail {
  margin: 4px 0 0 52px;
}
.ustp-option__suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.ustp-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 40px;
  cursor: grab;
  touch-action: none;
  color: rgba(128, 128, 128, 0.9);
}
.ustp-addbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
/* Always in view at the bottom of the window while the builder is; the page leaves room so focus is never hidden under it. */
.ustp-savebar {
  position: sticky;
  bottom: 0;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 12px;
  padding: 6px 12px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.12);
}
.body--dark .ustp-savebar {
  border-color: rgba(255, 255, 255, 0.28);
  background: var(--q-dark);
}
.ustp-savebar__status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
}
html:has(.ustp-savebar) {
  scroll-padding-bottom: 96px;
}
/* On a phone the option's name gets the room; the marker is only a picture of the ballot's control. */
@media (max-width: 599.98px) {
  .ustp-option__marker {
    display: none;
  }
  .ustp-option__detail {
    margin-left: 28px;
  }
}
</style>
