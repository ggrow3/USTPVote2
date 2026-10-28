<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import type { MemberMatch } from 'ustp-domain';
import { announce, focusSoon } from '../a11y.js';
import { session } from '../session.js';
import { searchMembers } from './api.js';
import { announcements, optionName } from './builder-text.js';
import { matchCaption, matchesAnnouncement, unavailableReason } from './candidate-entry.js';
import { useDragReorder } from './drag-reorder.js';
import { blankOption, copyOption, linkOption, moveItem, renameOption, type OptionDraft, type QuestionDraft } from './question-model.js';

/**
 * A question's options, typed in place (design §6.5): Enter adds the next, Backspace in an empty one removes it, and
 * Alt+↑ / Alt+↓ move it, as do the drag handle and the buttons in its menu (WCAG 2.5.7). Typing part of a member's name
 * offers to link the option to their account. The question is the builder's own draft, edited here directly.
 */
const props = defineProps<{
  question: QuestionDraft;
  /** The question's place on the ballot, for names. */
  number: number;
  errors: Readonly<Record<string, string>>;
}>();
const emit = defineEmits<{
  /** The options changed: save after `delay` ms. */
  edited: [delay: number];
  /** An option was removed, so it can be put back. */
  removed: [option: OptionDraft, index: number];
}>();

/** How long typing pauses before the member search runs. */
const SEARCH_DELAY_MS = 300;

const q = props.question;
const kind = computed(() => q.type);
const rows = ref<HTMLElement[]>([]);
const selfId = computed(() => session.me?.account?.accountId ?? null);
const nameOf = (i: number) => optionName(i + 1, q.options[i]?.name ?? '');
const optionSelector = (id: string) => `[data-option="${CSS.escape(id)}"]`;

const drag = useDragReorder({
  items: () => rows.value,
  onMove: (from, to) => move(from, to),
});

function edited(delay = 0) {
  emit('edited', delay);
}

function rename(o: OptionDraft, name: string) {
  const before = o.linkedName;
  Object.assign(o, renameOption(o, name));
  if (before && !o.accountId) announce(announcements.unlinked(before));
  edited(800);
  suggestFor(o);
}

/** Adds an empty option after `index` and puts the cursor in it (or in the empty one already there). */
function addAfter(index: number) {
  const next = q.options[index + 1];
  if (next && !next.name.trim()) {
    void focusSoon(optionSelector(next.id));
    return;
  }
  const option = blankOption();
  q.options.splice(index + 1, 0, option);
  void focusSoon(optionSelector(option.id));
}

function remove(index: number, focusBefore = false) {
  const [option] = q.options.splice(index, 1);
  if (!option) return;
  if (option.name.trim()) emit('removed', option, index);
  announce(announcements.optionRemoved(option.name));
  const neighbour = q.options[focusBefore ? index - 1 : index] ?? q.options[index - 1];
  void focusSoon(neighbour ? optionSelector(neighbour.id) : `[data-add-option="${CSS.escape(q.id)}"]`);
  edited();
}

function move(from: number, to: number) {
  if (to < 0 || to >= q.options.length || to === from) return;
  q.options = moveItem(q.options, from, to);
  announce(announcements.optionMoved(q.options[to]!.name, to + 1, q.options.length));
  edited();
}

function duplicate(index: number) {
  const o = q.options[index]!;
  // The copy is a new person or choice to edit: same words, no member linked (one member appears once per question).
  const copy = { ...copyOption(o), accountId: null, linkedName: null };
  q.options.splice(index + 1, 0, copy);
  announce(announcements.optionCopied(index + 2));
  void focusSoon(optionSelector(copy.id));
  edited();
}

function openStatement(o: OptionDraft) {
  o.statementOpen = true;
  void focusSoon(`[data-statement="${CSS.escape(o.id)}"]`);
}

function removeStatement(o: OptionDraft) {
  o.statement = '';
  o.statementOpen = false;
  void focusSoon(optionSelector(o.id));
  edited();
}

function unlink(o: OptionDraft) {
  const name = o.linkedName ?? o.name;
  Object.assign(o, { accountId: null, linkedName: null });
  announce(announcements.unlinked(name));
  void focusSoon(optionSelector(o.id));
  edited();
}

