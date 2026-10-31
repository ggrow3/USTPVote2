<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  coursePortraitSrc,
  PASS_PERCENT,
  type CourseCatalog,
  type CourseConversation as Conversation,
  type CourseQuizFeedback,
  type FuturistCategory,
  type LearnerCourseView,
  type PublicCourseLesson,
} from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api, apiBlob, errorMessage } from '../api.js';
import { attempt } from '../dialogs.js';
import { session } from '../session.js';
import CourseConversation from './CourseConversation.vue';

const route = useRoute();
const courseId = computed(() => String(route.params.courseId));
const catalog = ref<CourseCatalog | null>(null);
const learner = ref<LearnerCourseView | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);
const submitting = ref(false);
const selectedId = ref<string | null>(null);
const answers = ref<Record<string, number>>({});
/** The last quiz submitted, with the answers it was marked on, so feedback hides on a question once its answer changes. */
const result = ref<{
  lessonId: string;
  score: number;
  passed: boolean;
  certificate: LearnerCourseView['certificate'];
  answers: readonly number[];
  feedback: readonly CourseQuizFeedback[];
} | null>(null);
const hiddenPortraits = ref(new Set<string>());
/** The learner's conversation with the instructors; loaded once signed in. */
const conversation = ref<Conversation | null>(null);

usePageTitle(() => catalog.value?.course.title ?? 'Course');

const current = computed<PublicCourseLesson | null>(() => catalog.value?.lessons.find((l) => l.lessonId === selectedId.value) ?? catalog.value?.lessons[0] ?? null);
const progress = computed(() => learner.value?.progress ?? null);
/** Prerequisites the learner has still to pass; until then they read the lessons but cannot take the quizzes. */
const locked = computed(() => learner.value?.missingPrerequisites ?? []);
const signInLink = computed(() => ({ path: '/signin', query: { redirect: `/course/${courseId.value}` } }));
const categoryLabel: Record<FuturistCategory, string> = {
  democratic_transhumanist: 'Democratic transhumanist',
  transhumanist_pioneer: 'Transhumanist pioneer',
  ethical_technology_thinker: 'Ethical technology thinker',
  foundational_visionary: 'Foundational visionary',
};

