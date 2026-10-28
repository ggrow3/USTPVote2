<script setup lang="ts">
import { reactive, ref } from 'vue';
import {
  FUTURIST_CATEGORIES,
  type CourseLesson,
  type CourseRecord,
  type FuturistCategory,
  type FuturistProfile,
} from 'ustp-domain';
import { api, errorMessage } from '../../api.js';
import { attempt } from '../../dialogs.js';

const COURSE_ID = 'transhumanism';
const course = ref<CourseRecord | null>(null);
const lessons = ref<readonly CourseLesson[]>([]);
const profiles = ref<readonly FuturistProfile[]>([]);
const loading = ref(false);
const publishing = ref(false);
const lessonOpen = ref(false);
const profileOpen = ref(false);
const categoryOptions = FUTURIST_CATEGORIES.map((value) => ({ value, label: value.replaceAll('_', ' ') }));

type QuestionEditor = { questionId: string; prompt: string; choices: string[]; correctIndex: number; explanation: string };
const lesson = reactive({
  lessonId: undefined as string | undefined,
  order: 1,
  title: '',
  summary: '',
  body: '',
  estimatedMinutes: 10,
  questions: [] as QuestionEditor[],
});
const profile = reactive({
  profileId: undefined as string | undefined,
  order: 1,
  name: '',
  category: 'democratic_transhumanist' as FuturistCategory,
  biography: '',
  ideasText: '',
  quote: '',
  quoteSource: '',
  quoteUrl: '',
  portraitUrl: '',
  portraitAlt: '',
  portraitCredit: '',
  portraitLicense: '',
  portraitSourceUrl: '',
  furtherReadingUrl: '',
});

function blankQuestions(): QuestionEditor[] {
  return Array.from({ length: 5 }, (_, i) => ({
    questionId: `q${i + 1}`,
    prompt: '',
    choices: ['', '', '', ''],
    correctIndex: 0,
    explanation: '',
  }));
}

async function load() {
  loading.value = true;
  try {
    const content = await api<{ course: CourseRecord; lessons: CourseLesson[]; profiles: FuturistProfile[] }>('GET', `/v1/admin/courses/${COURSE_ID}`);
    course.value = content.course;
    lessons.value = content.lessons;
    profiles.value = content.profiles;
  } finally {
    loading.value = false;
  }
}

function editLesson(value?: CourseLesson) {
  Object.assign(lesson, value
    ? { ...value, questions: value.questions.map((q) => ({ ...q, choices: [...q.choices] })) }
    : { lessonId: undefined, order: lessons.value.length + 1, title: '', summary: '', body: '', estimatedMinutes: 10, questions: blankQuestions() });
  lessonOpen.value = true;
}

function editProfile(value?: FuturistProfile) {
  Object.assign(profile, value
    ? {
        ...value,
        ideasText: value.ideas.join('\n'),
        portraitUrl: value.portraitUrl ?? '',
        portraitCredit: value.portraitCredit ?? '',
        portraitLicense: value.portraitLicense ?? '',
        portraitSourceUrl: value.portraitSourceUrl ?? '',
      }
    : {
        profileId: undefined, order: profiles.value.length + 1, name: '', category: 'democratic_transhumanist', biography: '', ideasText: '', quote: '', quoteSource: '', quoteUrl: '', portraitUrl: '', portraitAlt: '', portraitCredit: '', portraitLicense: '', portraitSourceUrl: '', furtherReadingUrl: '',
      });
  profileOpen.value = true;
}

async function saveCourse() {
  if (!course.value) return;
  if (await attempt(() => api('PUT', `/v1/admin/courses/${COURSE_ID}`, { title: course.value!.title, summary: course.value!.summary }), 'Course draft saved')) await load();
}

async function saveLesson() {
  const payload = {
    lessonId: lesson.lessonId,
    order: Number(lesson.order),
    title: lesson.title,
    summary: lesson.summary,
    body: lesson.body,
    estimatedMinutes: Number(lesson.estimatedMinutes),
    questions: lesson.questions,
  };
  if (await attempt(() => api('POST', `/v1/admin/courses/${COURSE_ID}/lessons`, payload), 'Lesson draft saved')) {
    lessonOpen.value = false;
    await load();
  }
}

