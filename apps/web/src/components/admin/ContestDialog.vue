<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  contestInputSchema,
  proposalInputSchema,
  type ContestRecord,
  type ProposalSnapshotRecord,
} from 'ustp-domain';
import type { ProposalContest } from 'ustp-tally';
import { api } from '../../api.js';
import { focusFirstInvalid } from '../../a11y.js';
import { attempt } from '../../dialogs.js';
import { KIND_LABELS, PASS_RULE_PRESETS } from '../../election-text.js';
import { apiFieldErrors, validate, type FieldErrors } from '../../forms.js';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{ electionId: string; contest: ContestRecord | null; proposals: readonly ProposalSnapshotRecord[] }>();
const emit = defineEmits<{ saved: []; proposalCreated: [ProposalSnapshotRecord] }>();

type Kind = ContestRecord['spec']['kind'];
const kinds = (Object.keys(KIND_LABELS) as Kind[]).map((k) => ({ label: KIND_LABELS[k], value: k }));

const form = reactive({
  kind: 'proposal' as Kind,
  title: '',
  description: '',
  proposalSnapshotId: null as string | null,
  passPreset: 0 as number | null,
  quorumPct: null as number | null,
  seats: 1,
  maxSelections: 1,
  floorPct: null as number | null,
  maxRanks: null as number | null,
});
/** A pass rule that matches no preset (kept as is unless a preset is chosen). */
const customPassRule = ref<ProposalContest['passRule'] | null>(null);
const writingText = ref(false);
const newText = reactive({ title: '', body: '' });
const errors = ref<FieldErrors>({});
const proposalOptions = computed(() => props.proposals.map((p) => ({ label: p.title, value: p.snapshotId })));
const presetOptions = computed(() => [
  ...PASS_RULE_PRESETS.map((p, i) => ({ label: p.label, value: i as number | null })),
  ...(customPassRule.value ? [{ label: 'Custom rule (unchanged)', value: null }] : []),
]);

watch(open, (isOpen) => {
  if (!isOpen) return;
  errors.value = {};
  writingText.value = false;
  customPassRule.value = null;
  const c = props.contest;
  Object.assign(form, {
    kind: c?.spec.kind ?? 'proposal',
    title: c?.title ?? '',
    description: c?.description ?? '',
    proposalSnapshotId: c?.proposalSnapshotId ?? null,
    passPreset: 0,
    quorumPct: null,
    seats: 1,
    maxSelections: 1,
    floorPct: null,
    maxRanks: null,
  });
  if (c?.spec.kind === 'proposal') {
    const index = PASS_RULE_PRESETS.findIndex((p) => JSON.stringify(p.value) === JSON.stringify(c.spec.kind === 'proposal' && c.spec.passRule));
    form.passPreset = index >= 0 ? index : null;
    if (index < 0) customPassRule.value = c.spec.passRule;
    const q = c.spec.quorum?.rollRatio;
    form.quorumPct = q ? Math.round((q.num / q.den) * 100) : null;
  } else if (c?.spec.kind === 'choose_n') {
    form.seats = c.spec.seats;
    form.maxSelections = c.spec.maxSelections;
    const f = c.spec.supportFloor?.ratio;
    form.floorPct = f ? Math.round((f.num / f.den) * 100) : null;
  } else if (c?.spec.kind === 'irv') {
    form.maxRanks = c.spec.maxRanks ?? null;
  }
});

function body() {
  const base = { title: form.title, description: form.description };
  const pct = (v: number | null) => (v ? { num: Math.round(v), den: 100 } : undefined);
  switch (form.kind) {
    case 'proposal': {
      const passRule = form.passPreset === null ? customPassRule.value : PASS_RULE_PRESETS[form.passPreset]!.value;
      const rollRatio = pct(form.quorumPct);
      return { kind: 'proposal', ...base, proposalSnapshotId: form.proposalSnapshotId ?? '', passRule, ...(rollRatio && { quorum: { rollRatio } }) };
    }
    case 'choose_n': {
      const floor = pct(form.floorPct);
      return {
        kind: 'choose_n',
        ...base,
        seats: Number(form.seats),
        maxSelections: Number(form.maxSelections),
        ...(floor && { supportFloor: { ratio: floor, comparison: 'gte' } }),
      };
    }
    case 'irv':
      return { kind: 'irv', ...base, ...(form.maxRanks ? { maxRanks: Number(form.maxRanks) } : {}) };
  }
}

