<script setup lang="ts">
import { computed } from 'vue';
import type { ContestRecord, ElectionCheckView, ElectionState } from 'ustp-domain';
import { focusSoon } from '../a11y.js';
import { SEVERITY_ICONS } from '../bylaws-check-text.js';
import { changesLabel, INTRO, NOTE_SEVERITY_LABELS, quotedLine, statusText, TOPIC_LABELS } from './election-check-text.js';

/**
 * The election setup check in the editor (design §6.9): what it does and who sees it, the button, its progress, and its
 * notes, each linked to its contest. The same notes appear beside each contest card, and once the election is
 * scheduled, beside the contests on every member's ballot and on the results page. Shown while the server offers the
 * check, and afterwards wherever there is a check to read.
 */
const props = defineProps<{
  check: ElectionCheckView | null;
  /** Whether the server offers the check (switched on and, for Claude, a key added); null until it has said. */
  enabled: boolean | null;
  loading: boolean;
  requesting: boolean;
  error: string;
  gaveUp: boolean;
  state: ElectionState;
  contests: readonly ContestRecord[];
  /** Election Admin or Auditor, before voting closes. */
  canRun: boolean;
}>();
const emit = defineEmits<{ run: []; goToContest: [contestId: string] }>();

const shown = computed(() => props.enabled === true || !!props.check);
const busy = computed(() => props.requesting || props.check?.status === 'queued' || props.check?.status === 'running');
const upToDate = computed(() => props.check?.status === 'done' && props.check.changedSince.length === 0);
const titleOf = (contestId: string) => props.contests.find((c) => c.contestId === contestId)?.title ?? contestId;
const checkedAt = computed(() => (props.check?.finishedAt ? new Date(props.check.finishedAt).toLocaleString() : ''));

async function run() {
  emit('run');
  // The button is disabled while the check runs; focus goes to where its progress and result appear.
  await focusSoon('#bylaws-check-status');
}
</script>

<template>
  <q-card v-if="shown" flat bordered tag="section" aria-labelledby="bylaws-check">
    <q-card-section>
      <h2 id="bylaws-check" class="text-subtitle1">Check against the bylaws</h2>
      <div class="text-caption text-grey-7">{{ INTRO }}</div>
    </q-card-section>

    <q-card-section>
      <div v-if="canRun && enabled" class="ustp-actions">
        <q-btn
          color="primary"
          no-caps
          icon="fact_check"
          label="Check against the bylaws"
          :loading="busy"
          :disable="busy || loading || upToDate"
          @click="run"
        />
        <span v-if="upToDate" class="text-caption text-grey-7">Checked; nothing has changed since.</span>
      </div>
      <div v-else-if="!loading && !check" class="text-grey-7">This election was not checked against the bylaws.</div>

      <div id="bylaws-check-status" class="q-mt-sm">
        <template v-if="busy">
          <q-spinner size="1.2em" aria-hidden="true" class="q-mr-xs" />{{ statusText(check, requesting) }}
        </template>
        <strong v-else-if="check?.status === 'done'">{{ statusText(check) }}</strong>
      </div>
      <div v-if="gaveUp" class="text-deep-orange-10 q-mt-sm">
        The check is taking longer than it should. It may still finish; if not, it is marked failed and you can run it again.
      </div>
      <q-banner v-if="error" class="bg-negative text-white q-mt-sm" rounded>{{ error }}</q-banner>
      <q-banner v-else-if="check?.status === 'failed'" class="bg-negative text-white q-mt-sm" rounded>
        The check failed: {{ check.error }}
      </q-banner>

      <template v-if="check?.status === 'done'">
        <p class="q-mt-xs q-mb-sm">{{ check.summary }}</p>
        <q-banner v-if="check.changedSince.length" class="bg-orange-2 text-black q-mb-sm" rounded dense>
          Out of date: {{ changesLabel(check.changedSince) }} changed since this check.
          <template v-if="state === 'draft'">Check again so members see notes about the version that is scheduled.</template>
        </q-banner>
        <div v-else-if="state === 'draft'" class="text-caption text-grey-7 q-mb-sm">
          Members will see these notes once the election is scheduled, as long as it is not changed first.
        </div>
        <ol v-if="check.findings.length" class="election-notes">
          <li v-for="(f, i) in check.findings" :key="i" class="election-note">
            <div class="ustp-toolbar">
              <span class="text-weight-medium">Note {{ i + 1 }}</span>
              <span class="text-deep-orange-10 text-weight-medium">
                <q-icon :name="SEVERITY_ICONS[f.severity]" size="18px" aria-hidden="true" /> {{ NOTE_SEVERITY_LABELS[f.severity] }}
              </span>
              <span class="text-grey-7">{{ TOPIC_LABELS[f.topic] }}</span>
            </div>
            <div class="q-my-xs">{{ f.explanation }}</div>
            <template v-for="line in f.bylawsLines" :key="line">
              <blockquote v-if="quotedLine(check, line)" class="election-quote text-caption">
                <span class="text-grey-7">Bylaws, line {{ line }}:</span> “{{ quotedLine(check, line) }}”
              </blockquote>
            </template>
            <q-btn
              v-if="f.contestId"
              flat
              dense
              no-caps
              color="primary"
              icon="arrow_downward"
              label="Go to contest"
              class="election-link"
              @click="emit('goToContest', f.contestId)"
            >
              <span class="sr-only">&nbsp;{{ titleOf(f.contestId) }}</span>
            </q-btn>
            <div v-else class="text-caption text-grey-7">About the election as a whole.</div>
          </li>
        </ol>
        <div class="text-caption text-grey-7">
          <template v-if="check.checker === 'stub'">Checked by the local stand-in, which only exists with the emulators and is not an AI review.</template>
          <template v-else>Checked by {{ check.model }} on {{ checkedAt }}.</template>
          Compared with bylaws version {{ check.basis?.bylaws.version }}.
        </div>
      </template>
    </q-card-section>
  </q-card>
</template>

<style scoped>
.election-notes {
  list-style: none;
  margin: 8px 0;
  padding: 0;
}
.election-note {
  padding: 8px 0;
  border-top: 1px solid rgba(128, 128, 128, 0.35);
  overflow-wrap: anywhere;
}
.election-quote {
  margin: 4px 0;
  padding-left: 8px;
  border-left: 2px solid rgba(128, 128, 128, 0.45);
}
</style>
