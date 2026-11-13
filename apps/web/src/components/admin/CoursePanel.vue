<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  COURSE_IMAGE,
  coursePortraitSrc,
  FUTURIST_CATEGORIES,
  PASS_PERCENT,
  portraitProblem,
  QUIZ_LIMITS,
  type CourseLesson,
  type CoursePackage,
  type CourseRecord,
  type FuturistCategory,
  type FuturistProfile,
} from 'ustp-domain';
import { api, apiUpload, errorMessage } from '../../api.js';
import { attempt } from '../../dialogs.js';
import { photoFileProblem } from '../../photos.js';
import {
  blankQuestion,
  lessonProblems,
  move,
  profileProblems,
  questionDrafts,
  questionsPayload,
  removeChoice,
  type QuestionDraft,
} from '../../academy/course-editor.js';
import { saveCoursePackage } from '../../academy/course-files.js';
import { videoDraft, videoFromDraft } from '../../video-fields.js';
import VideoField from '../VideoField.vue';
import CourseLearnersCard from './CourseLearnersCard.vue';
import CourseMapCard from './CourseMapCard.vue';

const route = useRoute();
const router = useRouter();
/** Every course, for the map and the picker; the one being edited is in the address (`?course=`), so a reload keeps it. */
const courses = ref<readonly CourseRecord[]>([]);
const courseId = ref(typeof route.query.course === 'string' ? route.query.course : 'transhumanism');
const course = ref<CourseRecord | null>(null);
const lessons = ref<readonly CourseLesson[]>([]);
const profiles = ref<readonly FuturistProfile[]>([]);
const loading = ref(false);
const publishing = ref(false);
const hiding = ref(false);
const opening = ref(false);
const lessonOpen = ref(false);
const profileOpen = ref(false);
const lessonErrors = ref<string[]>([]);
const profileErrors = ref<string[]>([]);
const categoryOptions = FUTURIST_CATEGORIES.map((value) => ({ value, label: value.replaceAll('_', ' ') }));

const lesson = reactive({
  lessonId: undefined as string | undefined,
  order: 1,
  title: '',
  summary: '',
  body: '',
  /** The uploaded video's ID; while there is one, the YouTube link is not used. */
  videoUpload: null as string | null,
  videoLink: '',
  estimatedMinutes: 10,
  questions: [] as QuestionDraft[],
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
  portraitImage: null as string | null,
  portraitUrl: '',
  portraitAlt: '',
  portraitCredit: '',
  portraitLicense: '',
  portraitSourceUrl: '',
  furtherReadingUrl: '',
});

/** Pictures that failed to load, by address, so the list and the editor can say which portraits need fixing. */
const broken = ref(new Set<string>());
const markBroken = (src: string) => (broken.value = new Set([...broken.value, src]));
const brokenCount = computed(() => profiles.value.filter((item) => isBroken(coursePortraitSrc(item))).length);
const isBroken = (src: string | null) => !!src && broken.value.has(src);
const previewSrc = computed(() => coursePortraitSrc({ portraitImage: profile.portraitImage, portraitUrl: profile.portraitUrl.trim() || null }));

function portraitStatus(item: FuturistProfile): { text: string; problem: boolean } {
  if (isBroken(coursePortraitSrc(item))) return { text: "picture doesn't load", problem: true };
  const problem = portraitProblem(item);
  if (problem) return { text: problem, problem: true };
  return { text: `${item.portraitImage ? 'uploaded photo' : 'linked image'} · ${item.portraitLicense}`, problem: false };
}

async function load() {
  loading.value = true;
  try {
    const content = await api<{ course: CourseRecord; lessons: CourseLesson[]; profiles: FuturistProfile[] }>('GET', `/v1/admin/courses/${courseId.value}`);
    course.value = content.course;
    lessons.value = content.lessons;
    profiles.value = content.profiles;
  } finally {
    loading.value = false;
  }
}

/** Reloads the course list, then the chosen course: `select` picks another, such as one just added. */
async function loadCourses(select?: string) {
  courses.value = await api<CourseRecord[]>('GET', '/v1/admin/courses');
  const wanted = select ?? courseId.value;
  const next = courses.value.some((item) => item.courseId === wanted) ? wanted : (courses.value[0]?.courseId ?? 'transhumanism');
  if (next !== courseId.value) courseId.value = next;
  else await load();
}