async function saveProfile() {
  const payload = {
    profileId: profile.profileId,
    order: Number(profile.order),
    name: profile.name,
    category: profile.category,
    biography: profile.biography,
    ideas: profile.ideasText.split('\n').map((idea) => idea.trim()).filter(Boolean),
    quote: profile.quote,
    quoteSource: profile.quoteSource,
    quoteUrl: profile.quoteUrl,
    portraitUrl: profile.portraitUrl || null,
    portraitAlt: profile.portraitAlt,
    portraitCredit: profile.portraitCredit || null,
    portraitLicense: profile.portraitLicense || null,
    portraitSourceUrl: profile.portraitSourceUrl || null,
    furtherReadingUrl: profile.furtherReadingUrl,
  };
  if (await attempt(() => api('POST', `/v1/admin/courses/${COURSE_ID}/profiles`, payload), 'Profile draft saved')) {
    profileOpen.value = false;
    await load();
  }
}

async function remove(kind: 'lessons' | 'profiles', id: string) {
  if (!window.confirm('Delete this draft item? Existing published course versions remain unchanged.')) return;
  if (await attempt(() => api('DELETE', `/v1/admin/courses/${COURSE_ID}/${kind}/${id}`), 'Draft item deleted')) await load();
}

async function publish() {
  publishing.value = true;
  try {
    if (await attempt(() => api('POST', `/v1/admin/courses/${COURSE_ID}/publish`), 'Published a new immutable course version')) await load();
  } finally {
    publishing.value = false;
  }
}

void load().catch((e: unknown) => console.error(errorMessage(e)));
</script>