async function createText() {
  const checked = validate(proposalInputSchema, newText);
  if (!checked.ok) {
    errors.value = { newTitle: checked.errors.title ?? '', newBody: checked.errors.body ?? '' };
    return;
  }
  await attempt(async () => {
    const created = await api<ProposalSnapshotRecord>('POST', '/v1/admin/proposals', checked.data);
    emit('proposalCreated', created);
    form.proposalSnapshotId = created.snapshotId;
    if (!form.title) form.title = created.title;
    writingText.value = false;
  }, 'Proposal text saved; it can no longer be changed');
}

async function save() {
  const checked = validate(contestInputSchema, body());
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  const url = `/v1/admin/elections/${props.electionId}/contests`;
  const ok = await attempt(async () => {
    try {
      await (props.contest ? api('PUT', `${url}/${props.contest.contestId}`, checked.data) : api('POST', url, checked.data));
    } catch (e) {
      errors.value = apiFieldErrors(e);
      throw e;
    }
  }, props.contest ? 'Contest updated' : 'Contest added');
  if (ok) {
    open.value = false;
    emit('saved');
  }
}
</script>

<template>
  <q-dialog v-model="open" persistent aria-labelledby="contest-dialog-title">
    <q-card style="width: 560px; max-width: 95vw">
      <q-card-section>
        <h2 id="contest-dialog-title" class="text-h6">{{ contest ? 'Edit contest' : 'Add a contest' }}</h2>
      </q-card-section>
      <q-card-section class="q-gutter-md">
        <q-select v-model="form.kind" outlined dense emit-value map-options :options="kinds" label="Kind" />
        <q-input v-model="form.title" outlined dense label="Title" :error="!!errors.title" :error-message="errors.title" />
        <q-input v-model="form.description" outlined dense autogrow label="Description (optional)" />

        <template v-if="form.kind === 'proposal'">
          <div v-if="!writingText" class="row items-start q-gutter-sm">
            <q-select
              v-model="form.proposalSnapshotId"
              class="col"
              outlined
              dense
              emit-value
              map-options
              :options="proposalOptions"
              label="Proposal text"
              :error="!!errors.proposalSnapshotId"
              :error-message="errors.proposalSnapshotId"
            />
            <q-btn flat no-caps color="primary" label="Write new text" @click="writingText = true" />
          </div>
          <q-card v-else flat bordered class="q-pa-sm q-gutter-sm">
            <div class="text-caption">Saved texts are permanent; the exact text is what members vote on.</div>
            <q-input v-model="newText.title" outlined dense label="Proposal title" :error="!!errors.newTitle" :error-message="errors.newTitle" />
            <q-input
              v-model="newText.body"
              outlined
              type="textarea"
              rows="6"
              label="Full text"
              :error="!!errors.newBody"
              :error-message="errors.newBody"
            />
            <div class="row q-gutter-sm">
              <q-btn color="primary" no-caps label="Save text" @click="createText" />
              <q-btn flat no-caps label="Cancel" @click="writingText = false" />
            </div>
          </q-card>
          <q-select v-model="form.passPreset" outlined dense emit-value map-options :options="presetOptions" label="To pass" />
          <q-input
            v-model.number="form.quorumPct"
            outlined
            dense
            type="number"
            min="1"
            max="100"
            label="Quorum: % of the roll that must vote on it (optional)"
          />
        </template>

        <template v-else-if="form.kind === 'choose_n'">
          <div class="row q-gutter-md">
            <q-input v-model.number="form.seats" class="col" outlined dense type="number" min="1" label="Seats to fill" />
            <q-input
              v-model.number="form.maxSelections"
              class="col"
              outlined
              dense
              type="number"
              min="1"
              label="Each voter may choose up to"
            />
          </div>
          <div class="text-caption text-grey-7">
            Plurality: 1 and 1. Block voting: seats and choices equal. Approval: choices = number of candidates.
          </div>
          <q-input
            v-model.number="form.floorPct"
            outlined
            dense
            type="number"
            min="1"
            max="100"
            label="Support floor: % of ballots a winner needs (optional)"
          />
        </template>

        <template v-else>
          <q-input v-model.number="form.maxRanks" outlined dense type="number" min="1" label="Most candidates a voter may rank (optional)" />
        </template>
        <q-banner v-if="errors._" class="bg-negative text-white" rounded>{{ errors._ }}</q-banner>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn v-close-popup flat label="Cancel" />
        <q-btn color="primary" :label="contest ? 'Save' : 'Add contest'" @click="save" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
