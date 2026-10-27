<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ElectionProgress, ElectionRecord } from 'ustp-domain';
import {
  BAND_LABELS,
  DARK_COLOURS,
  DIAGRAM_MARKS,
  LANE_SIZES as S,
  LANES,
  LIGHT_COLOURS,
  laneLayout,
  swimLanes,
} from './workflow.js';

/**
 * The workflow as swim lanes (design §6.1): a lane for each who acts, a band for each state, and the actions in the
 * order they happen, each marked with its status. Drawn to the width it is given, so its text stays one size on a phone
 * and on a desktop. It is a picture: ElectionWorkflow names it, and its list says the same in words.
 */
const props = defineProps<{ progress: ElectionProgress; election: ElectionRecord }>();
const $q = useQuasar();

/** Wider than this, the lanes only spread the actions out. */
const MAX_WIDTH = 640;
const root = ref<HTMLElement | null>(null);
const width = ref(0);
let observer: ResizeObserver | null = null;
const fit = (available: number) => (width.value = Math.min(MAX_WIDTH, Math.floor(available)));
onMounted(() => {
  // Measured now as well: a resize observer reports only once the page paints, which a background tab does not.
  fit(root.value!.clientWidth);
  observer = new ResizeObserver(([entry]) => fit(entry!.contentRect.width));
  observer.observe(root.value!);
});
onBeforeUnmount(() => observer?.disconnect());

const layout = computed(() => (width.value ? laneLayout(swimLanes(props.progress, props.election), width.value) : null));
const colours = computed(() => {
  const c = $q.dark.isActive ? DARK_COLOURS : LIGHT_COLOURS;
  return {
    '--lanes-text': c.text,
    '--lanes-node': c.node,
    '--lanes-border': c.border,
    '--lanes-done': c.done,
    '--lanes-done-border': c.doneBorder,
    '--lanes-current': c.current,
    '--lanes-current-text': c.currentText,
    '--lanes-muted': c.muted,
    '--lanes-line': c.line,
    '--lanes-band': c.cluster,
    '--lanes-band-current': c.clusterCurrent,
  };
});

/** Each line of a label, centred on the action: their y, with a line height of 15. */
const lineY = (box: { y: number }, i: number, n: number) => box.y + S.box / 2 + (i - (n - 1) / 2) * 15;
const points = (p: readonly (readonly [number, number])[]) => p.map(([x, y]) => `${x},${y}`).join(' ');
</script>

<template>
  <div ref="root" class="lanes" :style="colours">
    <svg
      v-if="layout"
      :width="layout.width"
      :height="layout.height"
      :viewBox="`0 0 ${layout.width} ${layout.height}`"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <marker id="lanes-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" class="lanes__arrowhead" />
        </marker>
      </defs>

      <!-- The lanes: a line between each two, and their names along the top. -->
      <line
        v-for="lane in layout.lanes.slice(1)"
        :key="`sep-${lane.x}`"
        class="lanes__separator"
        :x1="lane.x"
        :x2="lane.x"
        y1="0"
        :y2="layout.height"
      />
      <g v-for="(lane, i) in LANES" :key="lane.lane">
        <text
          v-for="(word, j) in lane.name"
          :key="word"
          class="lanes__lane-name"
          :x="layout.lanes[i]!.x + layout.lanes[i]!.width / 2"
          :y="15 + j * 15"
          text-anchor="middle"
        >
          {{ word }}
        </text>
        <text
          v-if="lane.detail"
          class="lanes__lane-detail"
          :x="layout.lanes[i]!.x + layout.lanes[i]!.width / 2"
          :y="30"
          text-anchor="middle"
        >
          {{ lane.detail }}
        </text>
      </g>

      <!-- A band across the lanes for each state, its name marked with its status. -->
      <g v-for="b in layout.bands" :key="b.band.band">
        <rect class="lanes__band" x="0" :y="b.y" :width="layout.width" :height="S.band" />
        <rect v-if="b.band.status === 'current'" class="lanes__band-accent" x="0" :y="b.y" width="4" :height="S.band" />
      </g>

      <polyline
        v-for="(line, i) in layout.lines"
        :key="`line-${i}`"
        class="lanes__line"
        :class="{ 'lanes__line--dashed': line.dashed }"
        :points="points(line.points)"
        marker-end="url(#lanes-arrow)"
      />

      <g v-for="box in layout.boxes" :key="box.action.id" :class="`lanes__box lanes__box--${box.action.status}`">
        <rect :x="box.x" :y="box.y" :width="box.width" :height="S.box" rx="6" />
        <text
          v-for="(word, i) in box.action.label"
          :key="word"
          :x="box.x + box.width / 2"
          :y="lineY(box, i, box.action.label.length)"
          text-anchor="middle"
          dominant-baseline="central"
        >
          {{ word }}
        </text>
        <g v-if="DIAGRAM_MARKS[box.action.status]" class="lanes__mark">
          <!-- On the top left corner, above the first line of the name. -->
          <circle :cx="box.x + 8" :cy="box.y - 1" r="6.5" />
          <text :x="box.x + 8" :y="box.y - 1" text-anchor="middle" dominant-baseline="central">
            {{ DIAGRAM_MARKS[box.action.status] }}
          </text>
        </g>
      </g>

      <!-- Last, so a line crossing a band passes under its name. -->
      <text
        v-for="b in layout.bands"
        :key="`name-${b.band.band}`"
        class="lanes__band-name"
        :class="`lanes__band-name--${b.band.status}`"
        x="10"
        :y="b.y + S.band / 2"
        dominant-baseline="central"
      >
        {{ DIAGRAM_MARKS[b.band.status] ? `${DIAGRAM_MARKS[b.band.status]} ` : '' }}{{ BAND_LABELS[b.band.band] }}
      </text>
    </svg>
  </div>
