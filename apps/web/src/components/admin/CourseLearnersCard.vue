<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CourseConversation, CourseLearnerRow } from 'ustp-domain';
import { api, errorMessage } from '../../api.js';
import { attempt } from '../../dialogs.js';
import CourseConversationView from '../../academy/CourseConversation.vue';
import { shortDateTime } from '../../academy/course-map.js';

/**
 * A course's students as Course Administrators see them (design §10.8): name (never email), lessons passed and best
 * scores, attempts, last activity and certificate; and each student's switch for messages with the instructors, who
 * are the Course Administrators. Messaging starts off for everyone.
 */
const props = defineProps<{ courseId: string }>();

const learners = ref<readonly CourseLearnerRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const open = ref<CourseLearnerRow | null>(null);
const conversation = ref<CourseConversation | null>(null);
const unread = computed(() => learners.value.filter((learner) => learner.unread).length);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    learners.value = await api<CourseLearnerRow[]>('GET', `/v1/admin/courses/${props.courseId}/learners`);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

const path = (learner: Pick<CourseLearnerRow, 'accountId'>) => `/v1/admin/courses/${props.courseId}/learners/${learner.accountId}`;

async function switchMessaging(learner: CourseLearnerRow, messaging: boolean) {
  const done = await attempt(
    () => api('PUT', `${path(learner)}/messaging`, { messaging }),
    messaging ? `${learner.name} can now message the instructors` : `Messages are off for ${learner.name}`,
  );
  if (done) {
    await load();
    if (open.value?.accountId === learner.accountId) {
      open.value = learners.value.find((row) => row.accountId === learner.accountId) ?? null;
      if (conversation.value) conversation.value = { ...conversation.value, messaging };
    }
  }
}

async function openLearner(learner: CourseLearnerRow) {
  open.value = learner;
  conversation.value = null;
  await attempt(async () => {
    conversation.value = await api<CourseConversation>('GET', `${path(learner)}/messages`);
  });
  void load();
}

async function answer(body: string): Promise<boolean> {
  const learner = open.value;
  if (!learner) return false;
  return attempt(async () => {
    conversation.value = await api<CourseConversation>('POST', `${path(learner)}/messages`, { body });
  }, 'Answer sent');
}

const scoreText = (score: number | null) => (score === null ? 'not tried' : `${score}%`);

watch(() => props.courseId, () => void load(), { immediate: true });
</script>

<template>
  <q-card flat bordered class="q-mb-lg">
    <q-card-section class="row items-center justify-between q-gutter-sm">
      <h2 class="text-h6 q-my-none">
        Students
        <q-badge v-if="unread" color="negative" class="q-ml-xs" :label="`${unread} waiting`" />
      </h2>
      <q-btn flat no-caps icon="refresh" label="Refresh" :loading="loading" @click="load" />
    </q-card-section>
    <q-card-section class="q-pt-none">
      <p class="text-grey-7 q-mb-sm">
        Everyone who has tried a quiz in this course. The instructors are the Course Administrators. A student can message
        them only once you turn messages on for that student, here; turning them off keeps the conversation but stops both
        sides writing.
      </p>
      <q-banner v-if="error" class="bg-red-1 text-black" rounded role="alert">{{ error }}</q-banner>
      <p v-else-if="!loading && !learners.length" class="text-body2 q-mb-none">No students yet. They appear here once they try a quiz in this course.</p>
      <div v-else class="learners-scroll">
        <q-markup-table flat dense separator="horizontal">
          <thead>
            <tr>
              <th class="text-left">Student</th>
              <th class="text-left">Lessons passed</th>
              <th class="text-right">Attempts</th>
              <th class="text-left">Last active</th>
              <th class="text-left">Certificate</th>
              <th class="text-left">Messages</th>
              <th class="text-left"><span class="sr-only">Details</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="learner in learners" :key="learner.accountId">
              <td class="text-weight-medium">{{ learner.name }}</td>
              <td>
                {{ learner.lessonsPassed }} of {{ learner.lessons.length }}
                <span v-if="learner.version" class="text-grey-7">· v{{ learner.version }}</span>
              </td>
              <td class="text-right">{{ learner.attempts }}</td>
              <td>{{ learner.lastActivityAt ? shortDateTime(learner.lastActivityAt) : '—' }}</td>
              <td>
                <template v-if="learner.certificate?.revokedAt">Revoked</template>
                <template v-else-if="learner.certificate">Issued {{ shortDateTime(learner.certificate.issuedAt) }}</template>
                <template v-else>—</template>
              </td>
              <td>
                <q-toggle
                  :model-value="learner.messaging"
                  :label="learner.messaging ? 'On' : 'Off'"
                  :aria-label="`Messages with the instructors for ${learner.name}`"
                  @update:model-value="(on: boolean) => switchMessaging(learner, on)"
                />
              </td>
              <td>
                <q-btn flat dense no-caps :label="learner.unread ? 'New message' : 'Open'" :color="learner.unread ? 'negative' : 'primary'" :icon="learner.unread ? 'mark_email_unread' : 'person'" @click="openLearner(learner)" />
              </td>
            </tr>
          </tbody>
        </q-markup-table>
      </div>
    </q-card-section>

    <q-dialog :model-value="!!open" @update:model-value="(shown: boolean) => { if (!shown) open = null; }">
      <q-card v-if="open" style="width: 720px; max-width: 94vw">
        <q-bar>
          <div class="text-weight-medium">{{ open.name }}</div>
          <q-space />
          <q-btn v-close-popup dense flat icon="close" aria-label="Close" />
        </q-bar>
        <q-card-section>
          <h3 class="text-subtitle1 text-weight-medium q-mt-none q-mb-xs">Lessons</h3>
          <p v-if="!open.lessons.length" class="text-body2">No quiz tried yet.</p>
          <q-list v-else dense separator>
            <q-item v-for="lesson in open.lessons" :key="lesson.lessonId">
              <q-item-section avatar><q-icon :name="lesson.passed ? 'check_circle' : 'radio_button_unchecked'" :color="lesson.passed ? 'positive' : 'grey-6'" /></q-item-section>
              <q-item-section>{{ lesson.title }}</q-item-section>
              <q-item-section side>Best: {{ scoreText(lesson.bestScore) }}</q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
        <q-separator />
        <q-card-section>
          <div class="row items-center justify-between">
            <h3 class="text-subtitle1 text-weight-medium q-my-none">Messages</h3>
            <q-toggle :model-value="open.messaging" :label="open.messaging ? 'Messages on' : 'Messages off'" @update:model-value="(on: boolean) => switchMessaging(open!, on)" />
          </div>
          <q-skeleton v-if="!conversation" type="rect" height="80px" />
          <CourseConversationView
            v-else
            :conversation="conversation"
            viewer="instructor"
            off-text="Messages are off for this student. Turn them on to write to each other."
            :send="answer"
          />
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-card>
</template>

<style scoped>
.learners-scroll { overflow-x: auto; }
</style>
