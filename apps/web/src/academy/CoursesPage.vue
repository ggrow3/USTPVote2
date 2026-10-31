<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CourseMap, CourseMapEntry, LearnerCourseState, LearnerCourseStatus } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { session } from '../session.js';
import CourseMapView from './CourseMap.vue';
import { statusText } from './course-map.js';

/** Every course (design §10.8): the map of which comes after which, and the same courses as a list to pick from. */
usePageTitle('Courses');

const map = ref<CourseMap | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);

const titles = computed(() => new Map((map.value?.courses ?? []).map((course) => [course.courseId, course.title])));
const statuses = computed(() => new Map((map.value?.status ?? []).map((status) => [status.courseId, status])));
const onMap = computed(() => (map.value?.courses ?? []).filter((course) => course.position));

const status = (course: CourseMapEntry): LearnerCourseStatus | undefined => statuses.value.get(course.courseId);
const CARD_CLASSES: Record<LearnerCourseState, string> = { passed: 'course-card--passed', locked: 'course-card--locked', in_progress: '', not_started: '' };
const ICONS: Record<LearnerCourseState, string> = { passed: 'check_circle', locked: 'lock', in_progress: 'play_circle', not_started: 'menu_book' };
const cardClass = (course: CourseMapEntry) => (course.published ? CARD_CLASSES[status(course)?.state ?? 'not_started'] : 'course-card--soon');
const icon = (course: CourseMapEntry) => (course.published ? ICONS[status(course)?.state ?? 'not_started'] : 'schedule');
const after = (course: CourseMapEntry) => course.prerequisites.map((id) => titles.value.get(id) ?? id).join(' and ');
const describe = (course: CourseMapEntry) =>
  [course.title, statusText(status(course), course.published, titles.value), course.prerequisites.length ? `after ${after(course)}` : '']
    .filter(Boolean)
    .join(', ');

async function load() {
  loading.value = true;
  error.value = null;
  try {
    map.value = await api<CourseMap>('GET', session.user ? '/v1/courses' : '/v1/public/courses');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

watch(() => session.user?.uid, () => void load(), { immediate: true });
</script>

<template>
  <PageShell width="wide">
    <h1 class="text-h4 q-mt-none q-mb-sm">Courses</h1>
    <p class="text-body1">
      Free courses from the U.S. Transhumanist Party. Anyone can read every lesson. Sign in to take the quizzes, keep your
      progress and earn a certificate for each course. A line joins a course to the ones after it, whose quizzes open once
      you have passed it.
    </p>
    <q-banner v-if="!session.user" class="bg-blue-1 text-black q-mb-md" rounded>
      <router-link :to="{ path: '/signin', query: { redirect: '/courses' } }">Sign in</router-link> to see where you stand in each course.
    </q-banner>
    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded role="alert">{{ error }}</q-banner>
    <q-skeleton v-if="loading && !map" type="rect" height="420px" />
    <template v-else-if="map">
      <section v-if="onMap.length" aria-labelledby="course-map-heading" class="q-mb-lg">
        <h2 id="course-map-heading" class="text-h6 q-mb-sm">Course map</h2>
        <CourseMapView :courses="map.courses" label="Course map: each course, joined by lines to the courses after it">
          <template #card="{ course }">
            <router-link v-if="course.published" :to="`/course/${course.courseId}`" class="course-card" :class="cardClass(course)" :aria-label="describe(course)">
              <span class="course-card__title">{{ course.title }}</span>
              <span class="course-card__status"><q-icon :name="icon(course)" size="16px" />{{ statusText(status(course), true, titles, { onMap: true }) }}</span>
            </router-link>
            <div v-else class="course-card course-card--soon" role="img" :aria-label="describe(course)">
              <span class="course-card__title">{{ course.title }}</span>
              <span class="course-card__status"><q-icon name="schedule" size="16px" />Coming soon</span>
            </div>
          </template>
        </CourseMapView>
      </section>

      <section aria-labelledby="course-list-heading">
        <h2 id="course-list-heading" class="text-h6 q-mb-sm">All courses</h2>
        <q-list bordered separator class="rounded-borders">
          <q-item
            v-for="course in map.courses"
            :key="course.courseId"
            :clickable="course.published"
            :to="course.published ? `/course/${course.courseId}` : undefined"
          >
            <q-item-section avatar><q-icon :name="icon(course)" :color="course.published ? 'primary' : 'grey-7'" /></q-item-section>
            <q-item-section>
              <q-item-label class="text-weight-medium">{{ course.title }}</q-item-label>
              <q-item-label v-if="course.summary" caption>{{ course.summary }}</q-item-label>
              <q-item-label caption>
                {{ statusText(status(course), course.published, titles) }}<template v-if="course.prerequisites.length"> · after {{ after(course) }}</template>
              </q-item-label>
            </q-item-section>
            <q-item-section v-if="course.published" side><q-icon name="chevron_right" /></q-item-section>
          </q-item>
        </q-list>
      </section>
    </template>
  </PageShell>
</template>
