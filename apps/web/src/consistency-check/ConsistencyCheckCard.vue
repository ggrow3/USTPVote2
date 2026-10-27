<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { CONSISTENCY_DOCUMENTS, type ConsistencyCheckView, type ConsistencyDocument } from 'ustp-domain';
import { focusElement, focusSoon } from '../a11y.js';
import { referenceNote, SEVERITY_ICONS, SEVERITY_LABELS } from '../bylaws-check-text.js';
import { dialog } from '../dialogs.js';
import {
  changedSince,
  comparedParts,
  confirmText,
  documentLabel,
  findingContests,
  introText,
  sourceText,
  statusText,
  usedText,
} from './consistency-check-text.js';
import { useConsistencyCheck } from './use-consistency-check.js';

/**
 * The platform consistency check (design §5.5) on the ballot page or in the election editor: what it does, the person's
 * one run, its progress and its findings, which link to the questions they concern, and in the editor the documents it
 * compares with. Shown while the server offers the check, and afterwards to anyone who ran it.
 */
const props = defineProps<{
  electionId: string;
  view: ConsistencyCheckView;
  /** Whether the election has proposals or options to check (`consistencyMaterial` is not empty). */
  available: boolean;
  /** The definition the editor shows now, to say when a draft has changed since the check. */
  definitionHash?: string | null;
  /** An Election Admin on a draft may choose the documents the election's checks compare with. */
  chooseDocuments?: boolean;
}>();

const { state, load, start, choose } = useConsistencyCheck(props.electionId, props.view);
onMounted(load);

const check = computed(() => state.check);
const busy = computed(() => state.requesting || check.value?.status === 'queued' || check.value?.status === 'running');
/** No check yet, or one that failed, which does not count. */
const canRun = computed(() => !!state.enabled && props.available && !busy.value && (!check.value || check.value.status === 'failed'));
const shown = computed(() => state.enabled === true || !!check.value);
const checkedAt = computed(() => (check.value?.finishedAt ? new Date(check.value.finishedAt).toLocaleString() : ''));
/** The check was compared with other documents than the election's checks use now. */
const otherDocuments = computed(() => !!check.value && check.value.documents.join() !== state.documents.join());

function toggle(document: ConsistencyDocument, on: boolean) {
  void choose(CONSISTENCY_DOCUMENTS.filter((d) => (d === document ? on : state.documents.includes(d))));
}

function run() {
  dialog({
    title: 'Check consistency with Claude?',
    message: confirmText(props.view),
    cancel: true,
    focus: 'cancel',
    ok: { label: 'Run the check', noCaps: true },
  }).onOk(async () => {
    await start();
    // The button has gone; focus goes to where the check's progress and result appear.
    if (state.check) await focusSoon('#consistency-status');
  });
}

function goTo(contestId: string) {
  focusElement(document.getElementById(`contest-${contestId}`));
}
</script>

