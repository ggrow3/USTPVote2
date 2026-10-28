<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { usePageTitle } from '../a11y.js';
import { session } from '../session.js';
import { api, errorMessage } from '../api.js';
import { COURSE_VERSION, courseSections } from '../academy/course.js';
import { thinkers } from '../academy/thinkers.js';
import ThinkerPortrait from '../academy/ThinkerPortrait.vue';

usePageTitle('Introduction to Transhumanism');
const active = ref(courseSections[0]!.id);
const completed = ref<string[]>([]);
const certificateId = ref<string | null>(null);
const certificateBusy = ref(false);
async function issueCertificate() {
  certificateBusy.value = true; error.value = '';
  try {
    const result = await api<{certificateId:string}>('POST','/v1/academy/certificates',undefined,{actAs:null});
    certificateId.value = result.certificateId;
  } catch(e) { error.value = errorMessage(e); }
  finally { certificateBusy.value = false; }
}

const busy = ref(false);
const questions = ref<{section:string;prompt:string;options:readonly string[]}[]>([]);
const answer = ref<number | null>(null);
const quizResult = ref<{correct:boolean;explanation:string} | null>(null);
watch(active, () => { answer.value = null; quizResult.value = null; });
const currentQuestion = computed(() => questions.value.find(q => q.section === active.value));
const currentThinkers = computed(() => thinkers.filter(t => t.sections.includes(active.value)));
api<{questions:{section:string;prompt:string;options:string[]}[]}>('GET','/v1/academy/questions').then(r => { questions.value = r.questions; }).catch(() => undefined);
async function submitQuiz() {
  if (!session.user || answer.value === null || busy.value) return;
  busy.value = true; error.value = '';
  try {
    quizResult.value = await api('PUT','/v1/academy/attempts',{section:active.value,answer:answer.value,assessmentVersion:1},{actAs:null});
  } catch(e) { error.value = errorMessage(e); }
  finally { busy.value = false; }
}

const error = ref('');
watch(() => session.user?.uid, async (uid) => {
  completed.value = [];
  certificateId.value = null;
  error.value = '';
  if (!uid) return;
  busy.value = true;
  try {
    const result = await api<{ courseVersion: number; sections: string[] }>('GET', '/v1/academy/progress', undefined, { actAs: null });
    if (session.user?.uid === uid && result.courseVersion === COURSE_VERSION) completed.value = result.sections.filter((id) => courseSections.some((s) => s.id === id));
    const cert = await api<{certificateId:string|null}>('GET','/v1/academy/certificates/me',undefined,{actAs:null});
    if (session.user?.uid === uid) certificateId.value = cert.certificateId;
  } catch (e) { error.value = errorMessage(e); }
  finally { busy.value = false; }
}, { immediate: true });
const current = computed(() => courseSections.find((s) => s.id === active.value) ?? courseSections[0]!);
const percent = computed(() => Math.round(100 * completed.value.length / courseSections.length));
async function toggle(id: string) {
  if (!session.user || busy.value) return;
  const completedNext = !completed.value.includes(id);
  busy.value = true;
  error.value = '';
  try {
    await api('PUT', `/v1/academy/progress/${id}`, { completed: completedNext, lessonVersion: COURSE_VERSION }, { actAs: null });
    completed.value = completedNext ? [...completed.value, id] : completed.value.filter((v) => v !== id);
  } catch (e) { error.value = errorMessage(e); }
  finally { busy.value = false; }
}
</script>

