<script setup lang="ts" generic="C extends MapCourse">
import { computed } from 'vue';
import { courseMapLayout, MAP_GEOMETRY, type MapCourse } from './course-map.js';
import './course-map.css';

/**
 * The course map (design §10.8): a card per course on the map, and a line from each course to those after it. The
 * page fills each card through the `card` slot (a link for learners). Wider than a phone, it scrolls sideways inside
 * its own box; the course list beside it says the same in words. The Course tab edits the map on its own board
 * (`CourseMapCard.vue`), with the same look.
 */
const props = defineProps<{
  courses: readonly C[];
  /** Says what the map shows, for people who can't see it. */
  label: string;
}>();
defineSlots<{ card(props: { course: C }): unknown }>();

const layout = computed(() => courseMapLayout(props.courses, { trim: true }));
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