/** Loads the course; after a quiz, quietly, so the page and the quiz's result stay where they are. */
async function load({ quiet = false } = {}) {
  loading.value = !quiet;
  error.value = null;
  try {
    if (session.user) {
      const [view, messages] = await Promise.all([
        api<LearnerCourseView>('GET', `/v1/courses/${courseId.value}`),
        quiet ? Promise.resolve(conversation.value) : api<Conversation>('GET', `/v1/courses/${courseId.value}/messages`),
      ]);
      learner.value = view;
      catalog.value = view;
      conversation.value = messages;
    } else {
      learner.value = null;
      conversation.value = null;
      catalog.value = await api<CourseCatalog>('GET', `/v1/public/courses/${courseId.value}`);
    }
    selectedId.value ??= catalog.value.lessons[0]?.lessonId ?? null;
  } catch (e) {
    catalog.value = null;
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

function feedbackFor(index: number, questionId: string): CourseQuizFeedback | null {
  const marked = result.value?.lessonId === current.value?.lessonId ? result.value : null;
  if (!marked || marked.answers[index] !== answers.value[questionId]) return null;
  return marked.feedback[index] ?? null;
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
    const lessonId = current.value.lessonId;
    const chosen = current.value.questions.map((q) => answers.value[q.questionId]!);
    const response = await api<{
      attempt: { score: number; passed: boolean };
      certificate: LearnerCourseView['certificate'];
      feedback: CourseQuizFeedback[];
    }>('POST', `/v1/courses/${courseId.value}/lessons/${lessonId}/attempts`, { answers: chosen });
    result.value = {
      lessonId,
      score: response.attempt.score,
      passed: response.attempt.passed,
      certificate: response.certificate,
      answers: chosen,
      feedback: response.feedback,
    };
    await load({ quiet: true });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    submitting.value = false;
  }
}

async function downloadCertificate() {
  try {
    const blob = await apiBlob(`/v1/courses/${courseId.value}/certificate.pdf`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${courseId.value}-certificate.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function hidePortrait(profileId: string) {
  hiddenPortraits.value = new Set([...hiddenPortraits.value, profileId]);
}

/** Writes to the instructors; the answer is the whole conversation, with the new message. */
async function sendMessage(body: string): Promise<boolean> {
  return attempt(async () => {
    conversation.value = await api<Conversation>('POST', `/v1/courses/${courseId.value}/messages`, { body });
  }, 'Message sent');
}

watch(
  [() => session.user?.uid, courseId],
  ([, id], previous) => {
    if (previous && id !== previous[1]) {
      catalog.value = null;
      selectedId.value = null;
      answers.value = {};
    }
    result.value = null;
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <q-page padding>
    <div style="max-width: 1100px; margin: auto">
      <q-btn flat no-caps icon="arrow_back" label="All courses" to="/courses" class="q-mb-sm" />
      <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded role="alert">{{ error }}</q-banner>
      <q-skeleton v-if="loading" type="rect" height="360px" />
      <template v-else-if="catalog">
        <section class="course-hero q-pa-lg q-mb-lg rounded-borders">
          <div class="text-overline">PUBLIC LEARNING SERIES</div>
          <h1 class="text-h3 q-mt-xs q-mb-sm">{{ catalog.course.title }}</h1>
          <p class="text-body1 q-mb-md">{{ catalog.course.summary }}</p>
          <q-chip color="white" text-color="primary" icon="public">Lessons are open to everyone</q-chip>
          <q-chip color="white" text-color="primary" icon="workspace_premium">Sign in to save progress and earn a certificate</q-chip>
          <q-chip v-for="before in catalog.prerequisites" :key="before.courseId" color="white" text-color="primary" icon="route" clickable @click="$router.push(`/course/${before.courseId}`)">
            Comes after {{ before.title }}
          </q-chip>
        </section>

        <q-banner v-if="!session.user" class="bg-blue-1 text-black q-mb-lg" rounded>
          You can read every lesson and explore the directory. <router-link :to="signInLink">Sign in</router-link> to take quizzes, save progress, and earn a named certificate.
        </q-banner>
        <q-banner v-else-if="locked.length" class="bg-orange-1 text-black q-mb-lg" rounded role="status">
          <template #avatar><q-icon name="lock" /></template>
          You can read every lesson. The quizzes open once you have passed
          <template v-for="(before, index) in locked" :key="before.courseId"
            ><template v-if="index"> and </template><router-link :to="`/course/${before.courseId}`">{{ before.title }}</router-link></template
          >.
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
              <p class="text-grey-7">
                {{ current.questions.length === 1 ? 'One question' : `${current.questions.length} questions` }}. A score of {{ PASS_PERCENT }}%
                passes; you may retry as often as needed. After each try you see which answers were right, and why.
              </p>
              <p v-if="session.user && locked.length" class="text-body2 q-mb-none">
                <q-icon name="lock" class="q-mr-xs" />This quiz opens once you have passed {{ locked.map((before) => before.title).join(' and ') }}.
              </p>
              <template v-else-if="session.user">
                <q-list separator>
                  <q-item v-for="(question, index) in current.questions" :key="question.questionId" class="q-px-none q-py-md">
                    <q-item-section>
                      <q-item-label class="text-weight-medium">{{ index + 1 }}. {{ question.prompt }}</q-item-label>
                      <q-option-group v-model="answers[question.questionId]" :options="question.choices.map((label, value) => ({ label, value }))" type="radio" class="q-mt-sm" />
                      <div
                        v-if="feedbackFor(index, question.questionId)"
                        class="quiz-feedback q-mt-sm"
                        :class="feedbackFor(index, question.questionId)!.correct ? 'quiz-feedback--right' : 'quiz-feedback--wrong'"
                      >
                        <q-icon :name="feedbackFor(index, question.questionId)!.correct ? 'check_circle' : 'cancel'" size="20px" aria-hidden="true" />
                        <div>
                          <strong>{{ feedbackFor(index, question.questionId)!.correct ? 'Right.' : 'Not this one.' }}</strong>
                          {{ feedbackFor(index, question.questionId)!.explanation }}
                        </div>
                      </div>
                    </q-item-section>
                  </q-item>
                </q-list>
                <q-banner v-if="result?.lessonId === current.lessonId" rounded class="q-mt-md" :class="result.passed ? 'bg-green-1 text-black' : 'bg-orange-1 text-black'" role="status">
                  <template v-if="result.passed">Passed with {{ result.score }}%. {{ result.certificate ? 'You have completed the course; your certificate is ready.' : 'Continue to the next lesson.' }}</template>
                  <template v-else>You scored {{ result.score }}%. Review the lesson and try again—there is no retry limit.</template>
                </q-banner>
                <q-btn class="q-mt-md" color="primary" no-caps :disable="current.questions.some((q) => answers[q.questionId] === undefined)" :loading="submitting" label="Submit quiz" @click="submit" />
              </template>
              <q-btn v-else color="primary" no-caps label="Sign in to take this quiz" :to="signInLink" />
            </q-card-section>
          </q-card>
        </section>

        <section v-if="session.user && conversation" aria-labelledby="instructor-heading" class="q-mb-xl">
          <q-card flat bordered>
            <q-card-section>
              <h2 id="instructor-heading" class="text-h6 q-mt-none q-mb-xs">Ask the instructor</h2>
              <p class="text-grey-7">Questions about this course go to its instructors, the party's Course Administrators. Only you and they see this conversation.</p>
              <CourseConversation
                :conversation="conversation"
                viewer="learner"
                off-text="Messages with the instructor are off for you in this course. A Course Administrator can turn them on for you."
                :send="sendMessage"
              />
            </q-card-section>
          </q-card>
        </section>

        <section v-if="catalog.profiles.length" aria-labelledby="voices-heading" class="q-mb-xl">
          <h2 id="voices-heading" class="text-h5">Voices, visions, and ethical debate</h2>
          <p class="text-grey-8">Profiles describe each person’s ideas in context. Category labels prevent foundational visionaries and critics from being inaccurately presented as transhumanists.</p>
          <div class="row q-col-gutter-md">
            <div v-for="profile in catalog.profiles" :key="profile.profileId" class="col-12 col-sm-6 col-md-4">
              <q-card flat bordered class="fit column">
                <q-img v-if="coursePortraitSrc(profile) && !hiddenPortraits.has(profile.profileId)" :src="coursePortraitSrc(profile)!" :alt="profile.portraitAlt" ratio="1.65" fit="cover" position="50% 30%" @error="hidePortrait(profile.profileId)">
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
                  <div v-else-if="profile.portraitLicense" class="q-mt-xs text-caption">Image · {{ profile.portraitLicense }}</div>
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
.quiz-feedback { display: flex; gap: 8px; align-items: flex-start; border-radius: 6px; padding: 8px 10px; }
.quiz-feedback--right { background: #e8f5e9; color: #1b5e20; }
.quiz-feedback--wrong { background: #fff3e0; color: #7a3a00; }
.portrait-fallback { align-items: center; background: linear-gradient(135deg, #d8e9f1, #e9f0d7); color: #0b2948; display: flex; font-size: 4rem; font-weight: 700; height: 190px; justify-content: center; }
</style>

