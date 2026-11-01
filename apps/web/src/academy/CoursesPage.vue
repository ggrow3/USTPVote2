<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { CourseMap, CourseMapEntry, LearnerCourseState, LearnerCourseStatus } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { session } from '../session.js';
import CourseCarousel from './CourseCarousel.vue';
import CourseMapView from './CourseMap.vue';
import CourseRow from './CourseRow.vue';
import { catalogPanels, heroSlides, matchesQuery } from './course-catalog.js';
import { statusText } from './course-map.js';
import './course-catalog.css';

/**
 * Every course (design §10.8): a search box, the featured courses, panels of courses to start, to continue and coming
 * soon, then every course as a list or as the map of which comes after which.
 */
usePageTitle('Courses');

const route = useRoute();
const router = useRouter();
const map = ref<CourseMap | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);
/** What is typed in the search box; its clear button makes it null. */
const query = ref<string | null>('');
const typed = computed(() => (query.value ?? '').trim());

const titles = computed(() => new Map((map.value?.courses ?? []).map((course) => [course.courseId, course.title])));
const statuses = computed(() => new Map((map.value?.status ?? []).map((status) => [status.courseId, status])));
const onMap = computed(() => (map.value?.courses ?? []).filter((course) => course.position));
const slides = computed(() => (map.value ? heroSlides(map.value) : []));
const searching = computed(() => typed.value.length > 0);
const results = computed(() => (map.value?.courses ?? []).filter((course) => matchesQuery(course, typed.value)));

/** Rows a panel shows until "Show all". */
const PANEL_ROWS = 3;
const expanded = ref(new Set<string>());
const panels = computed(() => {
  if (!map.value) return [];
  const { start, continuing, soon } = catalogPanels(map.value);
  return [
    { key: 'start', title: 'Start here', icon: 'flag', courses: start },
    { key: 'continue', title: 'Continue learning', icon: 'play_circle', courses: continuing },
    { key: 'soon', title: 'Coming soon', icon: 'schedule', courses: soon },
  ].filter((panel) => panel.courses.length);
});
const shown = (panel: { key: string; courses: readonly CourseMapEntry[] }) =>
  expanded.value.has(panel.key) ? panel.courses : panel.courses.slice(0, PANEL_ROWS);
function toggle(key: string) {
  const next = new Set(expanded.value);
  if (!next.delete(key)) next.add(key);
  expanded.value = next;
}

