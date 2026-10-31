<script setup lang="ts" generic="C extends MapCourse">
import { computed } from 'vue';
import { courseMapLayout, MAP_GEOMETRY, type MapCourse } from './course-map.js';

/**
 * The course map (design §10.8): a card per course on the map, and a line from each course to those after it. The
 * page fills each card through the `card` slot (a link for learners, a button in the Course tab). Wider than a phone,
 * it scrolls sideways inside its own box; the course list beside it says the same in words.
 */
const props = defineProps<{
  courses: readonly C[];
  /** Says what the map shows, for people who can't see it. */
  label: string;
}>();
defineSlots<{ card(props: { course: C }): unknown }>();

const layout = computed(() => courseMapLayout(props.courses));
const { cardWidth, cardHeight } = MAP_GEOMETRY;
</script>

<template>
  <div class="course-map" role="group" :aria-label="label">
    <div class="course-map__canvas" :style="{ width: `${layout.width}px`, height: `${layout.height}px` }">
      <svg class="course-map__lines" :width="layout.width" :height="layout.height" aria-hidden="true">
        <path v-for="line in layout.lines" :key="`${line.from}>${line.to}`" :d="line.path" />
      </svg>
      <div
        v-for="card in layout.cards"
        :key="card.course.courseId"
        class="course-map__cell"
        :style="{ left: `${card.x}px`, top: `${card.y}px`, width: `${cardWidth}px`, height: `${cardHeight}px` }"
      >
        <slot name="card" :course="card.course" />
      </div>
    </div>
  </div>
</template>

<style>
.course-map { overflow-x: auto; padding: 8px 4px 16px; }
.course-map__canvas { position: relative; margin: 0 auto; }
.course-map__lines { position: absolute; inset: 0; overflow: visible; }
.course-map__lines path { fill: none; stroke: #d32f2f; stroke-width: 3; stroke-linejoin: round; }
.course-map__cell { position: absolute; }

/* A card on the map, whichever element the page makes it; scoped under the map to win over the page's link colour. */
.course-map .course-map__cell .course-card {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
  padding: 12px;
  border-radius: 8px;
  border: 2px solid #1d3fd8;
  background: #1d3fd8;
  color: #fff;
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.course-map .course-map__cell .course-card:hover { background: #1634b8; }
.course-map .course-map__cell .course-card:focus-visible { outline: 3px solid #ffb300; outline-offset: 3px; }
.course-map .course-map__cell .course-card__title { font-weight: 700; line-height: 1.25; font-size: 0.95rem; }
.course-map .course-map__cell .course-card__status { display: flex; align-items: center; gap: 4px; font-size: 0.8rem; line-height: 1.3; }
.course-map .course-map__cell .course-card--soon { background: #f4f6fb; color: #33415c; border-style: dashed; border-color: #6b7a99; cursor: default; box-shadow: none; }
.course-map .course-map__cell .course-card--soon:hover { background: #f4f6fb; }
.course-map .course-map__cell .course-card--passed { background: #1b5e20; border-color: #1b5e20; }
.course-map .course-map__cell .course-card--passed:hover { background: #174f1b; }
.course-map .course-map__cell .course-card--locked { background: #3c4a66; border-color: #3c4a66; }
.course-map .course-map__cell .course-card--locked:hover { background: #33405a; }
.course-map .course-map__cell .course-card--selected { outline: 4px solid #ffb300; outline-offset: 2px; }
</style>