watch(courseId, (id) => {
  lessonOpen.value = false;
  profileOpen.value = false;
  void router.replace({ query: { ...route.query, course: id } });
  void load().catch((e: unknown) => console.error(errorMessage(e)));
});

/** Deletes the chosen course; only one never published can go (the api says why otherwise). */
async function deleteCourse() {
  if (!course.value || !window.confirm(`Delete “${course.value.title}” and its draft lessons and profiles? This cannot be undone.`)) return;
  if (await attempt(() => api('DELETE', `/v1/admin/courses/${courseId.value}`), 'Course deleted')) await loadCourses();
}

function editLesson(value?: CourseLesson) {
  const video = value?.video ?? null;
  Object.assign(lesson, value
    ? { lessonId: value.lessonId, order: value.order, title: value.title, summary: value.summary, body: value.body, estimatedMinutes: value.estimatedMinutes, questions: questionDrafts(value.questions) }
    : { lessonId: undefined, order: lessons.value.length + 1, title: '', summary: '', body: '', estimatedMinutes: 10, questions: [blankQuestion()] });
  const draft = videoDraft(video);
  Object.assign(lesson, { videoUpload: draft.upload, videoLink: draft.link });
  videoBusy.value = false;
  lessonErrors.value = [];
  lessonOpen.value = true;
}

function editProfile(value?: FuturistProfile) {
  Object.assign(profile, value
    ? {
        ...value,
        ideasText: value.ideas.join('\n'),
        portraitImage: value.portraitImage,
        portraitUrl: value.portraitUrl ?? '',
        portraitCredit: value.portraitCredit ?? '',
        portraitLicense: value.portraitLicense ?? '',
        portraitSourceUrl: value.portraitSourceUrl ?? '',
      }
    : {
        profileId: undefined, order: profiles.value.length + 1, name: '', category: 'democratic_transhumanist', biography: '', ideasText: '', quote: '', quoteSource: '', quoteUrl: '', portraitImage: null, portraitUrl: '', portraitAlt: '', portraitCredit: '', portraitLicense: '', portraitSourceUrl: '', furtherReadingUrl: '',
      });
  profileErrors.value = [];
  profileOpen.value = true;
}

/** What the switch means for this course, in a line under it. */
const hiddenHelp = computed(() => {
  if (!course.value) return '';
  if (!course.value.hidden) return 'Listed on the Courses page for everyone. Turn it off to hide the course there without unpublishing or deleting it.';
  const page =
    course.value.publishedVersion === null
      ? 'It is a draft, so it has no page yet.'
      : `It stays published, and its page still opens at /course/${course.value.courseId} for anyone with the link.`;
  return `Hidden: nobody sees it in the catalogue, the search or the map. ${page}`;
});

/**
 * Hides the course from the Courses page or shows it again, at once (409, in words, while a course shown there comes
 * after it). Only that changes, so edits to the title and summary not saved yet stay in the form.
 */
async function setHidden(hidden: boolean) {
  hiding.value = true;
  try {
    await attempt(async () => {
      const updated = await api<CourseRecord>('PUT', `/v1/admin/courses/${courseId.value}/visibility`, { hidden });
      if (course.value?.courseId === updated.courseId) course.value = { ...course.value, hidden: updated.hidden };
      courses.value = courses.value.map((item) => (item.courseId === updated.courseId ? { ...item, hidden: updated.hidden } : item));
    }, hidden ? 'Hidden from the Courses page' : 'Shown on the Courses page');
  } finally {
    hiding.value = false;
  }
}

/** What the guest switch means for this course, in a line under it (design §10.8, "Open without sign-in"). */
const guestHelp = computed(() => {
  const value = course.value;
  if (!value) return '';
  if (value.prerequisites.length) {
    return value.openToGuests
      ? 'Closed to visitors while it comes after another course, which they cannot have passed. Take it off its prerequisites to open it.'
      : 'Only a course that comes after no other can be opened: visitors cannot have passed the one before it.';
  }
  if (!value.openToGuests) return 'Visitors read the lessons; signing in is needed to take the quizzes.';
  const when = value.publishedVersion === null ? 'Once it is published, anyone' : 'Anyone';
  return `${when} can take its quizzes without signing in; their browser keeps what they pass, which moves into their account, with the certificate, when they join or sign in.`;
});

