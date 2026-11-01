<script setup lang="ts">
import { computed, ref } from 'vue';
import { niceMax, type DayHits } from './page-visits.js';

/**
 * Hits per day as stacked columns, signed in at the base and signed out above (design §10.7). Each column shows its
 * figures on hover; the table beside it, for screen readers, holds the same numbers.
 */
const props = defineProps<{ days: readonly DayHits[]; title: string }>();

const max = computed(() => niceMax(Math.max(0, ...props.days.map((d) => d.signedIn + d.signedOut))));
/** Hits are whole, so the middle line shows only where it is a whole number. */
const ticks = computed(() => [max.value, ...(Number.isInteger(max.value / 2) ? [max.value / 2] : []), 0]);
const hovered = ref<number | null>(null);

const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const share = (n: number) => `${(n / max.value) * 100}%`;
const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n));
const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;
const describe = (d: DayHits) => `${dayLabel(d.day)}: ${plural(d.signedIn + d.signedOut, 'hit')} (${d.signedIn} signed in, ${d.signedOut} signed out)`;

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
  <figure class="visits-chart q-ma-none">
    <figcaption class="row items-center q-gutter-md text-body2">
      <span class="text-weight-medium">{{ title }}</span>
      <span class="row items-center q-gutter-xs"><span class="swatch swatch--in" aria-hidden="true" />Signed in</span>
      <span class="row items-center q-gutter-xs"><span class="swatch swatch--out" aria-hidden="true" />Signed out</span>
    </figcaption>
    <div class="plot" :class="{ 'plot--dense': days.length > 90 }" aria-hidden="true" @mouseleave="hovered = null">
      <div v-for="t in ticks" :key="t" class="grid" :style="{ bottom: share(t) }">
        <span class="tick text-caption">{{ compact(t) }}</span>
      </div>
      <div class="columns">
        <div v-for="(d, i) in days" :key="d.day" class="column" @mouseenter="hovered = i">
          <div v-if="d.signedOut" class="segment segment--out top" :style="{ height: share(d.signedOut) }" />
          <div v-if="d.signedIn" class="segment segment--in" :class="{ top: !d.signedOut }" :style="{ height: share(d.signedIn) }" />
        </div>
      </div>
      <div
        v-if="hovered !== null && days[hovered]"
        class="tip text-caption"
        :style="at(hovered)"
      >
        {{ describe(days[hovered]!) }}
      </div>
    </div>
    <div class="axis text-caption text-grey-7" aria-hidden="true">
      <span v-for="a in axisDays" :key="a.i" :style="at(a.i)">{{ a.label }}</span>
    </div>
    <table class="sr-only">
      <caption>{{ title }}, per day</caption>
      <thead>
        <tr>
          <th scope="col">Day</th>
          <th scope="col">Signed in</th>
          <th scope="col">Signed out</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in days" :key="d.day">
          <th scope="row">{{ dayLabel(d.day) }}</th>
          <td>{{ d.signedIn }}</td>
          <td>{{ d.signedOut }}</td>
        </tr>
      </tbody>
    </table>
  </figure>
</template>

<style scoped>
/* Categorical slots 1 and 2 of the data-viz palette, validated for each theme's surface. */
.visits-chart {
  --series-in: #2a78d6;
  --series-out: #eb6834;
  --grid: rgba(0, 0, 0, 0.12);
  --tip-bg: #1a1a1a;
  --tip-text: #fff;
}
:global(.body--dark) .visits-chart {
  --series-in: #3987e5;
  --series-out: #d95926;
  --grid: rgba(255, 255, 255, 0.14);
  --tip-bg: #f0efec;
  --tip-text: #1a1a1a;
}
.swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 4px;
  border-radius: 2px;
}
.swatch--in,
.segment--in {
  background: var(--series-in);
}
.swatch--out,
.segment--out {
  background: var(--series-out);
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
.column {
  flex: 1 1 0;
  max-width: 24px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 2px;
}
.segment.top {
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
