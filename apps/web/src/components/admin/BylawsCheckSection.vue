<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BylawsCheckScope, BylawsCheckView } from 'ustp-domain';
import {
  linesLabel,
  referenceNote,
  SEVERITY_ICONS,
  SEVERITY_LABELS,
  SOURCE_LABELS,
  stillReads,
} from '../../bylaws-check-text.js';

/**
 * The advisory bylaws check of a draft (design §5.2): what it does, the button, its progress and its findings. The
 * draft's own lines are highlighted by BylawsPanel; this lists the findings and links each to its lines.
 */
const props = defineProps<{
  check: BylawsCheckView | null;
  checkedLines: readonly string[];
  requesting: boolean;
  error: string;
  gaveUp: boolean;
  draftLines: readonly string[];
  /** The version the draft amends, when it has changes against it (so "changed lines" can be checked). */
  changesSince: string | null;
}>();
const emit = defineEmits<{ check: [scope: BylawsCheckScope]; goToLine: [line: number] }>();

/** Changed lines when there are any, until the admin picks. */
const scope = ref<BylawsCheckScope>(props.changesSince ? 'changes' : 'draft');
const picked = ref(false);
watch(
  () => props.changesSince,
  (since) => {
    if (!since) scope.value = 'draft';
    else if (!picked.value) scope.value = 'changes';
  },
);
const busy = computed(() => props.requesting || props.check?.status === 'queued' || props.check?.status === 'running');
const edited = computed(
  () => !!props.check && (props.draftLines.length !== props.checkedLines.length || props.draftLines.some((l, i) => l !== props.checkedLines[i])),
);
const progress = computed(() => {
  if (props.requesting) return 'Sending the draft…';
  if (props.check?.status === 'queued') return 'Waiting for the server to start the check…';
  if (props.check?.status === 'running') return 'Checking… this usually takes a minute or two.';
  return '';
});
const checkedAt = computed(() => (props.check?.finishedAt ? new Date(props.check.finishedAt).toLocaleString() : ''));
</script>

<template>
  <div>
    <h3 class="text-subtitle2">Check for conflicts</h3>
    <p class="text-caption text-grey-7 q-mb-sm">
      Claude, an AI model made by Anthropic, compares the draft with the US Constitution, Transhumanist principles
      (Article I of the USTP Constitution and the Transhumanist Bill of Rights, version 3.0) and the USTP Constitution,
      and flags lines that may contradict them. The draft is sent to Anthropic for this. The check is advisory: it can
      miss conflicts or flag ones that are not there, and it never stops you publishing.
    </p>

    <div class="row items-center q-gutter-sm">
      <q-option-group
        v-if="changesSince"
        v-model="scope"
        inline
        dense
        type="radio"
        :disable="busy"
        aria-label="What to check"
        @update:model-value="picked = true"
        :options="[
          { label: `Lines changed since version ${changesSince}`, value: 'changes' },
          { label: 'The whole draft', value: 'draft' },
        ]"
      />
      <q-btn color="primary" no-caps icon="fact_check" label="Check for conflicts" :loading="busy" :disable="busy" @click="emit('check', scope)" />
    </div>
    <div v-if="progress" class="text-grey-7 q-mt-sm">{{ progress }}</div>
    <div v-if="gaveUp" class="text-deep-orange-10 q-mt-sm">
      The check is taking longer than it should. It may still finish; otherwise try again in a few minutes.
    </div>

    <q-banner v-if="error" class="bg-negative text-white q-mt-sm" rounded>{{ error }}</q-banner>
    <q-banner v-else-if="check?.status === 'failed'" class="bg-negative text-white q-mt-sm" rounded>
      The check failed: {{ check.error }}
    </q-banner>

    <template v-if="check?.status === 'done'">
      <p class="q-mt-md q-mb-xs">
        <strong>{{ check.findings.length ? `${check.findings.length} ${check.findings.length === 1 ? 'finding' : 'findings'}.` : 'No conflicts found.' }}</strong>
        {{ check.summary }}
      </p>
      <div v-if="edited" class="text-caption text-grey-7 q-mb-xs">
        The draft has changed since this check. Lines that no longer read as they did are not highlighted.
      </div>
      <ol v-if="check.findings.length" class="bylaws-findings q-pl-none q-my-sm">
        <li v-for="(f, i) in check.findings" :id="`bylaws-finding-${i + 1}`" :key="i" class="bylaws-finding">
          <div class="row items-center q-gutter-x-sm">
            <span class="text-weight-medium">Finding {{ i + 1 }}</span>
            <span class="text-deep-orange-10 text-weight-medium">
              <q-icon :name="SEVERITY_ICONS[f.severity]" size="18px" aria-hidden="true" /> {{ SEVERITY_LABELS[f.severity] }}
            </span>
            <span>with the {{ SOURCE_LABELS[f.source] }}, {{ f.provision }}</span>
          </div>
          <div class="q-my-xs">{{ f.explanation }}</div>
          <div class="row items-center q-gutter-xs">
            <span class="text-caption text-grey-7">{{ linesLabel(f.lines).replace(/^l/, 'L') }}:</span>
            <q-btn
              v-for="n in f.lines"
              :key="n"
              flat
              dense
              no-caps
              color="primary"
              :label="`${n}`"
              :aria-label="`Go to line ${n}`"
              @click="emit('goToLine', n)"
            />
            <span v-if="f.lines.some((n) => !stillReads(n, checkedLines, draftLines))" class="text-caption text-grey-7">
              (edited since the check)
            </span>
          </div>
        </li>
      </ol>
      <div class="text-caption text-grey-7">
        <template v-if="check.checker === 'stub'">Checked by the local stand-in, which only exists with the emulators and is not an AI review.</template>
        <template v-else>Checked by {{ check.model }} on {{ checkedAt }}.</template>
        Compared with:
        <span v-for="(r, i) in check.references" :key="r.id">
          <a :href="r.url" target="_blank" rel="noopener">{{ r.title }}</a> ({{ referenceNote(r) }}){{ i < check.references.length - 1 ? '; ' : '.' }}
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.bylaws-findings {
  list-style: none;
}
.bylaws-finding {
  padding: 8px 0;
  border-top: 1px solid rgba(128, 128, 128, 0.35);
}
</style>
