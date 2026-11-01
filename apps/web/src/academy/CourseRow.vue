<script setup lang="ts">
import { computed } from 'vue';
import type { CourseMapEntry, LearnerCourseStatus } from 'ustp-domain';
import CourseArt from './CourseArt.vue';
import { catalogState, shortLine, statusLine } from './course-catalog.js';

/**
 * One course as a row of the Courses page (design §10.8): its artwork, title, a short line and where the learner
 * stands. A published course's row links to its page; a draft's says it is coming soon and links nowhere.
 */
const props = defineProps<{
  course: CourseMapEntry;
  status?: LearnerCourseStatus;
  titles: ReadonlyMap<string, string>;
}>();

const state = computed(() => catalogState(props.course, props.status));
const line = computed(() => statusLine(props.course, props.status, props.titles));
const progress = computed(() => (props.status && props.status.lessonCount ? props.status.lessonsPassed / props.status.lessonCount : 0));
/**
 * For a visitor, the courses before a published one, whose quizzes wait for them; a learner's own status says it when
 * it matters (locked), and a draft's short line already names them.
 */
const after = computed(() =>
  state.value === 'open' && props.course.summary ? props.course.prerequisites.map((id) => props.titles.get(id) ?? id).join(' and ') : '',
);
</script>

<template>
  <component
    :is="course.published ? 'router-link' : 'div'"
    :to="course.published ? `/course/${course.courseId}` : undefined"
    class="course-row"
    :class="`course-row--${state.replace('_', '-')}`"
  >
    <CourseArt :course-id="course.courseId" class="course-row__art" />
    <span class="course-row__text">
      <span class="course-row__title">{{ course.title }}</span>
      <span class="course-row__line">{{ shortLine(course, titles) }}</span>
      <span class="course-row__status"><q-icon :name="line.icon" size="16px" />{{ line.label }}<template v-if="after"> · after {{ after }}</template></span>
      <q-linear-progress
        v-if="state === 'in_progress'"
        :value="progress"
        rounded
        size="4px"
        color="primary"
        class="course-row__progress"
        aria-hidden="true"
      />
    </span>
  </component>
</template>