function onKeydown(e: KeyboardEvent, index: number) {
  const o = q.options[index]!;
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    addAfter(index);
  } else if (e.key === 'Backspace' && !o.name && q.options.length > 1) {
    e.preventDefault();
    remove(index, true);
  } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    move(index, index + (e.key === 'ArrowUp' ? -1 : 1));
    void focusSoon(optionSelector(o.id));
  } else if (e.key === 'ArrowDown' && suggest.optionId === o.id && suggest.matches.length) {
    // Down to the members it matches, as in a search box; up from them comes back.
    const first = document.querySelector<HTMLElement>(`[data-suggestions="${CSS.escape(o.id)}"] button`);
    if (first) {
      e.preventDefault();
      first.focus();
    }
  }
}

function onSuggestionKeydown(e: KeyboardEvent, o: OptionDraft) {
  const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button')];
  const at = buttons.indexOf(document.activeElement as HTMLElement);
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (at > 0) buttons[at - 1]!.focus();
    else void focusSoon(optionSelector(o.id));
  } else if (e.key === 'ArrowDown' && at >= 0 && at < buttons.length - 1) {
    e.preventDefault();
    buttons[at + 1]!.focus();
  }
}

// --- linking a member (design §6.5) ---------------------------------------------------------------------------

const suggest = reactive({ optionId: '', matches: [] as MemberMatch[] });
let timer: ReturnType<typeof setTimeout> | undefined;
let asked = 0;
onBeforeUnmount(() => clearTimeout(timer));

const standing = computed(() => q.options.flatMap((o) => (o.accountId ? [o.accountId] : [])));
const unavailable = (m: MemberMatch) => unavailableReason(m, selfId.value, standing.value);

/** Searches members once typing pauses; a later search supersedes this one. */
function suggestFor(o: OptionDraft) {
  clearTimeout(timer);
  const name = o.name.trim();
  if (o.accountId || name.length < 2) {
    suggest.matches = [];
    return;
  }
  const ask = ++asked;
  timer = setTimeout(async () => {
    try {
      const found = (await searchMembers(name)).slice(0, 3);
      if (ask !== asked) return;
      Object.assign(suggest, { optionId: o.id, matches: found });
      const message = matchesAnnouncement(found.filter((m) => !unavailable(m)).length);
      if (message) announce(message);
    } catch {
      // The search is a convenience: the name is saved as typed whatever happens to it.
    }
  }, SEARCH_DELAY_MS);
}

function link(o: OptionDraft, m: MemberMatch) {
  Object.assign(o, linkOption(o, m));
  suggest.matches = [];
  announce(announcements.linked(m.legalName));
  void focusSoon(optionSelector(o.id));
  edited();
}

/** Suggestions stay while focus is in their row (on its buttons, say), and go when it leaves. */
function leaveRow(e: FocusEvent, o: OptionDraft) {
  const row = e.currentTarget as HTMLElement;
  if (!row.contains(e.relatedTarget as Node | null) && suggest.optionId === o.id) suggest.matches = [];
}
</script>

