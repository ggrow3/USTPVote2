<script setup lang="ts">
import { computed, ref } from 'vue';
import type { MailDayTotal } from 'ustp-domain';
import { niceMax } from '../security/page-visits.js';
import { emailCount } from './mail-log-text.js';

/**
 * Emails sent per day, a column each (design §10.12), like the page visits chart (§10.7). A column shows its figure on
 * hover and picks its day on a click; the day picker beside the chart does the same from the keyboard, and the table
 * under it, for screen readers, holds the same numbers.
 */
const props = defineProps<{ days: readonly MailDayTotal[]; selected: string | null; title: string }>();
const emit = defineEmits<{ select: [day: string] }>();

const max = computed(() => niceMax(Math.max(0, ...props.days.map((d) => d.emails))));
/** Emails are whole, so the middle line shows only where it is a whole number. */
const ticks = computed(() => [max.value, ...(Number.isInteger(max.value / 2) ? [max.value / 2] : []), 0]);
const hovered = ref<number | null>(null);

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const share = (n: number) => `${(n / max.value) * 100}%`;
const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n));

/**
 * A label at a column's centre, shifted left by as much of its own width as the column is across the plot, so it
 * stays inside the plot at either edge.
 */
function at(i: number) {
  const fraction = (i + 0.5) / props.days.length;
  return { left: `${fraction * 100}%`, transform: `translateX(${-fraction * 100}%)` };
}

/** The days named under the axis: the first, the middle and the last. */
const axisDays = computed(() => {
  const n = props.days.length;
  return [...new Set([0, Math.floor((n - 1) / 2), n - 1])].filter((i) => i >= 0).map((i) => ({ i, label: dayLabel(props.days[i]!.day) }));
});
</script>

<template>
  <figure class="mail-days-chart q-ma-none">
    <figcaption class="text-body2 text-weight-medium">{{ title }}</figcaption>
    <div class="plot" :class="{ 'plot--dense': days.length > 60 }" aria-hidden="true" @mouseleave="hovered = null">
      <div v-for="t in ticks" :key="t" class="grid" :style="{ bottom: share(t) }">
        <span class="tick text-caption">{{ compact(t) }}</span>
      </div>
      <div class="columns">
        <div
          v-for="(d, i) in days"
          :key="d.day"
          class="column"
          :class="{ 'column--selected': d.day === selected }"
          @mouseenter="hovered = i"
          @click="emit('select', d.day)"
        >
          <div v-if="d.emails" class="bar" :style="{ height: share(d.emails) }" />
        </div>
      </div>
      <div v-if="hovered !== null && days[hovered]" class="tip text-caption" :style="at(hovered)">
        {{ dayLabel(days[hovered]!.day) }}: {{ emailCount(days[hovered]!.emails) }}
      </div>
    </div>
    <div class="axis text-caption text-grey-7" aria-hidden="true">
      <span v-for="a in axisDays" :key="a.i" :style="at(a.i)">{{ a.label }}</span>
    </div>
    <table class="sr-only">
      <caption>{{ title }}</caption>
      <thead>
        <tr>
          <th scope="col">Day</th>
          <th scope="col">Emails</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in days" :key="d.day">
          <th scope="row">{{ dayLabel(d.day) }}</th>
          <td>{{ d.emails }}</td>
        </tr>
      </tbody>
    </table>
  </figure>
</template>

<style scoped>
/* Categorical slot 1 of the data-viz palette, validated for each theme's surface (as the page visits chart). */
.mail-days-chart {
  --series: #2a78d6;
  --grid: rgba(0, 0, 0, 0.12);
  --chosen: rgba(0, 0, 0, 0.07);
  --tip-bg: #1a1a1a;
  --tip-text: #fff;
}
:global(.body--dark) .mail-days-chart {
  --series: #3987e5;
  --grid: rgba(255, 255, 255, 0.14);
  --chosen: rgba(255, 255, 255, 0.1);
  --tip-bg: #f0efec;
  --tip-text: #1a1a1a;
}
.plot {
  position: relative;
  height: 160px;
  margin: 12px 0 0 40px;
}
.grid {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px solid var(--grid);
}
.tick {
  position: absolute;
  right: calc(100% + 6px);
  transform: translateY(-50%);
  white-space: nowrap;
}
.columns {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: stretch;
  justify-content: space-around;
  gap: 2px;
}
.plot--dense .columns {
  gap: 1px;
}
/* The whole height of a day is its target, not only its bar. */
.column {
  flex: 1 1 0;
  max-width: 24px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  cursor: pointer;
  border-radius: 4px 4px 0 0;
}
/* The chosen day: a band behind its column, the full height of the plot (its heading below names it too). */
.column--selected {
  background: var(--chosen);
}
.bar {
  background: var(--series);
  border-radius: 4px 4px 0 0;
}
.tip {
  position: absolute;
  bottom: calc(100% + 4px);
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--tip-bg);
  color: var(--tip-text);
  width: max-content;
  max-width: 100%;
  pointer-events: none;
  z-index: 1;
}
.axis {
  position: relative;
  height: 20px;
  margin-left: 40px;
}
.axis span {
  position: absolute;
  top: 2px;
  white-space: nowrap;
}
</style>
