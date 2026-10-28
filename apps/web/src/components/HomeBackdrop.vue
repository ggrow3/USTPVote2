<script setup lang="ts">
import { useId } from 'vue';

/**
 * The voting home's background (design §10.5), and every other page's but the hub's (PageShell): a sunrise over a
 * horizon in the party's oranges, morning in the light theme and dusk in the dark one. Drawn for this project, so the
 * party may use it freely, and a little script in the app shell rather than a photo. Decorative: text over it sits on
 * a `.ustp-scrim` or a page's card.
 */
const id = useId();
const STARS = [
  [90, 70, 1.6], [240, 150, 1.2], [380, 60, 2], [520, 190, 1.2], [660, 90, 1.6], [820, 40, 1.2], [930, 170, 2],
  [1080, 80, 1.4], [1210, 200, 1.2], [1340, 60, 1.8], [1480, 140, 1.4], [170, 280, 1.2], [450, 320, 1.4], [1530, 300, 1.2],
] as const;
</script>

<template>
  <svg
    class="ustp-backdrop"
    :class="{ 'ustp-backdrop--dark': $q.dark.isActive }"
    viewBox="0 0 1600 1000"
    preserveAspectRatio="xMidYMax slice"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient :id="`${id}-sky`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" class="ustp-backdrop__sky-1" />
        <stop offset=".55" class="ustp-backdrop__sky-2" />
        <stop offset=".8" class="ustp-backdrop__sky-3" />
      </linearGradient>
      <radialGradient :id="`${id}-glow`">
        <stop offset="0" class="ustp-backdrop__glow" stop-opacity=".85" />
        <stop offset="1" class="ustp-backdrop__glow" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect width="1600" height="1000" :fill="`url(#${id}-sky)`" />
    <g class="ustp-backdrop__stars">
      <circle v-for="([x, y, r], i) in STARS" :key="i" :cx="x" :cy="y" :r="r" />
    </g>
    <circle cx="1130" cy="780" r="560" :fill="`url(#${id}-glow)`" />
    <g class="ustp-backdrop__orbits" fill="none">
      <ellipse cx="1130" cy="780" rx="300" ry="110" />
      <ellipse cx="1130" cy="780" rx="470" ry="180" />
      <ellipse cx="1130" cy="780" rx="660" ry="260" />
    </g>
    <circle class="ustp-backdrop__sun" cx="1130" cy="780" r="120" />
    <path class="ustp-backdrop__land-1" d="M0 800 C260 770 520 812 800 792 S1340 762 1600 786 V1000 H0 Z" />
    <path class="ustp-backdrop__land-2" d="M0 858 C300 828 640 878 960 852 S1420 826 1600 846 V1000 H0 Z" />
    <path class="ustp-backdrop__land-3" d="M0 926 C360 896 760 940 1120 914 S1480 904 1600 910 V1000 H0 Z" />
  </svg>
</template>

<style scoped>
/* Colours for each theme; docs/ACCESSIBILITY.md has the contrast of the text over them. */
.ustp-backdrop {
  --sky-1: #fff8f1;
  --sky-2: #ffe6cf;
  --sky-3: #ffc497;
  --glow: #ffb070;
  --sun: #ff8a3d;
  --orbit: #bd4e00;
  --land-1: #f39a5c;
  --land-2: #dd7433;
  --land-3: #bd4e00;
  --stars: 0;
  display: block;
}
.ustp-backdrop--dark {
  --sky-1: #0b0a10;
  --sky-2: #1c1016;
  --sky-3: #4a1d06;
  --glow: #ff6900;
  --sun: #ff7a1a;
  --orbit: #ff9a52;
  --land-1: #3a1705;
  --land-2: #2a1004;
  --land-3: #170802;
  --stars: 0.7;
}
.ustp-backdrop__sky-1 {
  stop-color: var(--sky-1);
}
.ustp-backdrop__sky-2 {
  stop-color: var(--sky-2);
}
.ustp-backdrop__sky-3 {
  stop-color: var(--sky-3);
}
.ustp-backdrop__glow {
  stop-color: var(--glow);
}
.ustp-backdrop__stars {
  fill: #fff;
  opacity: var(--stars);
}
.ustp-backdrop__orbits {
  stroke: var(--orbit);
  stroke-width: 1.5;
  opacity: 0.3;
}
.ustp-backdrop__sun {
  fill: var(--sun);
}
.ustp-backdrop__land-1 {
  fill: var(--land-1);
}
.ustp-backdrop__land-2 {
  fill: var(--land-2);
}
.ustp-backdrop__land-3 {
  fill: var(--land-3);
}
</style>
