<script setup lang="ts">
import { computed } from 'vue';
import { choiceShare, leadingChoices, percent, type PollChoice, type PollResults } from 'ustp-domain';
import { answersText } from './polls.js';

/**
 * A poll's results (design §10.16): a bar per choice for everyone who answered and, beside it, for the Active
 * members who answered signed in. Each bar says its share and count in words too, for screen readers and print.
 */
const props = defineProps<{
  choices: readonly PollChoice[];
  results: PollResults;
  /** The choice this browser answered with, if it remembers one. */
  mine?: string | null;
}>();

const showMembers = computed(() => props.results.members.total > 0);
const leaders = computed(() => new Set(leadingChoices(props.choices, props.results.everyone).map((c) => c.choiceId)));

const rows = computed(() =>
  props.choices.map((c) => {
    const everyone = choiceShare(props.results.everyone, c.choiceId);
    const members = choiceShare(props.results.members, c.choiceId);
    return {
      ...c,
      everyone: { n: everyone.part, pct: percent(everyone, 0) ?? '0%', width: everyone.whole ? (100 * everyone.part) / everyone.whole : 0 },
      members: { n: members.part, pct: percent(members, 0) ?? '0%', width: members.whole ? (100 * members.part) / members.whole : 0 },
      leading: leaders.value.has(c.choiceId),
    };
  }),
);
</script>

<template>
  <div class="poll-bars">
    <div class="poll-bars__legend text-caption text-grey-7">
      <span><span class="poll-bars__key poll-bars__key--everyone" aria-hidden="true" />Everyone: {{ answersText(results.everyone.total) }}</span>
      <span v-if="showMembers"><span class="poll-bars__key poll-bars__key--members" aria-hidden="true" />Active members: {{ answersText(results.members.total) }}</span>
      <span v-else>No Active members have answered signed in yet.</span>
    </div>
    <ul class="poll-bars__list">
      <li v-for="r in rows" :key="r.choiceId" class="poll-bars__row">
        <div class="poll-bars__label">
          <span :class="{ 'text-weight-bold': r.leading }">{{ r.label }}</span>
          <q-badge v-if="mine === r.choiceId" outline color="primary" label="Your answer" class="q-ml-sm" />
        </div>
        <div class="poll-bars__bar" role="img" :aria-label="`Everyone: ${r.everyone.pct}, ${answersText(r.everyone.n)}`">
          <div class="poll-bars__fill poll-bars__fill--everyone" :style="{ width: `${r.everyone.width}%` }" />
        </div>
        <div class="poll-bars__value" aria-hidden="true">{{ r.everyone.pct }} · {{ r.everyone.n.toLocaleString() }}</div>
        <template v-if="showMembers">
          <div class="poll-bars__bar poll-bars__bar--members" role="img" :aria-label="`Active members: ${r.members.pct}, ${answersText(r.members.n)}`">
            <div class="poll-bars__fill poll-bars__fill--members" :style="{ width: `${r.members.width}%` }" />
          </div>
          <div class="poll-bars__value text-grey-7" aria-hidden="true">{{ r.members.pct }} · {{ r.members.n.toLocaleString() }}</div>
        </template>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.poll-bars__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin-bottom: 8px;
}
.poll-bars__key {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  margin-right: 6px;
  vertical-align: -1px;
}
.poll-bars__key--everyone,
.poll-bars__fill--everyone {
  background: var(--q-primary);
}
.poll-bars__key--members,
.poll-bars__fill--members {
  background: var(--q-secondary, #26a69a);
}
.poll-bars__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}
.poll-bars__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 12px;
  row-gap: 4px;
  align-items: center;
}
.poll-bars__label {
  grid-column: 1 / -1;
}
.poll-bars__bar {
  height: 14px;
  border-radius: 7px;
  background: rgba(127, 127, 127, 0.18);
  overflow: hidden;
}
.poll-bars__bar--members {
  height: 8px;
}
.poll-bars__fill {
  height: 100%;
  border-radius: inherit;
  min-width: 2px;
}
.poll-bars__value {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  font-size: 0.85rem;
}
@media print {
  .poll-bars__fill {
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
}
</style>
