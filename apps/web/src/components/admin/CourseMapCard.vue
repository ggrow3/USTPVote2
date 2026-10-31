<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { COURSE_MAP, type CourseRecord } from 'ustp-domain';
import { api } from '../../api.js';
import { attempt } from '../../dialogs.js';
import CourseMapView from '../../academy/CourseMap.vue';

/**
 * The Course tab's map of every course, drafts included (design §10.8): pick a course by its card or from the list,
 * add a course, and set where the chosen one sits and which courses come before it. Placement applies at once.
 */
const props = defineProps<{
  courses: readonly CourseRecord[];
  courseId: string;
}>();
const emit = defineEmits<{ select: [courseId: string]; changed: [courseId?: string] }>();

const selected = computed(() => props.courses.find((course) => course.courseId === props.courseId) ?? null);
const offMap = computed(() => props.courses.filter((course) => !course.position));
const courseOptions = computed(() =>
  props.courses.map((course) => ({ value: course.courseId, label: course.title, caption: statusLabel(course) })),
);
const prerequisiteOptions = computed(() =>
  props.courses.filter((course) => course.courseId !== props.courseId).map((course) => ({ value: course.courseId, label: course.title })),
);
const rows = Array.from({ length: COURSE_MAP.rows }, (_, i) => ({ value: i, label: `Row ${i + 1}` }));
const columns = Array.from({ length: COURSE_MAP.columns }, (_, i) => ({ value: i, label: `Column ${i + 1}` }));

const placement = reactive({ prerequisites: [] as string[], onMap: true, row: 0, column: 0 });
watch(
  selected,
  (course) => {
    if (!course) return;
    Object.assign(placement, {
      prerequisites: [...course.prerequisites],
      onMap: !!course.position,
      row: course.position?.row ?? freeSquare().row,
      column: course.position?.column ?? freeSquare().column,
    });
  },
  { immediate: true },
);

/** The first square no course sits on, row by row, for a course being put on the map. */
function freeSquare() {
  for (let row = 0; row < COURSE_MAP.rows; row++) {
    for (let column = 0; column < COURSE_MAP.columns; column++) {
      if (!props.courses.some((course) => course.position?.row === row && course.position.column === column)) return { row, column };
    }
  }
  return { row: 0, column: 0 };
}

function statusLabel(course: CourseRecord): string {
  if (course.publishedVersion === null) return 'Draft, never published';
  return course.status === 'published' ? `Published, version ${course.publishedVersion}` : `Version ${course.publishedVersion} published; draft changes`;
}

const saving = ref(false);
async function savePlacement() {
  saving.value = true;
  const body = { prerequisites: placement.prerequisites, position: placement.onMap ? { row: placement.row, column: placement.column } : null };
  if (await attempt(() => api('PUT', `/v1/admin/courses/${props.courseId}/map`, body), 'Saved: learners see the change now')) emit('changed');
  saving.value = false;
}

const createOpen = ref(false);
const draft = reactive({ title: '', summary: '' });
async function create() {
  await attempt(async () => {
    const created = await api<CourseRecord>('POST', '/v1/admin/courses', { title: draft.title, summary: draft.summary });
    createOpen.value = false;
    Object.assign(draft, { title: '', summary: '' });
    emit('changed', created.courseId);
  }, 'Course added as a draft, off the map');
}
</script>

<template>
  <q-card flat bordered class="q-mb-lg">
    <q-card-section class="row items-center justify-between q-gutter-sm">
      <h2 class="text-h6 q-my-none">Courses and the course map</h2>
      <q-btn color="primary" flat no-caps icon="add" label="New course" @click="createOpen = true" />
    </q-card-section>
    <q-card-section class="q-pt-none">
      <p class="text-grey-7 q-mb-sm">
        A line runs from a course to each course after it. Students read any course's lessons, but take its quizzes only once they
        have passed every course before it. Where a course sits and what comes before it apply at once, without publishing; a
        draft on the map shows as coming soon. Choose a course on the map or in the list to edit it below.
      </p>
      <CourseMapView :courses="courses" label="Course map: every course, drafts included">
        <template #card="{ course }">
          <button
            type="button"
            class="course-card"
            :class="{ 'course-card--soon': course.publishedVersion === null, 'course-card--selected': course.courseId === courseId }"
            :aria-pressed="course.courseId === courseId"
            @click="emit('select', course.courseId)"
          >
            <span class="course-card__title">{{ course.title }}</span>
            <span class="course-card__status">{{ statusLabel(course) }}</span>
          </button>
        </template>
      </CourseMapView>
      <div v-if="offMap.length" class="q-mt-sm">
        <span class="text-body2 q-mr-xs">Not on the map:</span>
        <q-chip v-for="course in offMap" :key="course.courseId" clickable :outline="course.courseId !== courseId" color="primary" :text-color="course.courseId === courseId ? 'white' : 'primary'" @click="emit('select', course.courseId)">
          {{ course.title }}
        </q-chip>
      </div>
      <q-select
        :model-value="courseId"
        :options="courseOptions"
        emit-value
        map-options
        outlined
        label="Course to edit"
        class="q-mt-md"
        style="max-width: 560px"
        @update:model-value="(id: string) => emit('select', id)"
      >
        <template #option="scope">
          <q-item v-bind="scope.itemProps">
            <q-item-section>
              <q-item-label>{{ scope.opt.label }}</q-item-label>
              <q-item-label caption>{{ scope.opt.caption }}</q-item-label>
            </q-item-section>
          </q-item>
        </template>
      </q-select>
    </q-card-section>

    <template v-if="selected">
      <q-separator />
      <q-card-section>
        <h3 class="text-subtitle1 text-weight-medium q-my-none">Where “{{ selected.title }}” sits</h3>
        <div class="row q-col-gutter-md q-mt-xs items-start">
          <q-select
            v-model="placement.prerequisites"
            :options="prerequisiteOptions"
            emit-value
            map-options
            multiple
            use-chips
            outlined
            class="col-12 col-md-6"
            label="Comes after"
            :hint="`Students pass these first; up to ${COURSE_MAP.maxPrerequisites}`"
            :max-values="COURSE_MAP.maxPrerequisites"
          />
          <div class="col-12 col-md-6">
            <q-toggle v-model="placement.onMap" label="On the map" />
            <div v-if="placement.onMap" class="row q-col-gutter-sm q-mt-xs">
              <q-select v-model="placement.row" :options="rows" emit-value map-options outlined dense class="col-6" label="Row" />
              <q-select v-model="placement.column" :options="columns" emit-value map-options outlined dense class="col-6" label="Column" />
            </div>
            <div v-else class="text-caption text-grey-7">Off the map, a published course is still listed on the Courses page.</div>
          </div>
        </div>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn color="primary" no-caps label="Save placement" :loading="saving" @click="savePlacement" />
      </q-card-actions>
    </template>

    <q-dialog v-model="createOpen">
      <q-card style="width: 560px; max-width: 92vw">
        <q-card-section><h2 class="text-h6 q-my-none">New course</h2></q-card-section>
        <q-card-section class="q-pt-none column q-gutter-md">
          <q-input v-model="draft.title" outlined autofocus label="Title" maxlength="200" />
          <q-input v-model="draft.summary" outlined type="textarea" autogrow label="Public summary" maxlength="2000" />
          <div class="text-caption text-grey-7">It starts as a draft, off the map. Its address is made from the title and does not change later.</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat no-caps label="Cancel" />
          <q-btn color="primary" no-caps label="Add course" :disable="!draft.title.trim() || !draft.summary.trim()" @click="create" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-card>
</template>