/** Opens the course's quizzes to visitors or closes them, at once (409, in words, while a course comes before it). */
async function setOpenToGuests(openToGuests: boolean) {
  opening.value = true;
  try {
    await attempt(async () => {
      const updated = await api<CourseRecord>('PUT', `/v1/admin/courses/${courseId.value}/guests`, { openToGuests });
      if (course.value?.courseId === updated.courseId) course.value = { ...course.value, openToGuests: updated.openToGuests };
      courses.value = courses.value.map((item) => (item.courseId === updated.courseId ? { ...item, openToGuests: updated.openToGuests } : item));
    }, openToGuests ? 'Open without signing in' : 'Signing in needed for the quizzes');
  } finally {
    opening.value = false;
  }
}

async function saveCourse() {
  if (!course.value) return;
  if (await attempt(() => api('PUT', `/v1/admin/courses/${courseId.value}`, { title: course.value!.title, summary: course.value!.summary }), 'Course draft saved')) await loadCourses();
}

async function saveLesson() {
  const draft = { ...lesson, order: Number(lesson.order), estimatedMinutes: Number(lesson.estimatedMinutes) };
  lessonErrors.value = lessonProblems(draft);
  if (lessonErrors.value.length) return;
  const payload = {
    lessonId: lesson.lessonId,
    order: draft.order,
    title: lesson.title,
    summary: lesson.summary,
    body: lesson.body,
    video: videoFromDraft({ upload: lesson.videoUpload, link: lesson.videoLink }),
    estimatedMinutes: draft.estimatedMinutes,
    questions: questionsPayload(lesson.questions),
  };
  if (await attempt(() => api('POST', `/v1/admin/courses/${courseId.value}/lessons`, payload), 'Lesson draft saved')) {
    lessonOpen.value = false;
    await load();
  }
}

function addQuestion() {
  lesson.questions.push(blankQuestion());
}

/** While a video is uploading, the lesson waits for it before it can be saved. */
const videoBusy = ref(false);

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
    quoteUrl: profile.quoteUrl.trim(),
    portraitImage: profile.portraitImage,
    portraitUrl: profile.portraitImage ? null : profile.portraitUrl.trim() || null,
    portraitAlt: profile.portraitAlt.trim(),
    portraitCredit: profile.portraitCredit.trim() || null,
    portraitLicense: profile.portraitLicense.trim() || null,
    portraitSourceUrl: profile.portraitSourceUrl.trim() || null,
    furtherReadingUrl: profile.furtherReadingUrl.trim(),
  };
  profileErrors.value = profileProblems(payload);
  if (profileErrors.value.length) return;
  if (await attempt(() => api('POST', `/v1/admin/courses/${courseId.value}/profiles`, payload), 'Profile draft saved')) {
    profileOpen.value = false;
    await load();
  }
}

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

/** Uploads the chosen photo; it replaces any image link, and shows once the profile is saved and the course published. */
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file) return;
  const problem = photoFileProblem(file);
  if (problem) {
    profileErrors.value = [problem];
    return;
  }
  uploading.value = true;
  await attempt(async () => {
    profile.portraitImage = (await apiUpload<{ image: string }>(`/v1/admin/courses/${courseId.value}/images`, file)).image;
    profile.portraitUrl = '';
    profileErrors.value = [];
  }, 'Photo uploaded. Save the profile, then publish, to show it.');
  uploading.value = false;
}

async function remove(kind: 'lessons' | 'profiles', id: string) {
  if (!window.confirm('Delete this draft item? Existing published course versions remain unchanged.')) return;
  if (await attempt(() => api('DELETE', `/v1/admin/courses/${courseId.value}/${kind}/${id}`), 'Draft item deleted')) await load();
}

/** Saves the course as a `ustp.course` JSON file: the draft as saved (not unsaved edits here), or a published version. */
async function exportCourse(version: number | 'draft') {
  await attempt(async () => {
    saveCoursePackage(await api<CoursePackage>('GET', `/v1/admin/courses/${courseId.value}/package?version=${version}`));
  }, 'Course exported');
}