<template>
  <div>
    <ol class="ustp-options-list" :aria-label="`Options for question ${number}`">
      <li
        v-for="(o, i) in question.options"
        :key="o.id"
        ref="rows"
        class="ustp-option"
        :class="{ 'ustp-option--held': drag.state.from === i }"
        :style="drag.itemStyle(i)"
        @focusout="leaveRow($event, o)"
      >
        <div class="ustp-option__row">
          <span class="ustp-drag-handle" aria-hidden="true" title="Drag to reorder" v-on="drag.handle(i)">
            <q-icon name="drag_indicator" size="20px" />
          </span>
          <span class="ustp-option__marker" aria-hidden="true">
            <template v-if="kind === 'rank'">{{ i + 1 }}.</template>
            <q-icon v-else :name="kind === 'choose_several' ? 'check_box_outline_blank' : 'radio_button_unchecked'" size="20px" />
          </span>
          <q-input
            :model-value="o.name"
            outlined
            dense
            hide-bottom-space
            class="ustp-option__name"
            :label="`Option ${i + 1}`"
            :data-option="o.id"
            :error="!!errors[`option:${o.id}`]"
            :error-message="errors[`option:${o.id}`]"
            @update:model-value="(v) => rename(o, String(v ?? ''))"
            @focus="suggestFor(o)"
            @keydown="(e: KeyboardEvent) => onKeydown(e, i)"
          />
          <q-btn flat round dense icon="close" :aria-label="`Remove ${nameOf(i)}`" @click="remove(i)">
            <q-tooltip>Remove</q-tooltip>
          </q-btn>
          <q-btn flat round dense icon="more_vert" :aria-label="`More for ${nameOf(i)}`">
            <q-menu auto-close>
              <q-list dense style="min-width: 220px">
                <q-item clickable :disable="i === 0" @click="move(i, i - 1)">
                  <q-item-section avatar><q-icon name="arrow_upward" /></q-item-section>
                  <q-item-section>Move up</q-item-section>
                </q-item>
                <q-item clickable :disable="i === question.options.length - 1" @click="move(i, i + 1)">
                  <q-item-section avatar><q-icon name="arrow_downward" /></q-item-section>
                  <q-item-section>Move down</q-item-section>
                </q-item>
                <q-item clickable @click="duplicate(i)">
                  <q-item-section avatar><q-icon name="content_copy" /></q-item-section>
                  <q-item-section>Duplicate</q-item-section>
                </q-item>
                <q-item v-if="!o.statementOpen" clickable @click="openStatement(o)">
                  <q-item-section avatar><q-icon name="notes" /></q-item-section>
                  <q-item-section>Add a statement</q-item-section>
                </q-item>
                <q-item v-else clickable @click="removeStatement(o)">
                  <q-item-section avatar><q-icon name="notes" /></q-item-section>
                  <q-item-section>Remove the statement</q-item-section>
                </q-item>
                <q-item v-if="o.accountId" clickable @click="unlink(o)">
                  <q-item-section avatar><q-icon name="link_off" /></q-item-section>
                  <q-item-section>Unlink the member account</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </div>
        <div v-if="o.accountId" class="ustp-option__detail text-caption text-grey-7">
          <q-icon name="link" size="16px" aria-hidden="true" /> Linked to the member account of {{ o.linkedName }}
        </div>
        <div
          v-if="suggest.optionId === o.id && suggest.matches.length && !o.accountId"
          class="ustp-option__detail ustp-option__suggestions"
          role="group"
          :aria-label="`Members matching ${nameOf(i)}`"
          :data-suggestions="o.id"
          @keydown="(e: KeyboardEvent) => onSuggestionKeydown(e, o)"
        >
          <template v-for="m in suggest.matches" :key="m.accountId">
            <q-btn
              v-if="!unavailable(m)"
              outline
              dense
              no-caps
              color="primary"
              icon="link"
              :label="`Link ${m.legalName}`"
              :aria-label="`Link ${m.legalName}${matchCaption(m) ? ` (${matchCaption(m)})` : ''} to ${nameOf(i)}`"
              @click="link(o, m)"
            >
              <span v-if="matchCaption(m)" class="text-caption q-ml-xs" aria-hidden="true">({{ matchCaption(m) }})</span>
            </q-btn>
            <span v-else class="text-caption text-grey-7">{{ m.legalName }}: {{ unavailable(m) }}</span>
          </template>
        </div>
        <q-input
          v-if="o.statementOpen"
          v-model="o.statement"
          outlined
          dense
          autogrow
          hide-bottom-space
          class="ustp-option__detail"
          :label="`Statement for ${o.name.trim() || `option ${i + 1}`} (optional)`"
          :data-statement="o.id"
          :error="!!errors[`statement:${o.id}`]"
          :error-message="errors[`statement:${o.id}`]"
          @update:model-value="edited(800)"
        />
      </li>
    </ol>
    <q-btn flat dense no-caps color="primary" icon="add" label="Add option" :data-add-option="question.id" @click="addAfter(question.options.length - 1)">
      <span class="sr-only">&nbsp;to question {{ number }}</span>
    </q-btn>
  </div>
</template>