/** The list or the map, kept in the address so a reload or a shared link opens the same one. */
const setView = (value: string) => router.replace({ query: { ...route.query, view: value === 'map' ? 'map' : undefined } });
const view = computed({
  get: () => (route.query.view === 'map' && onMap.value.length ? 'map' : 'list'),
  set: (value: string) => void setView(value),
});
const everyCourse = ref<HTMLElement | null>(null);
/** The drafts' card: opens the map and moves there, focus on its tab. */
async function showMap() {
  await setView('map');
  await nextTick();
  everyCourse.value?.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  everyCourse.value?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
}

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
    <div class="course-catalog">
      <header class="course-catalog__head">
        <div class="course-catalog__intro">
          <h1 class="text-h4 q-mt-none q-mb-xs">Courses</h1>
          <p class="text-body1 q-mb-none">
            Free courses from the U.S. Transhumanist Party. Anyone can read every lesson. Sign in to take the quizzes, keep
            your progress and earn a certificate for each course.
          </p>
        </div>
        <q-input
          v-model="query"
          type="search"
          outlined
          rounded
          clearable
          debounce="150"
          class="course-catalog__search"
          placeholder="Search courses by title or topic"
          aria-label="Search courses"
        >
          <template #prepend><q-icon name="search" /></template>
        </q-input>
      </header>

      <q-banner v-if="!session.user" class="bg-blue-1 text-black q-mb-md" rounded>
        <router-link :to="{ path: '/signin', query: { redirect: '/courses' } }">Sign in</router-link> to see where you stand in each course.
      </q-banner>
      <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded role="alert">{{ error }}</q-banner>

      <template v-if="loading && !map">
        <q-skeleton type="rect" height="280px" class="q-mb-lg" style="border-radius: 20px" />
        <q-skeleton type="rect" height="240px" style="border-radius: 12px" />
      </template>
      <template v-else-if="map">
        <section v-if="searching" aria-labelledby="course-results-heading">
          <h2 id="course-results-heading" class="text-h6 q-mt-none q-mb-xs">Search results</h2>
          <p class="text-body2 q-mb-md" role="status">
            {{ results.length ? `${results.length} ${results.length === 1 ? 'course matches' : 'courses match'}` : 'No course matches' }}
            “{{ typed }}”.
          </p>
          <div v-if="results.length" class="course-grid">
            <CourseRow v-for="course in results" :key="course.courseId" :course="course" :status="status(course)" :titles="titles" />
          </div>
          <q-btn v-else flat no-caps color="primary" icon="close" label="Clear the search" @click="query = ''" />
        </section>

        <template v-else>
          <CourseCarousel v-if="slides.length" :slides="slides" :statuses="statuses" @show-map="showMap" />

          <section v-if="panels.length" aria-labelledby="course-panels-heading" class="course-catalog__section">
            <h2 id="course-panels-heading" class="text-h6 q-mt-none q-mb-md">Find your next course</h2>
            <div class="course-panels">
              <section v-for="panel in panels" :key="panel.key" class="course-panel" :aria-labelledby="`course-panel-${panel.key}`">
                <h3 :id="`course-panel-${panel.key}`" class="course-panel__title">
                  <q-icon :name="panel.icon" size="20px" />{{ panel.title }}
                  <span class="course-panel__count">{{ panel.courses.length }}</span>
                </h3>
                <div class="course-panel__rows">
                  <CourseRow v-for="course in shown(panel)" :key="course.courseId" :course="course" :status="status(course)" :titles="titles" />
                </div>
                <q-btn
                  v-if="panel.courses.length > PANEL_ROWS"
                  flat
                  dense
                  no-caps
                  color="primary"
                  class="q-mt-sm"
                  :icon-right="expanded.has(panel.key) ? 'expand_less' : 'expand_more'"
                  :label="expanded.has(panel.key) ? 'Show fewer' : `Show all ${panel.courses.length}`"
                  :aria-expanded="expanded.has(panel.key) ? 'true' : 'false'"
                  :aria-label="expanded.has(panel.key) ? `Show fewer: ${panel.title}` : `Show all ${panel.courses.length}: ${panel.title}`"
                  @click="toggle(panel.key)"
                />
              </section>
            </div>
          </section>

          <section ref="everyCourse" aria-labelledby="every-course-heading" class="course-catalog__section">
            <h2 id="every-course-heading" class="text-h6 q-mt-none q-mb-sm">Every course</h2>
            <q-tabs v-model="view" no-caps inline-label align="left" class="text-primary" active-class="text-weight-bold">
              <q-tab name="list" icon="view_list" label="All courses" />
              <q-tab v-if="onMap.length" name="map" icon="account_tree" label="Course map" />
            </q-tabs>
            <q-separator class="q-mb-md" />
            <div v-if="view === 'list'" class="course-grid">
              <CourseRow v-for="course in map.courses" :key="course.courseId" :course="course" :status="status(course)" :titles="titles" />
            </div>
            <template v-else>
              <p class="text-body2">A line joins a course to the ones after it, whose quizzes open once you have passed it.</p>
              <CourseMapView :courses="map.courses" label="Course map: each course, joined by lines to the courses after it">
                <template #card="{ course }">
                  <router-link
                    v-if="course.published"
                    :to="`/course/${course.courseId}`"
                    class="course-card"
                    :class="cardClass(course)"
                    :aria-label="describe(course)"
                  >
                    <span class="course-card__title">{{ course.title }}</span>
                    <span class="course-card__status"><q-icon :name="icon(course)" size="16px" />{{ statusText(status(course), true, titles, { onMap: true }) }}</span>
                  </router-link>
                  <div v-else class="course-card course-card--soon" role="img" :aria-label="describe(course)">
                    <span class="course-card__title">{{ course.title }}</span>
                    <span class="course-card__status"><q-icon name="schedule" size="16px" />Coming soon</span>
                  </div>
                </template>
              </CourseMapView>
            </template>
          </section>
        </template>
      </template>
    </div>
  </PageShell>
</template>
