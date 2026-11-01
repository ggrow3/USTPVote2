<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { LearnerCourseStatus } from 'ustp-domain';
import CourseArt from './CourseArt.vue';
import { courseArt, SOON_ART, type HeroSlide } from './course-catalog.js';

/**
 * The featured courses at the top of the Courses page (design §10.8): large cards, dark and light in turn, that
 * scroll sideways (two at a time on a wide screen, one on a phone), with arrows and dots for where you are. It never
 * moves by itself. A dot stands for each place the row can stop, so the last dots cover the last cards together.
 */
const props = defineProps<{
  slides: readonly HeroSlide[];
  statuses: ReadonlyMap<string, LearnerCourseStatus>;
}>();
const emit = defineEmits<{ showMap: [] }>();

const track = ref<HTMLElement | null>(null);
/** Where the row can stop: each card's left edge, until the last cards fit together. */
const stops = ref<number[]>([0]);
const current = ref(0);
let observer: ResizeObserver | null = null;

function measure() {
  const el = track.value;
  if (!el) return;
  const end = el.scrollWidth - el.clientWidth;
  const edges = Array.from(el.children as HTMLCollectionOf<HTMLElement>).map((card) => Math.min(card.offsetLeft, end));
  stops.value = edges.filter((edge, i) => i === 0 || edge > edges[i - 1]! + 1);
  onScroll();
}

function onScroll() {
  const left = track.value?.scrollLeft ?? 0;
  current.value = stops.value.reduce((best, stop, i) => (Math.abs(stop - left) < Math.abs(stops.value[best]! - left) ? i : best), 0);
}

function go(index: number) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  track.value?.scrollTo({ left: stops.value[index] ?? 0, behavior: reduce ? 'auto' : 'smooth' });
  current.value = index;
}

const pitch = (slide: Extract<HeroSlide, { kind: 'course' }>) =>
  slide.course.summary ?? `${slide.course.lessonCount} ${slide.course.lessonCount === 1 ? 'lesson' : 'lessons'}, free to read.`;
const progress = (courseId: string) => {
  const status = props.statuses.get(courseId);
  return status?.state === 'in_progress' ? `${status.lessonsPassed} of ${status.lessonCount} lessons passed` : null;
};
const soonText = (slide: Extract<HeroSlide, { kind: 'soon' }>) => {
  const named = slide.titles.slice(0, 2);
  const rest = slide.count - named.length;
  return `Being written now: ${named.join(rest ? ', ' : ' and ')}${rest ? ` and ${rest} more` : ''}.`;
};
const artStyle = (slide: HeroSlide) => {
  const art = slide.kind === 'course' ? courseArt(slide.course.courseId) : SOON_ART;
  return { '--art-from': art.from, '--art-to': art.to };
};

onMounted(() => {
  measure();
  observer = new ResizeObserver(measure);
  if (track.value) observer.observe(track.value);
});
onBeforeUnmount(() => observer?.disconnect());
watch(
  () => props.slides,
  () => void nextTick(measure),
);
</script>

<template>
  <section class="course-hero" aria-roledescription="carousel" aria-label="Featured courses">
    <div ref="track" class="course-hero__track" @scroll.passive="onScroll">
      <article
        v-for="(slide, i) in slides"
        :key="slide.kind === 'course' ? slide.course.courseId : 'soon'"
        class="course-hero__card"
        :class="i % 2 === 0 ? 'course-hero__card--dark' : 'course-hero__card--light'"
        :style="artStyle(slide)"
        aria-roledescription="slide"
        :aria-label="`${i + 1} of ${slides.length}`"
      >
        <template v-if="slide.kind === 'course'">
          <div class="course-hero__text">
            <span class="course-hero__eyebrow">{{ slide.eyebrow }}</span>
            <h3 class="course-hero__title">{{ slide.course.title }}</h3>
            <p class="course-hero__pitch">{{ pitch(slide) }}</p>
            <p v-if="progress(slide.course.courseId)" class="course-hero__progress">{{ progress(slide.course.courseId) }}</p>
            <q-btn
              unelevated
              no-caps
              class="course-hero__action"
              :to="`/course/${slide.course.courseId}`"
              :aria-label="`${slide.action}: ${slide.course.title}`"
              icon-right="arrow_forward"
              :label="slide.action"
            />
          </div>
          <CourseArt :course-id="slide.course.courseId" class="course-hero__art" />
        </template>
        <template v-else>
          <div class="course-hero__text">
            <span class="course-hero__eyebrow">Coming soon</span>
            <h3 class="course-hero__title">{{ slide.count }} more {{ slide.count === 1 ? 'course' : 'courses' }} on the way</h3>
            <p class="course-hero__pitch">{{ soonText(slide) }}</p>
            <q-btn unelevated no-caps class="course-hero__action" icon-right="account_tree" label="See the course map" @click="emit('showMap')" />
          </div>
          <div class="course-art course-hero__art" aria-hidden="true"><q-icon :name="SOON_ART.icon" class="course-art__icon" /></div>
        </template>
      </article>
    </div>
    <template v-if="stops.length > 1">
      <q-btn
        v-if="current > 0"
        round
        unelevated
        icon="chevron_left"
        class="course-hero__arrow course-hero__arrow--prev"
        aria-label="Previous featured courses"
        @click="go(current - 1)"
      />
      <q-btn
        v-if="current < stops.length - 1"
        round
        unelevated
        icon="chevron_right"
        class="course-hero__arrow course-hero__arrow--next"
        aria-label="Next featured courses"
        @click="go(current + 1)"
      />
      <div class="course-hero__dots">
        <button
          v-for="(_, i) in stops"
          :key="i"
          type="button"
          class="course-hero__dot"
          :class="{ 'course-hero__dot--current': i === current }"
          :aria-label="`Featured courses, part ${i + 1} of ${stops.length}`"
          :aria-current="i === current ? 'true' : undefined"
          @click="go(i)"
        />
      </div>
    </template>
  </section>
</template>