<template>
  <q-page padding class="academy-page">
    <div class="academy-container">
      <q-btn flat icon="arrow_back" label="Home" to="/" />
      <h1>Introduction to Transhumanism</h1>
      <p>Explore human flourishing, democratic governance, science, and the future of civilization through ten introductory lessons.</p>
      <q-banner v-if="!session.user" class="bg-blue-grey-1 text-dark q-mb-md">
        <router-link to="/signin">Sign in</router-link> to mark lessons complete. You can read every lesson without an account.
      </q-banner>
      <q-banner v-else class="bg-blue-grey-1 text-dark q-mb-md">
        Your progress is saved to your account and can be resumed on another device.
      </q-banner>
      <q-banner v-if="error" class="bg-red-1 text-negative q-mb-md" role="alert">{{ error }}</q-banner>
      <q-linear-progress v-if="busy" indeterminate class="q-mb-sm" />
      <div class="text-subtitle1">{{ completed.length }} of {{ courseSections.length }} sections complete ({{ percent }}%)</div>
      <q-linear-progress :value="percent / 100" size="12px" rounded color="deep-orange" class="q-my-md" />
      <q-card v-if="session.user" flat bordered class="q-mb-md">
        <q-card-section>
          <h2 class="text-h6">Course certificate</h2>
          <p>To qualify, complete all ten lessons and correctly answer each section's knowledge check. The server verifies your results before issuing a certificate.</p>
          <q-btn v-if="!certificateId" color="deep-orange" label="Request certificate" :loading="certificateBusy" :disable="busy || percent !== 100" @click="issueCertificate" />
          <q-btn v-else color="deep-orange" icon="workspace_premium" label="View verified certificate" :to="'/academy/certificates/' + certificateId" />
          <p class="text-caption q-mt-sm">Certificates are publicly verifiable by their unique link and display your account name. Use a suitable display name before requesting one.</p>
        </q-card-section>
      </q-card>
      <div class="row q-col-gutter-md">
        <nav class="col-12 col-md-4" aria-label="Course sections">
          <q-list bordered separator>
            <q-item v-for="(section, index) in courseSections" :key="section.id" clickable :active="active === section.id" @click="active = section.id">
              <q-item-section avatar><q-icon :name="completed.includes(section.id) ? 'check_circle' : 'menu_book'" :color="completed.includes(section.id) ? 'positive' : 'grey-7'" /></q-item-section>
              <q-item-section>{{ index + 1 }}. {{ section.title }}</q-item-section>
            </q-item>
          </q-list>
        </nav>
        <article class="col-12 col-md-8">
          <q-card flat bordered>
            <q-card-section>
              <div class="text-caption">Lesson version {{ current.version }}</div>
              <h2 class="text-h5">{{ current.title }}</h2>
              <p><strong>Learning objective:</strong> {{ current.objective }}</p>
              <p v-for="(paragraph, index) in current.lesson" :key="index">{{ paragraph }}</p>
              <h3 class="text-h6 q-mt-lg">People and ideas</h3>
              <div v-for="person in currentThinkers" :key="person.name" class="row no-wrap q-gutter-md q-mb-lg items-start">
                <ThinkerPortrait :title="person.wikipediaTitle" :name="person.name" />
                <div>
                  <h4 class="text-subtitle1 q-my-none">{{ person.name }} <small>({{ person.years }})</small></h4>
                  <p class="text-caption q-mb-xs">{{ person.contribution }}</p>
                  <p class="q-mb-xs">{{ person.biography }}</p>
                  <a :href="'https://en.wikipedia.org/wiki/' + person.wikipediaTitle" target="_blank" rel="noopener noreferrer">Biography and image source (Wikipedia)</a>
                </div>
              </div>
              <section v-if="currentQuestion" aria-label="Knowledge check" class="q-my-lg">
                <h3 class="text-h6">Knowledge check</h3>
                <p>{{ currentQuestion.prompt }}</p>
                <q-option-group v-model="answer" :options="currentQuestion.options.map((label,index) => ({label,value:index}))" type="radio" :disable="!session.user || busy || !!quizResult" />
                <q-btn color="deep-orange" label="Submit answer" class="q-mt-sm" :disable="!session.user || answer === null || busy || !!quizResult" @click="submitQuiz" />
                <p v-if="quizResult" class="q-mt-md" role="status"><strong>{{ quizResult.correct ? 'Correct!' : 'Not quite.' }}</strong> {{ quizResult.explanation }}</p>
                <q-btn v-if="quizResult" flat label="Try again" @click="quizResult = null; answer = null" />
                <p v-if="!session.user" class="text-caption">Sign in to submit a graded knowledge check.</p>
              </section>
              <h3 class="text-subtitle1">Reflection</h3>
              <p>{{ current.reflection }}</p>
              <q-checkbox :model-value="completed.includes(current.id)" :disable="!session.user || busy" label="Mark this section as complete" @update:model-value="toggle(current.id)" />
              <p v-if="percent === 100" class="text-positive text-weight-bold">All reading sections completed! Pass all ten knowledge checks to qualify for a certificate.</p>
            </q-card-section>
          </q-card>
        </article>
      </div>
    </div>
  </q-page>
</template>
<style scoped>
.academy-container { max-width: 1100px; margin: 0 auto; }
.academy-page h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); line-height: 1.2; }
.academy-page article p { line-height: 1.7; }
</style>
