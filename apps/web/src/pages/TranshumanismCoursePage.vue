<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CourseCatalog, FuturistCategory, LearnerCourseView, PublicCourseLesson } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api, apiBlob, errorMessage } from '../api.js';
import { session } from '../session.js';

const COURSE_ID = 'transhumanism';
const catalog = ref<CourseCatalog | null>(null);
const learner = ref<LearnerCourseView | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);
const submitting = ref(false);
const selectedId = ref<string | null>(null);
const answers = ref<Record<string, number>>({});
const result = ref<{ lessonId: string; score: number; passed: boolean; certificate: LearnerCourseView['certificate'] } | null>(null);
const hiddenPortraits = ref(new Set<string>());

usePageTitle('Transhumanism course');

const current = computed<PublicCourseLesson | null>(() => catalog.value?.lessons.find((l) => l.lessonId === selectedId.value) ?? catalog.value?.lessons[0] ?? null);
const progress = computed(() => learner.value?.progress ?? null);
const categoryLabel: Record<FuturistCategory, string> = {
  democratic_transhumanist: 'Democratic transhumanist',
  transhumanist_pioneer: 'Transhumanist pioneer',
  ethical_technology_thinker: 'Ethical technology thinker',
  foundational_visionary: 'Foundational visionary',
};

async function load() {
  loading.value = true;
  error.value = null;
  result.value = null;
  try {
    if (session.user) {
      learner.value = await api<LearnerCourseView>('GET', `/v1/courses/${COURSE_ID}`);
      catalog.value = learner.value;
    } else {
      learner.value = null;
      catalog.value = await api<CourseCatalog>('GET', `/v1/public/courses/${COURSE_ID}`);
    }
    selectedId.value ??= catalog.value.lessons[0]?.lessonId ?? null;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

function openLesson(lessonId: string) {
  selectedId.value = lessonId;
  answers.value = {};
  result.value = null;
  document.querySelector('#course-lesson')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function submit() {
  if (!current.value || !session.user || current.value.questions.some((q) => answers.value[q.questionId] === undefined)) return;
  submitting.value = true;
  try {
    const response = await api<{ attempt: { score: number; passed: boolean }; certificate: LearnerCourseView['certificate'] }>(
      'POST',
      `/v1/courses/${COURSE_ID}/lessons/${current.value.lessonId}/attempts`,
      { answers: current.value.questions.map((q) => answers.value[q.questionId]) },
    );
    result.value = { lessonId: current.value.lessonId, score: response.attempt.score, passed: response.attempt.passed, certificate: response.certificate };
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    submitting.value = false;
  }
}

async function downloadCertificate() {
  try {
    const blob = await apiBlob(`/v1/courses/${COURSE_ID}/certificate.pdf`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'transhumanism-certificate.pdf';
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function hidePortrait(profileId: string) {
  hiddenPortraits.value = new Set([...hiddenPortraits.value, profileId]);
}

watch(() => session.user?.uid, load, { immediate: true });
</script>

<template>
  <q-page padding>
    <div style="max-width: 1100px; margin: auto">
      <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>{{ error }}</q-banner>
      <q-skeleton v-if="loading" type="rect" height="360px" />
      <template v-else-if="catalog">
        <section class="course-hero q-pa-lg q-mb-lg rounded-borders">
          <div class="text-overline">PUBLIC LEARNING SERIES</div>
          <h1 class="text-h3 q-mt-xs q-mb-sm">{{ catalog.course.title }}</h1>
          <p class="text-body1 q-mb-md">{{ catalog.course.summary }}</p>
          <q-chip color="white" text-color="primary" icon="public">Lessons are open to everyone</q-chip>
          <q-chip color="white" text-color="primary" icon="workspace_premium">Sign in to save progress and earn a certificate</q-chip>
        </section>

        <q-banner v-if="!session.user" class="bg-blue-1 text-black q-mb-lg" rounded>
          You can read every lesson and explore the directory. <router-link :to="{ path: '/signin', query: { redirect: '/course/transhumanism' } }">Sign in</router-link> to take quizzes, save progress, and earn a named certificate.
        </q-banner>
        <q-banner v-else-if="progress" class="bg-green-1 text-black q-mb-lg" rounded>
          {{ progress.completedLessonIds.length }} of {{ catalog.lessons.length }} lessons passed at 80% or above.
          <q-btn v-if="learner?.certificate" flat dense no-caps class="q-ml-sm" icon="download" label="Download certificate" @click="downloadCertificate" />
        </q-banner>

        <h2 class="text-h5 q-mb-sm">Lessons</h2>
        <div class="row q-col-gutter-md q-mb-xl">
          <div v-for="lesson in catalog.lessons" :key="lesson.lessonId" class="col-12 col-sm-6 col-md-4">
            <q-card flat bordered class="fit column">
              <q-card-section class="col">
                <div class="text-overline">Lesson {{ lesson.order }} · {{ lesson.estimatedMinutes }} min</div>
                <h3 class="text-h6 q-mt-xs q-mb-sm">{{ lesson.title }}</h3>
                <p class="q-mb-none">{{ lesson.summary }}</p>
              </q-card-section>
              <q-card-actions align="between">
                <q-badge v-if="progress?.completedLessonIds.includes(lesson.lessonId)" color="positive" label="Passed" />
                <span v-else />
                <q-btn color="primary" flat no-caps label="Open lesson" @click="openLesson(lesson.lessonId)" />
              </q-card-actions>
            </q-card>
          </div>
        </div>

        <section v-if="current" id="course-lesson" tabindex="-1" class="q-mb-xl">
          <q-card flat bordered>
            <q-card-section>
              <div class="text-overline">Lesson {{ current.order }}</div>
              <h2 class="text-h4 q-mt-xs">{{ current.title }}</h2>
              <p v-for="paragraph in current.body.split('\n\n')" :key="paragraph" class="text-body1">{{ paragraph }}</p>
            </q-card-section>
            <q-separator />
            <q-card-section>
              <h3 class="text-h6">Lesson quiz</h3>
              <p class="text-grey-7">Five questions. A score of 80% passes; you may retry as often as needed.</p>
              <template v-if="session.user">
                <q-list separator>
                  <q-item v-for="(question, index) in current.questions" :key="question.questionId" class="q-px-none q-py-md">
                    <q-item-section>
                      <q-item-label class="text-weight-medium">{{ index + 1 }}. {{ question.prompt }}</q-item-label>
                      <q-option-group v-model="answers[question.questionId]" :options="question.choices.map((label, value) => ({ label, value }))" type="radio" class="q-mt-sm" />
                    </q-item-section>
                  </q-item>
                </q-list>
                <q-banner v-if="result?.lessonId === current.lessonId" rounded class="q-mt-md" :class="result.passed ? 'bg-green-1 text-black' : 'bg-orange-1 text-black'" role="status">
                  <template v-if="result.passed">Passed with {{ result.score }}%. {{ result.certificate ? 'You have completed the course; your certificate is ready.' : 'Continue to the next lesson.' }}</template>
                  <template v-else>You scored {{ result.score }}%. Review the lesson and try again—there is no retry limit.</template>
                </q-banner>
                <q-btn class="q-mt-md" color="primary" no-caps :disable="current.questions.some((q) => answers[q.questionId] === undefined)" :loading="submitting" label="Submit quiz" @click="submit" />
              </template>
              <q-btn v-else color="primary" no-caps label="Sign in to take this quiz" :to="{ path: '/signin', query: { redirect: '/course/transhumanism' } }" />
            </q-card-section>
          </q-card>
        </section>

        <section aria-labelledby="voices-heading" class="q-mb-xl">
          <h2 id="voices-heading" class="text-h5">Voices, visions, and ethical debate</h2>
          <p class="text-grey-8">Profiles describe each person’s ideas in context. Category labels prevent foundational visionaries and critics from being inaccurately presented as transhumanists.</p>
          <div class="row q-col-gutter-md">
            <div v-for="profile in catalog.profiles" :key="profile.profileId" class="col-12 col-sm-6 col-md-4">
              <q-card flat bordered class="fit column">
                <q-img v-if="profile.portraitUrl && !hiddenPortraits.has(profile.profileId)" :src="profile.portraitUrl" :alt="profile.portraitAlt" ratio="1.65" fit="cover" @error="hidePortrait(profile.profileId)">
                  <div class="absolute-bottom text-caption portrait-credit">{{ profile.portraitCredit }}</div>
                </q-img>
                <div v-else class="portrait-fallback" role="img" :aria-label="`No portrait available for ${profile.name}`">{{ profile.name.charAt(0) }}</div>
                <q-card-section class="col">
                  <q-badge outline color="primary" :label="categoryLabel[profile.category]" class="q-mb-sm" />
                  <h3 class="text-h6 q-mt-none q-mb-xs">{{ profile.name }}</h3>
                  <p>{{ profile.biography }}</p>
                  <div class="text-caption text-grey-8">Key ideas: {{ profile.ideas.join(' · ') }}</div>
                </q-card-section>
                <q-card-section class="q-pt-none">
                  <blockquote class="q-ma-none quote">“{{ profile.quote }}”</blockquote>
                  <a :href="profile.quoteUrl" target="_blank" rel="noopener" class="text-caption">{{ profile.quoteSource }}</a>
                  <div class="q-mt-sm"><a :href="profile.furtherReadingUrl" target="_blank" rel="noopener">Further reading</a></div>
                  <div v-if="profile.portraitSourceUrl" class="q-mt-xs text-caption"><a :href="profile.portraitSourceUrl" target="_blank" rel="noopener">Image source · {{ profile.portraitLicense }}</a></div>
                </q-card-section>
              </q-card>
            </div>
          </div>
        </section>
      </template>
    </div>
  </q-page>
</template>

<style scoped>
.course-hero { background: linear-gradient(125deg, #0b2948, #00695c); color: white; }
.quote { border-left: 3px solid var(--q-secondary); padding-left: 12px; font-style: italic; }
.portrait-credit { background: rgba(0, 0, 0, 0.7); padding: 3px 8px; }
.portrait-fallback { align-items: center; background: linear-gradient(135deg, #d8e9f1, #e9f0d7); color: #0b2948; display: flex; font-size: 4rem; font-weight: 700; height: 190px; justify-content: center; }
</style>