</template>

<style scoped>
.lanes {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
}
.lanes svg {
  display: block;
  font-size: 12px;
}
.lanes text {
  fill: var(--lanes-text);
}
.lanes__separator {
  stroke: var(--lanes-border);
  stroke-width: 1;
}
.lanes__lane-name {
  font-size: 13px;
  font-weight: bold;
}
.lanes text.lanes__lane-detail {
  font-size: 11px;
  fill: var(--lanes-muted);
}
.lanes__band {
  fill: var(--lanes-band);
}
.lanes__band-accent {
  fill: var(--lanes-band-current);
}
.lanes__band-name {
  font-weight: bold;
  /* A halo in the band's colour, where a line crosses it. */
  paint-order: stroke;
  stroke: var(--lanes-band);
  stroke-width: 4px;
}
/* A band not reached keeps the text colour: muted grey on the band is under 4.5:1, and its "–" says it. */
.lanes text.lanes__band-name--current {
  fill: var(--lanes-band-current);
}
.lanes__line {
  fill: none;
  stroke: var(--lanes-line);
  stroke-width: 1.5;
}
.lanes__line--dashed {
  stroke-dasharray: 4 3;
}
.lanes__arrowhead {
  fill: var(--lanes-line);
}
.lanes__box rect {
  fill: var(--lanes-node);
  stroke: var(--lanes-border);
  stroke-width: 1;
}
.lanes__box--done rect {
  fill: var(--lanes-done);
  stroke: var(--lanes-done-border);
}
.lanes__box--current rect {
  fill: var(--lanes-current);
  stroke: var(--lanes-current);
  stroke-width: 3;
}
.lanes .lanes__box--current > text {
  fill: var(--lanes-current-text);
  font-weight: bold;
}
.lanes__box--possible rect,
.lanes__box--not_reached rect {
  stroke-dasharray: 5 4;
}
.lanes__box--not_reached rect {
  stroke: var(--lanes-muted);
}
.lanes .lanes__box--not_reached > text {
  fill: var(--lanes-muted);
}
.lanes__mark circle {
  fill: var(--lanes-node);
  stroke-width: 1.5;
}
.lanes__mark text {
  font-size: 10px;
  font-weight: bold;
}
.lanes__box--done .lanes__mark circle {
  fill: var(--lanes-done-border);
  stroke: var(--lanes-done-border);
}
.lanes .lanes__box--done .lanes__mark text {
  fill: var(--lanes-node);
}
.lanes__box--current .lanes__mark circle {
  stroke: var(--lanes-current);
}
.lanes .lanes__box--current .lanes__mark text {
  fill: var(--lanes-current);
}
.lanes__box--not_reached .lanes__mark circle {
  stroke: var(--lanes-muted);
}
.lanes .lanes__box--not_reached .lanes__mark text {
  fill: var(--lanes-muted);
}
</style>
