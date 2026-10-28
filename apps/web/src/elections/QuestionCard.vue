<script setup lang="ts">
import { computed } from 'vue';
import type { ProposalSnapshotRecord, PublicElectionCheck } from 'ustp-domain';
import BylawsCheckNotes from '../election-check/BylawsCheckNotes.vue';
import { PASS_RULE_PRESETS } from '../election-text.js';
import { questionName, titleOf } from './builder-text.js';
import OptionList from './OptionList.vue';
import ProposalTextField from './ProposalTextField.vue';
import {
  QUESTION_TYPE_HINTS,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  questionNotes,
  questionRules,
  type OptionDraft,
  type QuestionDraft,
  type QuestionType,
} from './question-model.js';

/**
 * One question of the ballot builder (design §6.5), edited in place and laid out as voters will read it: the question,
 * its description and rules, then its options or its text. The rarer rules are folded under "More rules". The question
 * is the builder's own draft, edited here directly; every edit is reported so the builder can save it.
 */
const props = defineProps<{
  question: QuestionDraft;
  number: number;
  total: number;
  errors: Readonly<Record<string, string>>;
  texts: readonly ProposalSnapshotRecord[];
  offices: readonly { label: string; value: string | null }[];
  /** Listeners for the card's drag handle. */
  dragHandle: Record<string, (e: PointerEvent) => void>;
  /** The election setup check's notes (design §6.9), shown beside the question they are about. */
  checkNotes: Pick<PublicElectionCheck, 'findings' | 'quotedLines' | 'checker'> | null;
}>();
const emit = defineEmits<{
  edited: [delay: number];
  type: [type: QuestionType];
  move: [by: -1 | 1];
  duplicate: [];
  delete: [];
  commitText: [];
  typingText: [];
  optionRemoved: [option: OptionDraft, index: number];
}>();

/** How long typing pauses before a save. */
const TYPING_DELAY_MS = 800;

const q = props.question;
/** `contest-…`, as on the ballot, so "Go to" in the checks' notes finds the question. */
const headingId = `contest-${q.id}`;
const name = computed(() => questionName(props.number, q.title));
const rules = computed(() => questionRules(q));
const notes = computed(() => questionNotes(q));
const typeOptions = QUESTION_TYPES.map((t) => ({ label: QUESTION_TYPE_LABELS[t], value: t, caption: QUESTION_TYPE_HINTS[t] }));
const presetOptions = computed(() => [
  ...PASS_RULE_PRESETS.map((p, i) => ({ label: p.label, value: i as number | null })),
  ...(q.customPassRule ? [{ label: 'The rule this question had (kept as it is)', value: null }] : []),
]);
const limitOptions = [
  { label: 'As many as they like', value: true },
  { label: 'Up to a number', value: false },
];
const candidateQuestion = computed(() => q.type !== 'yes_no');

/** The folded rules in a line, so they show without opening. */
const moreSummary = computed(() => {
  const parts: string[] = [];
  if (q.type === 'yes_no') {
    parts.push(q.passPreset === null ? 'Its own pass rule' : PASS_RULE_PRESETS[q.passPreset]!.label);
    if (q.quorumPct) parts.push(`quorum ${q.quorumPct}% of the roll`);
    if (q.minBallots) parts.push(`quorum ${q.minBallots} ballots`);
  } else {
    const office = props.offices.find((o) => o.value && o.value === q.positionId);
    parts.push(office ? `Fills: ${office.label}` : 'Fills no office');
    if (q.type !== 'rank' && q.floorPct) parts.push(`a winner needs ${q.floorPct}% of the ballots`);
    if (q.type === 'rank' && q.maxRanks) parts.push(`rank up to ${q.maxRanks}`);
  }
  return parts.join(' · ');
});

const edited = (delay = TYPING_DELAY_MS) => emit('edited', delay);

/** Alt+↑ / Alt+↓ in the question's own fields move the question. */
function onKeydown(e: KeyboardEvent) {
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    emit('move', e.key === 'ArrowUp' ? -1 : 1);
  }
}
</script>

