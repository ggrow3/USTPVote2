<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { usePageTitle } from '../a11y.js';
import PageShell from '../components/PageShell.vue';
import { session } from '../session.js';
import { COURSE_VERSION, courseSections } from '../academy/course.js';

usePageTitle('Introduction to Transhumanism');
const active = ref(courseSections[0]!.id);
const completed = ref<string[]>([]);
const storageKey = computed(() => session.user ? `ustp-academy:v${COURSE_VERSION}:${session.user.uid}` : null);
watch(storageKey, (key) => {
  completed.value = [];
  if (!key) return;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(parsed)) completed.value = parsed.filter((id): id is string => typeof id === 'string' && courseSections.some((s) => s.id === id));
  } catch { completed.value = []; }
}, { immediate: true });
const current = computed(() => courseSections.find((s) => s.id === active.value) ?? courseSections[0]!);
const percent = computed(() => Math.round(100 * completed.value.length / courseSections.length));
function toggle(id: string) {
  if (!storageKey.value) return;
  completed.value = completed.value.includes(id) ? completed.value.filter((v) => v !== id) : [...completed.value, id];
  localStorage.setItem(storageKey.value, JSON.stringify(completed.value));
}
</script>

<template>
  <PageShell width="wide" class="academy-page">
    <div class="academy-container">
      <q-btn flat icon="arrow_back" label="Home" to="/" />
      <h1>Introduction to Transhumanism</h1>
      <p>Explore human flourishing, democratic governance, science, and the future of civilization through ten introductory lessons.</p>
      <q-banner v-if="!session.user" class="bg-blue-grey-1 text-dark q-mb-md">
        <router-link to="/signin">Sign in</router-link> to mark lessons complete. You can read every lesson without an account.
      </q-banner>
      <q-banner v-else class="bg-blue-grey-1 text-dark q-mb-md">
        Progress is currently saved in this browser on this device, not yet synchronized to your account across devices.
      </q-banner>
      <div class="text-subtitle1">{{ completed.length }} of {{ courseSections.length }} sections complete ({{ percent }}%)</div>
      <q-linear-progress :value="percent / 100" size="12px" rounded color="deep-orange" class="q-my-md" />
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
              <h3 class="text-subtitle1">Reflection</h3>
              <p>{{ current.reflection }}</p>
              <q-checkbox :model-value="completed.includes(current.id)" :disable="!session.user" label="Mark this section as complete" @update:model-value="toggle(current.id)" />
              <p v-if="percent === 100" class="text-positive text-weight-bold">All sections completed! This is a self-reported reading milestone, not a graded certification.</p>
            </q-card-section>
          </q-card>
        </article>
      </div>
    </div>
  </PageShell>
</template>
<style scoped>
.academy-container { max-width: 1100px; margin: 0 auto; }
.academy-page h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); line-height: 1.2; }
.academy-page article p { line-height: 1.7; }
</style>
