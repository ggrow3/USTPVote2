<script setup lang="ts">
import type { QSelect } from 'quasar';
import { computed, onBeforeUnmount, ref, useId } from 'vue';
import { candidateInputSchema, type CandidateInput, type MemberMatch } from 'ustp-domain';
import { announce } from '../a11y.js';
import { api } from '../api.js';
import { validate } from '../forms.js';
import { session } from '../session.js';
import {
  afterTyping,
  candidateBody,
  entryLabel,
  entryStatus,
  isMember,
  matchCaption,
  matchesAnnouncement,
  unavailableReason,
  type CandidateEntry,
} from './candidate-entry.js';

/**
 * Adds a candidate to a contest (design §6.5): a combobox that searches Active members by name as the Election Admin
 * types, so choosing one links their account, while any name typed and added without choosing stays a plain name.
 */
const props = defineProps<{
  contestTitle: string;
  /** Accounts already standing in this contest. */
  standing: readonly string[];
  /** Sends the candidate; resolves whether it was added. */
  add: (input: CandidateInput) => Promise<boolean>;
}>();

/** How long typing pauses before the search runs. */
const SEARCH_DELAY_MS = 300;

const select = ref<QSelect | null>(null);
const entry = ref<CandidateEntry>(null);
const matches = ref<MemberMatch[]>([]);
const error = ref('');
const busy = ref(false);
const statusId = useId();
const selfId = computed(() => session.me?.account?.accountId ?? null);
const status = computed(() => entryStatus(entry.value));

const optionValue = (o: CandidateEntry) => (isMember(o) ? o.accountId : entryLabel(o));
const unavailable = (o: CandidateEntry) => (isMember(o) ? unavailableReason(o, selfId.value, props.standing) : null);

let timer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(timer));

/** Quasar's filter: searches once typing pauses. A later search supersedes this one, so its answer is dropped. */
function search(text: string, update: (fn: () => void) => void, abort: () => void) {
  clearTimeout(timer);
  const name = text.trim();
  if (!name) {
    update(() => (matches.value = []));
    return;
  }
  timer = setTimeout(async () => {
    try {
      const found = await api<MemberMatch[]>('GET', `/v1/admin/member-search?${new URLSearchParams({ name })}`);
      update(() => (matches.value = found));
      announce(matchesAnnouncement(found.length, found.filter((m) => !unavailable(m)).length));
    } catch {
      abort();
      announce('The member search failed. Add candidate still adds the name as typed.');
    }
  }, SEARCH_DELAY_MS);
}

function typed(text: string) {
  entry.value = afterTyping(entry.value, text);
  error.value = '';
}

function chose(value: CandidateEntry) {
  entry.value = value;
  error.value = '';
  if (isMember(value)) announce(`${value.legalName} chosen. Add candidate links their member account.`);
}

/** Enter with no option highlighted adds what is in the field; Tab only moves on (Quasar sends both here). */
let lastKey = '';
function onNewValue() {
  if (lastKey === 'Enter') void submit();
}

async function submit() {
  if (busy.value) return;
  const current = entry.value;
  const checked = validate(candidateInputSchema, candidateBody(current));
  if (!checked.ok) {
    error.value = 'Enter a name, or choose a member.';
    return;
  }
  busy.value = true;
  const added = await props.add(checked.data);
  busy.value = false;
  if (!added) return;
  select.value?.hidePopup();
  entry.value = null;
  matches.value = [];
  announce(`Added ${checked.data.name} to ${props.contestTitle}${checked.data.accountId ? ', linked to their member account' : ''}.`);
}
</script>

<template>
  <div class="ustp-row">
    <div>
      <q-select
        ref="select"
        :model-value="entry"
        outlined
        dense
        hide-bottom-space
        use-input
        hide-selected
        fill-input
        input-debounce="0"
        label="Candidate name"
        :options="matches"
        :option-label="entryLabel"
        :option-value="optionValue"
        :option-disable="(o: CandidateEntry) => !!unavailable(o)"
        :aria-describedby="statusId"
        :error="!!error"
        :error-message="error"
        @filter="search"
        @input-value="typed"
        @update:model-value="chose"
        @keydown="(e: KeyboardEvent) => (lastKey = e.key)"
        @new-value="onNewValue"
      >
        <template #option="scope">
          <q-item v-bind="scope.itemProps">
            <q-item-section>
              <q-item-label>{{ scope.opt.legalName }}</q-item-label>
              <q-item-label caption>
                {{ [matchCaption(scope.opt), unavailable(scope.opt)].filter(Boolean).join(' · ') }}
              </q-item-label>
            </q-item-section>
          </q-item>
        </template>
        <template #no-option="scope">
          <q-item>
            <q-item-section class="text-grey-7">
              {{ scope.inputValue.trim() ? 'No Active member matches. Add candidate adds the name as typed.' : 'Type part of a member’s name.' }}
            </q-item-section>
          </q-item>
        </template>
      </q-select>
      <div :id="statusId" class="ustp-message text-grey-7">{{ status }}</div>
    </div>
    <q-btn outline no-caps color="primary" label="Add candidate" :loading="busy" @click="submit">
      <span class="sr-only">&nbsp;to {{ contestTitle }}</span>
    </q-btn>
  </div>
</template>