<template>
  <q-card :id="`question-${question.id}`" tag="section" :aria-labelledby="headingId" flat bordered class="ustp-question">
    <div class="ustp-question__handle" aria-hidden="true" title="Drag to move the question" v-on="dragHandle">
      <q-icon name="drag_handle" size="20px" />
    </div>
    <q-card-section class="ustp-header">
      <h3 :id="headingId" class="text-subtitle1" :data-question-heading="question.id">
        Question {{ number }}<span class="sr-only">: {{ titleOf(question.title) }}</span>
      </h3>
      <q-select
        :model-value="question.type"
        outlined
        dense
        emit-value
        map-options
        options-dense
        class="ustp-question__type"
        :options="typeOptions"
        label="Type"
        :data-type="question.id"
        @update:model-value="(t: QuestionType) => emit('type', t)"
      >
        <template #option="scope">
          <q-item v-bind="scope.itemProps">
            <q-item-section>
              <q-item-label>{{ scope.opt.label }}</q-item-label>
              <q-item-label caption>{{ scope.opt.caption }}</q-item-label>
            </q-item-section>
          </q-item>
        </template>
      </q-select>
    </q-card-section>

    <q-card-section class="ustp-form">
      <div v-if="errors._" class="ustp-question__failed text-negative text-body2">
        <q-icon name="error_outline" size="18px" aria-hidden="true" /> Not saved: {{ errors._ }}
      </div>
      <q-input
        v-model="question.title"
        outlined
        autogrow
        hide-bottom-space
        class="ustp-question__title"
        label="Question"
        :data-title="question.id"
        :error="!!errors.title"
        :error-message="errors.title"
        @update:model-value="edited()"
        @keydown="onKeydown"
      />
      <q-input
        v-model="question.description"
        outlined
        dense
        autogrow
        hide-bottom-space
        label="Description (optional)"
        :error="!!errors.description"
        :error-message="errors.description"
        @update:model-value="edited()"
        @keydown="onKeydown"
      />
      <div v-if="rules.length" class="text-caption text-grey-7">
        <span class="sr-only">Voters read: </span>{{ rules.join(' ') }}
      </div>
      <BylawsCheckNotes :check="checkNotes" :contest-id="question.id" :subject="question.title" />

      <ProposalTextField
        v-if="question.type === 'yes_no'"
        :question="question"
        :texts="texts"
        :number="number"
        :error="errors.proposalSnapshotId"
        @edited="(d) => emit('edited', d)"
        @commit="emit('commitText')"
        @typing="emit('typingText')"
      />
      <template v-else>
        <div v-if="question.type === 'choose_several'" class="ustp-row">
          <q-input
            v-model.number="question.seats"
            outlined
            dense
            type="number"
            min="1"
            hide-bottom-space
            label="How many win"
            :error="!!errors.seats"
            :error-message="errors.seats"
            @update:model-value="edited()"
          />
          <q-select
            v-model="question.anyNumber"
            outlined
            dense
            emit-value
            map-options
            :options="limitOptions"
            label="Each voter may tick"
            @update:model-value="edited(0)"
          />
          <q-input
            v-if="!question.anyNumber"
            v-model.number="question.maxSelections"
            outlined
            dense
            type="number"
            min="2"
            hide-bottom-space
            label="Most each voter may tick"
            :error="!!errors.maxSelections"
            :error-message="errors.maxSelections"
            @update:model-value="edited()"
          />
        </div>
        <OptionList
          :question="question"
          :number="number"
          :errors="errors"
          @edited="(d) => emit('edited', d)"
          @removed="(o, i) => emit('optionRemoved', o, i)"
        />
      </template>

      <div v-if="notes.length" class="ustp-question__notes text-body2">
        <q-icon name="info" size="18px" aria-hidden="true" />
        <div>
          <span class="text-weight-medium">To finish this question: </span>
          <span>{{ notes.join(' ') }}</span>
        </div>
      </div>
    </q-card-section>

    <q-expansion-item dense label="More rules" :caption="moreSummary" class="ustp-question__more">
      <q-card-section class="ustp-form">
        <template v-if="question.type === 'yes_no'">
          <q-select
            v-model="question.passPreset"
            outlined
            dense
            emit-value
            map-options
            :options="presetOptions"
            label="To pass"
            @update:model-value="edited(0)"
          />
          <div class="ustp-row">
            <q-input
              v-model.number="question.quorumPct"
              outlined
              dense
              type="number"
              min="1"
              max="100"
              hide-bottom-space
              label="Quorum: % of the roll who must vote on it"
              :error="!!errors.quorumPct"
              :error-message="errors.quorumPct"
              @update:model-value="edited()"
            />
            <q-input
              v-model.number="question.minBallots"
              outlined
              dense
              type="number"
              min="0"
              hide-bottom-space
              label="Quorum: ballots needed"
              :error="!!errors.minBallots"
              :error-message="errors.minBallots"
              @update:model-value="edited()"
            />
          </div>
          <div class="text-caption text-grey-7">Leave a quorum empty for none.</div>
        </template>
        <template v-if="candidateQuestion">
          <q-input
            v-if="question.type !== 'rank'"
            v-model.number="question.floorPct"
            outlined
            dense
            type="number"
            min="1"
            max="100"
            hide-bottom-space
            label="Support floor: % of ballots a winner needs (optional)"
            :error="!!errors.floorPct"
            :error-message="errors.floorPct"
            @update:model-value="edited()"
          />
          <q-input
            v-else
            v-model.number="question.maxRanks"
            outlined
            dense
            type="number"
            min="1"
            hide-bottom-space
            label="Most options a voter may rank (optional)"
            :error="!!errors.maxRanks"
            :error-message="errors.maxRanks"
            @update:model-value="edited()"
          />
          <q-select
            v-model="question.positionId"
            outlined
            dense
            emit-value
            map-options
            :options="offices"
            label="Office the winners take up (optional)"
            hint="When the results are certified, each winner starts a term in this office."
            hide-bottom-space
            :error="!!errors.positionId"
            :error-message="errors.positionId"
            @update:model-value="edited(0)"
          />
        </template>
      </q-card-section>
    </q-expansion-item>

    <q-separator />
    <q-card-actions class="ustp-question__tools">
      <q-btn flat round dense icon="arrow_upward" :disable="number === 1" :aria-label="`Move ${name} up`" :data-move-up="question.id" @click="emit('move', -1)">
        <q-tooltip>Move up</q-tooltip>
      </q-btn>
      <q-btn
        flat
        round
        dense
        icon="arrow_downward"
        :disable="number === total"
        :aria-label="`Move ${name} down`"
        :data-move-down="question.id"
        @click="emit('move', 1)"
      >
        <q-tooltip>Move down</q-tooltip>
      </q-btn>
      <q-space />
      <q-btn flat round dense icon="content_copy" :aria-label="`Duplicate ${name}`" :data-duplicate="question.id" @click="emit('duplicate')">
        <q-tooltip>Duplicate</q-tooltip>
      </q-btn>
      <q-btn flat round dense icon="delete_outline" :aria-label="`Delete ${name}`" @click="emit('delete')">
        <q-tooltip>Delete</q-tooltip>
      </q-btn>
    </q-card-actions>
  </q-card>
</template>