async function publish() {
  publishing.value = true;
  try {
    if (await attempt(() => api('POST', `/v1/admin/courses/${courseId.value}/publish`), 'Published a new immutable course version')) await loadCourses();
  } finally {
    publishing.value = false;
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

void loadCourses().catch((e: unknown) => console.error(errorMessage(e)));
</script>

<template>
  <div style="max-width: 1000px">
    <p class="text-grey-7">Course Administrators edit a draft. Publishing freezes a new public version; learners already completing an earlier version retain its content and progress.</p>
    <CourseMapCard v-if="courses.length" :courses="courses" :course-id="courseId" @select="(id) => (courseId = id)" @changed="(id) => loadCourses(id)" />
    <q-skeleton v-if="loading && !course" type="rect" height="200px" />
    <template v-else-if="course">
      <q-card flat bordered class="q-mb-lg">
        <q-card-section>
          <div class="row items-center justify-between q-gutter-sm">
            <h2 class="text-h6 q-my-none">Course settings · {{ course.title }}</h2>
            <div class="row items-center q-gutter-xs">
              <q-badge v-if="course.hidden" color="grey-8"><q-icon name="visibility_off" size="14px" class="q-mr-xs" />hidden</q-badge>
              <q-badge :color="course.status === 'published' ? 'positive' : 'orange'" :label="course.status" />
            </div>
          </div>
          <q-input v-model="course.title" outlined class="q-mt-md" label="Course title" />
          <q-input v-model="course.summary" outlined type="textarea" autogrow class="q-mt-sm" label="Public summary" />
          <q-toggle
            :model-value="!course.hidden"
            :disable="hiding"
            class="q-mt-sm"
            label="Show on the Courses page"
            @update:model-value="(shown: boolean) => setHidden(!shown)"
          />
          <div class="text-caption text-grey-7 q-ml-sm">{{ hiddenHelp }} Applies at once.</div>
          <q-toggle
            :model-value="course.openToGuests === true"
            :disable="opening || (!course.openToGuests && course.prerequisites.length > 0)"
            class="q-mt-sm"
            label="Open without sign-in"
            @update:model-value="(open: boolean) => setOpenToGuests(open)"
          />
          <div class="text-caption text-grey-7 q-ml-sm">{{ guestHelp }} Applies at once.</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn-dropdown flat no-caps icon="download" label="Export JSON">
            <q-list>
              <q-item v-close-popup clickable @click="exportCourse('draft')">
                <q-item-section>
                  <q-item-label>Current draft</q-item-label>
                  <q-item-label caption>As last saved, with quiz answers</q-item-label>
                </q-item-section>
              </q-item>
              <q-item v-if="course.publishedVersion" v-close-popup clickable @click="exportCourse(course.publishedVersion)">
                <q-item-section>
                  <q-item-label>Published version {{ course.publishedVersion }}</q-item-label>
                  <q-item-label caption>What learners take now, with quiz answers</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
          <q-btn v-if="course.publishedVersion === null" flat no-caps color="negative" label="Delete course" @click="deleteCourse" />
          <q-btn flat no-caps label="Save draft" @click="saveCourse" />
          <q-btn color="primary" no-caps label="Publish new version" :loading="publishing" @click="publish" />
        </q-card-actions>
      </q-card>

      <CourseLearnersCard v-if="course.publishedVersion !== null" :course-id="courseId" />
      <q-banner v-else class="bg-blue-1 text-black q-mb-lg" rounded>
        This course has not been published, so it has no students yet. Once it is, they are listed here with how they stand,
        and you turn their messages with the instructors on or off.
      </q-banner>

      <q-card flat bordered class="q-mb-lg">
        <q-card-section class="row items-center justify-between">
          <h2 class="text-h6 q-my-none">Lessons and quizzes</h2>
          <q-btn color="primary" flat no-caps icon="add" label="New lesson" @click="editLesson()" />
        </q-card-section>
        <q-list separator>
          <q-item v-for="item in lessons" :key="item.lessonId">
            <q-item-section>
              <q-item-label>Lesson {{ item.order }} · {{ item.title }}</q-item-label>
              <q-item-label caption>{{ plural(item.questions.length, 'question') }} · {{ item.estimatedMinutes }} minutes</q-item-label>
            </q-item-section>
            <q-item-section side class="row q-gutter-xs">
              <q-btn flat dense no-caps label="Edit" :aria-label="`Edit lesson ${item.order} and its quiz`" @click="editLesson(item)" />
              <q-btn flat dense color="negative" no-caps label="Delete" :aria-label="`Delete lesson ${item.order}`" @click="remove('lessons', item.lessonId)" />
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>

      <q-card flat bordered>
        <q-card-section class="row items-center justify-between">
          <h2 class="text-h6 q-my-none">Futurist profiles and portraits</h2>
          <q-btn color="primary" flat no-caps icon="add" label="New profile" @click="editProfile()" />
        </q-card-section>
        <q-banner v-if="brokenCount" class="bg-orange-1 text-black q-mx-md q-mb-sm" rounded role="status">
          {{ brokenCount === 1 ? "1 portrait doesn't load" : `${brokenCount} portraits don't load` }}. Edit the profile to upload a
          photo or fix its link, then publish a new version.
        </q-banner>
        <q-list separator>
          <q-item v-for="item in profiles" :key="item.profileId">
            <q-item-section avatar>
              <q-avatar rounded size="48px" class="course-thumb">
                <img v-if="coursePortraitSrc(item) && !isBroken(coursePortraitSrc(item))" :src="coursePortraitSrc(item)!" alt="" @error="markBroken(coursePortraitSrc(item)!)" />
                <span v-else aria-hidden="true">{{ item.name.charAt(0) }}</span>
              </q-avatar>
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ item.order }} · {{ item.name }}</q-item-label>
              <q-item-label caption>
                {{ item.category.replaceAll('_', ' ') }} ·
                <span :class="{ 'text-negative text-weight-medium': portraitStatus(item).problem }">{{ portraitStatus(item).text }}</span>
              </q-item-label>
            </q-item-section>
            <q-item-section side class="row q-gutter-xs">
              <q-btn flat dense no-caps label="Edit" :aria-label="`Edit ${item.name}'s profile and portrait`" @click="editProfile(item)" />
              <q-btn flat dense color="negative" no-caps label="Delete" :aria-label="`Delete ${item.name}'s profile`" @click="remove('profiles', item.profileId)" />
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>
    </template>

    <q-dialog v-model="lessonOpen" maximized>
      <q-card>
        <q-bar><div class="text-weight-medium">{{ lesson.lessonId ? 'Edit lesson' : 'New lesson' }}</div><q-space /><q-btn v-close-popup dense flat icon="close" aria-label="Close" /></q-bar>
        <q-card-section class="course-form">
          <div class="row q-col-gutter-md"><q-input v-model.number="lesson.order" type="number" outlined class="col-12 col-sm-3" label="Order" /><q-input v-model.number="lesson.estimatedMinutes" type="number" outlined class="col-12 col-sm-3" label="Minutes" /><q-input v-model="lesson.title" outlined class="col-12 col-sm-6" label="Title" /></div>
          <q-input v-model="lesson.summary" outlined type="textarea" autogrow label="Summary" />
          <div>
            <h3 class="text-h6 q-my-none">Video</h3>
            <p class="text-grey-7 q-mt-xs q-mb-none">
              Optional, shown above the lesson text. Link a YouTube video, or upload a video to keep it on this site.
            </p>
          </div>
          <VideoField
            v-model:upload="lesson.videoUpload"
            v-model:link="lesson.videoLink"
            :upload-path="`/v1/admin/courses/${courseId}/videos`"
            :title="lesson.title || 'this lesson'"
            @busy="(busy) => (videoBusy = busy)"
          />
          <q-separator />
          <q-input v-model="lesson.body" outlined type="textarea" autogrow label="Lesson text (separate paragraphs with a blank line)" />
          <div>
            <h3 class="text-h6 q-my-none">Quiz</h3>
            <p class="text-grey-7 q-mt-xs q-mb-none">
              {{ QUIZ_LIMITS.minQuestions }} to {{ QUIZ_LIMITS.maxQuestions }} questions, each with {{ QUIZ_LIMITS.minChoices }} to
              {{ QUIZ_LIMITS.maxChoices }} choices; select the correct one. Learners pass with {{ PASS_PERCENT }}% right and may retry as
              often as they like. After each try they see which answers were right, and every explanation.
            </p>
          </div>
          <q-card v-for="(question, index) in lesson.questions" :key="question.key" flat bordered class="q-pa-md">
            <div class="row items-center no-wrap q-mb-sm">
              <h4 class="text-subtitle1 text-weight-medium q-my-none col">Question {{ index + 1 }}</h4>
              <q-btn flat dense round icon="arrow_upward" :disable="index === 0" :aria-label="`Move question ${index + 1} up`" @click="move(lesson.questions, index, -1)" />
              <q-btn flat dense round icon="arrow_downward" :disable="index === lesson.questions.length - 1" :aria-label="`Move question ${index + 1} down`" @click="move(lesson.questions, index, 1)" />
              <q-btn flat dense round icon="delete" color="negative" :disable="lesson.questions.length <= QUIZ_LIMITS.minQuestions" :aria-label="`Delete question ${index + 1}`" @click="lesson.questions.splice(index, 1)" />
            </div>
            <q-input v-model="question.prompt" outlined type="textarea" autogrow label="Question" class="q-mb-sm" />
            <div role="radiogroup" :aria-label="`Correct answer to question ${index + 1}`">
              <div v-for="(_, choiceIndex) in question.choices" :key="choiceIndex" class="row items-center no-wrap q-mb-sm">
                <q-radio v-model="question.correctIndex" :val="choiceIndex" :aria-label="`Choice ${choiceIndex + 1} is correct`" />
                <q-input v-model="question.choices[choiceIndex]" outlined dense class="col" :label="`Choice ${choiceIndex + 1}${question.correctIndex === choiceIndex ? ' (correct)' : ''}`" />
                <q-btn flat dense round icon="close" :disable="question.choices.length <= QUIZ_LIMITS.minChoices" :aria-label="`Remove choice ${choiceIndex + 1}`" @click="removeChoice(question, choiceIndex)" />
              </div>
            </div>
            <q-btn flat dense no-caps icon="add" label="Add a choice" :disable="question.choices.length >= QUIZ_LIMITS.maxChoices" @click="question.choices.push('')" />
            <q-input v-model="question.explanation" outlined type="textarea" autogrow label="Explanation learners see after they answer" class="q-mt-sm" />
          </q-card>
          <q-btn outline no-caps icon="add" label="Add a question" :disable="lesson.questions.length >= QUIZ_LIMITS.maxQuestions" @click="addQuestion" />
          <q-banner v-if="lessonErrors.length" class="bg-red-1 text-black" rounded role="alert">
            <div class="text-weight-medium">Not saved yet:</div>
            <ul class="q-my-xs q-pl-md"><li v-for="problem in lessonErrors" :key="problem">{{ problem }}</li></ul>
          </q-banner>
        </q-card-section>
        <q-card-actions align="right" class="q-pa-md"><q-btn v-close-popup flat no-caps label="Cancel" /><q-btn color="primary" no-caps label="Save lesson" :disable="videoBusy" @click="saveLesson" /></q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="profileOpen" maximized>
      <q-card>
        <q-bar><div class="text-weight-medium">{{ profile.profileId ? 'Edit profile' : 'New profile' }}</div><q-space /><q-btn v-close-popup dense flat icon="close" aria-label="Close" /></q-bar>
        <q-card-section class="course-form">
          <div class="row q-col-gutter-md"><q-input v-model.number="profile.order" type="number" outlined class="col-12 col-sm-3" label="Order" /><q-input v-model="profile.name" outlined class="col-12 col-sm-5" label="Name" /><q-select v-model="profile.category" outlined emit-value map-options :options="categoryOptions" class="col-12 col-sm-4" label="Category" /></div>
          <q-input v-model="profile.biography" outlined type="textarea" autogrow label="Short biography" />
          <q-input v-model="profile.ideasText" outlined type="textarea" autogrow label="Key ideas (one per line)" />
          <q-input v-model="profile.quote" outlined type="textarea" autogrow label="Quoted passage" />
          <div class="row q-col-gutter-md"><q-input v-model="profile.quoteSource" outlined class="col-12 col-sm-4" label="Quote source" /><q-input v-model="profile.quoteUrl" outlined class="col-12 col-sm-8" label="Quote source URL" /></div>
          <q-input v-model="profile.furtherReadingUrl" outlined label="Further reading URL" />
          <q-separator />
          <div>
            <h3 class="text-h6 q-my-none">Portrait</h3>
            <p class="text-grey-7 q-mt-xs q-mb-none">
              Upload a photo, or link to a public-domain or open-licence image elsewhere. Publishing needs a portrait with alt
              text, a credit and a licence on every profile.
            </p>
          </div>
          <div class="portrait-editor">
            <div class="portrait-preview">
              <img v-if="previewSrc && !isBroken(previewSrc)" :src="previewSrc" alt="" @error="markBroken(previewSrc)" />
              <div v-else class="portrait-preview__empty" :class="{ 'text-negative': isBroken(previewSrc) }">
                {{ isBroken(previewSrc) ? "This picture doesn't load" : 'No portrait yet' }}
              </div>
            </div>
            <div class="col">
              <template v-if="profile.portraitImage">
                <div class="text-body2 text-weight-medium">Uploaded photo</div>
                <div class="text-caption text-grey-7">Kept on this site, so learners never load it from anywhere else.</div>
              </template>
              <q-input v-else v-model="profile.portraitUrl" outlined dense label="Image link (URL)" hint="Or upload a photo instead." />
              <div class="row q-gutter-sm q-mt-sm">
                <q-btn outline no-caps icon="upload" :label="profile.portraitImage ? 'Upload another photo' : 'Upload a photo'" :loading="uploading" @click="fileInput?.click()" />
                <q-btn v-if="profile.portraitImage" flat no-caps label="Remove the photo" @click="profile.portraitImage = null" />
              </div>
              <div class="text-caption text-grey-7 q-mt-sm">
                A JPEG, PNG or WebP at least {{ COURSE_IMAGE.minSide }} pixels on its short side, up to 5 MB. It is kept as a WebP at
                most {{ COURSE_IMAGE.maxSide }} pixels on its long side, with its metadata (such as where it was taken) removed.
              </div>
              <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" tabindex="-1" aria-hidden="true" @change="upload" />
            </div>
          </div>
          <q-input v-model="profile.portraitAlt" outlined label="Alt text" hint="What it shows, for people who can't see it" />
          <div class="row q-col-gutter-md"><q-input v-model="profile.portraitCredit" outlined class="col-12 col-sm-6" label="Credit" hint="Who took or owns it" /><q-input v-model="profile.portraitLicense" outlined class="col-12 col-sm-6" label="Licence" hint="CC BY-SA 4.0, public domain, with permission…" /></div>
          <q-input v-model="profile.portraitSourceUrl" outlined label="Source page (optional)" hint="Such as its Wikimedia Commons page" />
          <q-banner v-if="profileErrors.length" class="bg-red-1 text-black" rounded role="alert">
            <div class="text-weight-medium">Not saved yet:</div>
            <ul class="q-my-xs q-pl-md"><li v-for="problem in profileErrors" :key="problem">{{ problem }}</li></ul>
          </q-banner>
        </q-card-section>
        <q-card-actions align="right" class="q-pa-md"><q-btn v-close-popup flat no-caps label="Cancel" /><q-btn color="primary" no-caps label="Save profile" @click="saveProfile" /></q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<style scoped>
.course-form { display: flex; flex-direction: column; gap: 16px; max-width: 920px; margin: auto; }
.course-thumb { background: #d8e9f1; color: #0b2948; font-weight: 700; }
.course-thumb img { object-fit: cover; object-position: 50% 30%; }
.portrait-editor { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.portrait-preview { width: 160px; height: 200px; flex: none; border-radius: 8px; overflow: hidden; background: #d8e9f1; }
.portrait-preview img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 30%; display: block; }
.portrait-preview__empty { height: 100%; display: flex; align-items: center; justify-content: center; padding: 12px; text-align: center; color: #0b2948; }
</style>
