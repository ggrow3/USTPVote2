<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { biggestDrop, FIRST_STEP_LABELS, FIRST_STEPS, JOIN_FUNNEL_PERIODS, type JoinFunnelReport } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { joinFunnel } from './api.js';
import { dropText, stepShare, waitingText } from './join-funnel-text.js';

/** The join funnel (design §5.15): where people stop between making an account and taking part, for Membership Admins. */

const days = ref<number>(30);
const report = ref<JoinFunnelReport | null>(null);
const loading = ref(false);
const failed = ref(false);
const open = ref(false);

const periodOptions = JOIN_FUNNEL_PERIODS.map((d) => ({ value: d, label: `Last ${d} days` }));
const drop = computed(() => (report.value ? biggestDrop(report.value) : null));
const approved = computed(() => report.value?.steps.find((s) => s.id === 'approved')?.count ?? 0);

async function load() {
  loading.value = true;
  failed.value = !(await attempt(async () => {
    report.value = await joinFunnel(days.value);
  }));
  loading.value = false;
}
watch(days, load);
watch(open, (now) => {
  if (now && !report.value) void load();
});
</script>

<template>
  <q-expansion-item
    v-model="open"
    class="ustp-join-funnel"
    icon="filter_alt"
    label="Join funnel"
    caption="Where people stop between making an account and taking part"
    header-class="text-subtitle1"
  >
    <q-card flat bordered>
      <q-card-section class="q-gutter-sm">
        <div class="ustp-toolbar">
          <q-select
            v-model="days"
            dense
            outlined
            emit-value
            map-options
            :options="periodOptions"
            label="Period"
            style="min-width: 160px"
          />
          <q-btn flat dense icon="refresh" aria-label="Refresh the join funnel" :loading="loading" @click="load" />
        </div>
        <div v-if="!report" class="text-grey-7">{{ failed ? 'Could not load the join funnel.' : 'Loading…' }}</div>
        <template v-else>
          <div class="text-caption text-grey-7">
            People who made an account since {{ report.from }} (UTC). Counts only; members a Membership Admin added and
            test voters are left out. The Register page was opened {{ report.registerOpens }}
            {{ report.registerOpens === 1 ? 'time' : 'times' }} in the period ({{ report.registerOpensSignedIn }} signed in).
          </div>
          <table class="ustp-funnel" aria-label="Join funnel steps">
            <thead>
              <tr>
                <th scope="col" class="text-left">Step</th>
                <th scope="col" class="text-right">People</th>
                <th scope="col" class="text-right">Of the step before</th>
                <th scope="col"><span class="sr-only">Share of accounts</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="step in report.steps" :key="step.id" :class="{ 'ustp-funnel-drop': drop?.step.id === step.id }">
                <th scope="row" class="text-left text-weight-regular">{{ step.label }}</th>
                <td class="text-right">{{ step.count }}</td>
                <td class="text-right">{{ step.ofPrevious === null ? '' : `${step.ofPrevious}%` }}</td>
                <td class="ustp-funnel-bar">
                  <q-linear-progress :value="stepShare(report, step)" size="10px" rounded aria-hidden="true" />
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="drop" class="text-body2">{{ dropText(drop) }}</div>
          <div class="text-body2">{{ waitingText(report) }}</div>
          <div v-if="approved" class="text-body2">
            Of the {{ approved }} approved:
            <span v-for="(step, i) in FIRST_STEPS" :key="step"
              >{{ FIRST_STEP_LABELS[step].toLowerCase() }} {{ report.firstSteps[step] }}{{ i < FIRST_STEPS.length - 1 ? ' · ' : '' }}</span
            >
          </div>
          <div v-if="report.truncated" class="text-caption text-warning">
            More accounts were made in this period than the report reads; the newest are left out. Choose a shorter period.
          </div>
        </template>
      </q-card-section>
    </q-card>
  </q-expansion-item>
</template>

<style scoped>
.ustp-funnel {
  width: 100%;
  border-collapse: collapse;
}
.ustp-funnel th,
.ustp-funnel td {
  padding: 4px 8px;
}
.ustp-funnel-bar {
  width: 40%;
  min-width: 80px;
}
.ustp-funnel-drop th,
.ustp-funnel-drop td {
  font-weight: 600;
}
</style>