<template>
  <div style="max-width: 1000px">
    <p class="text-grey-7">Course Administrators edit a draft. Publishing freezes a new public version; learners already completing an earlier version retain its content and progress.</p>
    <q-skeleton v-if="loading && !course" type="rect" height="200px" />
    <template v-else-if="course">
      <q-card flat bordered class="q-mb-lg">
        <q-card-section>
          <div class="row items-center justify-between q-gutter-sm">
            <h2 class="text-h6 q-my-none">Course settings</h2>
            <q-badge :color="course.status === 'published' ? 'positive' : 'orange'" :label="course.status" />
          </div>
          <q-input v-model="course.title" outlined class="q-mt-md" label="Course title" />
          <q-input v-model="course.summary" outlined type="textarea" autogrow class="q-mt-sm" label="Public summary" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Save draft" @click="saveCourse" />
          <q-btn color="primary" no-caps label="Publish new version" :loading="publishing" @click="publish" />
        </q-card-actions>
      </q-card>

      <q-card flat bordered class="q-mb-lg">
        <q-card-section class="row items-center justify-between">
          <h2 class="text-h6 q-my-none">Lessons and quizzes</h2>
          <q-btn color="primary" flat no-caps icon="add" label="New lesson" @click="editLesson()" />
        </q-card-section>
        <q-list separator>
          <q-item v-for="item in lessons" :key="item.lessonId">
            <q-item-section>
              <q-item-label>Lesson {{ item.order }} · {{ item.title }}</q-item-label>
              <q-item-label caption>{{ item.questions.length }} questions · {{ item.estimatedMinutes }} minutes</q-item-label>
            </q-item-section>
            <q-item-section side class="row q-gutter-xs">
              <q-btn flat dense no-caps label="Edit" @click="editLesson(item)" />
              <q-btn flat dense color="negative" no-caps label="Delete" @click="remove('lessons', item.lessonId)" />
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>

      <q-card flat bordered>
        <q-card-section class="row items-center justify-between">
          <h2 class="text-h6 q-my-none">Futurist profiles and credits</h2>
          <q-btn color="primary" flat no-caps icon="add" label="New profile" @click="editProfile()" />
        </q-card-section>
        <q-list separator>
          <q-item v-for="item in profiles" :key="item.profileId">
            <q-item-section>
              <q-item-label>{{ item.order }} · {{ item.name }}</q-item-label>
              <q-item-label caption>{{ item.category.replaceAll('_', ' ') }} · {{ item.portraitLicense ?? 'portrait still needed' }}</q-item-label>
            </q-item-section>
            <q-item-section side class="row q-gutter-xs">
              <q-btn flat dense no-caps label="Edit" @click="editProfile(item)" />
              <q-btn flat dense color="negative" no-caps label="Delete" @click="remove('profiles', item.profileId)" />
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>
    </template>

    <q-dialog v-model="lessonOpen" maximized>
      <q-card>
        <q-bar><div class="text-weight-medium">{{ lesson.lessonId ? 'Edit lesson' : 'New lesson' }}</div><q-space /><q-btn v-close-popup dense flat icon="close" aria-label="Close" /></q-bar>
        <q-card-section class="q-gutter-md" style="max-width: 920px; margin: auto">
          <div class="row q-col-gutter-md"><q-input v-model.number="lesson.order" type="number" outlined class="col-12 col-sm-3" label="Order" /><q-input v-model.number="lesson.estimatedMinutes" type="number" outlined class="col-12 col-sm-3" label="Minutes" /><q-input v-model="lesson.title" outlined class="col-12 col-sm-6" label="Title" /></div>
          <q-input v-model="lesson.summary" outlined type="textarea" autogrow label="Summary" />
          <q-input v-model="lesson.body" outlined type="textarea" autogrow label="Lesson text (separate paragraphs with a blank line)" />
          <h3 class="text-h6">Five-question quiz</h3>
          <q-card v-for="(question, index) in lesson.questions" :key="index" flat bordered class="q-pa-md">
            <q-input v-model="question.questionId" outlined dense label="Question ID" class="q-mb-sm" />
            <q-input v-model="question.prompt" outlined type="textarea" autogrow :label="`Question ${index + 1}`" class="q-mb-sm" />
            <q-input v-for="(_, choiceIndex) in question.choices" :key="choiceIndex" v-model="question.choices[choiceIndex]" outlined dense :label="`Choice ${choiceIndex + 1}`" class="q-mb-sm" />
            <q-select v-model="question.correctIndex" outlined dense emit-value map-options :options="[0, 1, 2, 3].map((value) => ({ value, label: `Correct choice ${value + 1}` }))" label="Correct answer" class="q-mb-sm" />
            <q-input v-model="question.explanation" outlined type="textarea" autogrow label="Explanation shown in the course material" />
          </q-card>
        </q-card-section>
        <q-card-actions align="right" class="q-pa-md"><q-btn v-close-popup flat no-caps label="Cancel" /><q-btn color="primary" no-caps label="Save lesson" @click="saveLesson" /></q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="profileOpen" maximized>
      <q-card>
        <q-bar><div class="text-weight-medium">{{ profile.profileId ? 'Edit profile' : 'New profile' }}</div><q-space /><q-btn v-close-popup dense flat icon="close" aria-label="Close" /></q-bar>
        <q-card-section class="q-gutter-md" style="max-width: 920px; margin: auto">
          <div class="row q-col-gutter-md"><q-input v-model.number="profile.order" type="number" outlined class="col-12 col-sm-3" label="Order" /><q-input v-model="profile.name" outlined class="col-12 col-sm-5" label="Name" /><q-select v-model="profile.category" outlined emit-value map-options :options="categoryOptions" class="col-12 col-sm-4" label="Category" /></div>
          <q-input v-model="profile.biography" outlined type="textarea" autogrow label="Short biography" />
          <q-input v-model="profile.ideasText" outlined type="textarea" autogrow label="Key ideas (one per line)" />
          <q-input v-model="profile.quote" outlined type="textarea" autogrow label="Quoted passage" />
          <div class="row q-col-gutter-md"><q-input v-model="profile.quoteSource" outlined class="col-12 col-sm-4" label="Quote source" /><q-input v-model="profile.quoteUrl" outlined class="col-12 col-sm-8" label="Quote source URL" /></div>
          <q-separator /><h3 class="text-h6 q-mb-none">Portrait attribution</h3>
          <q-input v-model="profile.portraitUrl" outlined label="Open-licence portrait image URL" /><q-input v-model="profile.portraitAlt" outlined label="Portrait alt text" />
          <div class="row q-col-gutter-md"><q-input v-model="profile.portraitCredit" outlined class="col-12 col-sm-6" label="Image credit" /><q-input v-model="profile.portraitLicense" outlined class="col-12 col-sm-6" label="Image licence" /></div>
          <q-input v-model="profile.portraitSourceUrl" outlined label="Image source URL" /><q-input v-model="profile.furtherReadingUrl" outlined label="Further reading URL" />
        </q-card-section>
        <q-card-actions align="right" class="q-pa-md"><q-btn v-close-popup flat no-caps label="Cancel" /><q-btn color="primary" no-caps label="Save profile" @click="saveProfile" /></q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