<template>
  <q-card v-if="shown" flat bordered tag="section" aria-labelledby="consistency-heading">
    <q-card-section>
      <h2 id="consistency-heading" class="text-subtitle1">Consistency with the platform</h2>
      <div class="text-caption text-grey-7">{{ introText(view, state.documents) }}</div>
    </q-card-section>

    <!-- Others read what is chosen in the intro above. -->
    <q-card-section v-if="view === 'admin' && chooseDocuments" class="q-pt-none">
      <fieldset class="ustp-fieldset">
        <legend class="text-weight-medium">Compare the questions with</legend>
        <div class="ustp-options">
          <q-checkbox
            v-for="d in CONSISTENCY_DOCUMENTS"
            :key="d"
            :model-value="state.documents.includes(d)"
            :label="documentLabel(d)"
            :disable="state.choosing"
            @update:model-value="(on: boolean) => toggle(d, on)"
          />
        </div>
        <div class="text-caption text-grey-7">
          The questions are always compared with each other too. These are chosen while the election is a draft; every
          check of it, a voter's or an officer's, then compares with the same documents.
        </div>
      </fieldset>
    </q-card-section>

    <q-card-section class="q-pt-none">
      <div v-if="!check && !available" class="text-grey-7">There is nothing to check: every contest elects someone to an office.</div>
      <div v-if="canRun" class="ustp-actions">
        <q-btn color="primary" no-caps icon="fact_check" label="Check consistency with Claude" @click="run" />
        <span class="text-caption text-grey-7">
          {{ check?.status === 'failed' ? 'A failed check does not count: you can run it again.' : 'Each person can run it once per election.' }}
        </span>
      </div>
      <!-- The button's place, once the person has had their one run. -->
      <div v-else-if="check?.status === 'done'" class="consistency-used">
        <q-icon name="task_alt" size="20px" aria-hidden="true" class="q-mr-xs" />{{ usedText(check) }}
      </div>

      <div id="consistency-status" class="q-mt-sm">
        <template v-if="busy">
          <q-spinner size="1.2em" aria-hidden="true" class="q-mr-xs" />{{ statusText(check, state.requesting) }}
        </template>
        <strong v-else-if="check?.status === 'done'">{{ statusText(check) }}</strong>
      </div>
      <div v-if="state.gaveUp" class="text-deep-orange-10 q-mt-sm">
        The check is taking longer than it should. It may still finish; if not, it is marked failed and you can run it again.
      </div>

      <q-banner v-if="state.error" class="bg-negative text-white q-mt-sm" rounded>{{ state.error }}</q-banner>
      <q-banner v-else-if="check?.status === 'failed'" class="bg-negative text-white q-mt-sm" rounded>
        The check failed: {{ check.error }}
      </q-banner>

      <template v-if="check?.status === 'done'">
        <p class="q-mt-xs q-mb-sm">{{ check.summary }}</p>
        <div v-if="view === 'admin' && changedSince(check, definitionHash ?? null)" class="text-caption text-deep-orange-10 q-mb-sm">
          The election has changed since this check, which read it as it was then.
        </div>
        <div v-if="view === 'admin' && otherDocuments" class="text-caption text-deep-orange-10 q-mb-sm">
          This check compared with other documents than the ones chosen for the election now.
        </div>
        <ol v-if="check.findings.length" class="consistency-findings q-pl-none q-my-sm">
          <li v-for="(f, i) in check.findings" :key="i" class="consistency-finding">
            <div class="ustp-toolbar">
              <span class="text-weight-medium">Finding {{ i + 1 }}</span>
              <span class="text-deep-orange-10 text-weight-medium">
                <q-icon :name="SEVERITY_ICONS[f.severity]" size="18px" aria-hidden="true" /> {{ SEVERITY_LABELS[f.severity] }}
              </span>
              <span>{{ sourceText(f) }}</span>
            </div>
            <blockquote v-if="f.passage" class="consistency-passage">{{ f.passage }}</blockquote>
            <div class="q-my-xs">{{ f.explanation }}</div>
            <div class="ustp-toolbar">
              <span class="text-caption text-grey-7">{{ f.contests.length === 1 ? 'Question' : 'Questions' }}:</span>
              <q-btn
                v-for="c in findingContests(check, f)"
                :key="c.contestId"
                flat
                dense
                no-caps
                color="primary"
                class="consistency-link"
                :label="c.title"
                :aria-label="`Go to ${c.title}`"
                @click="goTo(c.contestId)"
              />
            </div>
          </li>
        </ol>
        <div class="text-caption text-grey-7">
          <template v-if="check.checker === 'stub'">Checked by the local stand-in, which only exists with the emulators and is not an AI review.</template>
          <template v-else>Checked by {{ check.model }} on {{ checkedAt }}.</template>
          Compared with:
          <span v-for="(part, i) in comparedParts(check)" :key="i">
            <template v-if="part.reference">
              <a :href="part.reference.url" target="_blank" rel="noopener">{{ part.text }}</a> ({{ referenceNote(part.reference) }})</template
            ><template v-else>{{ part.text }}</template>;
          </span>
          and the other questions {{ view === 'admin' ? 'in this election' : 'on this ballot' }}.
        </div>
      </template>
    </q-card-section>
  </q-card>
</template>

<style scoped>
.consistency-used {
  display: flex;
  align-items: flex-start;
}
.consistency-findings {
  list-style: none;
}
.consistency-finding {
  padding: 8px 0;
  border-top: 1px solid rgba(128, 128, 128, 0.35);
}
.consistency-passage {
  margin: 6px 0;
  padding-left: 10px;
  border-left: 3px solid rgba(128, 128, 128, 0.6);
  overflow-wrap: anywhere;
}
/* Long titles wrap; they read as a list, from the left. */
.consistency-link :deep(.q-btn__content) {
  justify-content: flex-start;
  text-align: left;
}
</style>
