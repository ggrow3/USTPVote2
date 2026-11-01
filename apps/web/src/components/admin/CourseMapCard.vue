<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { COURSE_MAP, type CoursePosition, type CourseRecord } from 'ustp-domain';
import { Notify } from 'quasar';
import { api } from '../../api.js';
import { attempt } from '../../dialogs.js';
import {
  addLink,
  arrangeAsOrgChart,
  boardChanges,
  boardFrom,
  boardRows,
  boardSize,
  courseAt,
  linkText,
  moveCourse,
  nudgeCourse,
  removeLink,
  setPrerequisites,
  squareAt,
  type BoardCourse,
  type BoardEdit,
} from '../../academy/course-board.js';
import { courseMapLayout, MAP_GEOMETRY } from '../../academy/course-map.js';
import '../../academy/course-map.css';

/**
 * The Course tab's board of every course, drafts included (design §10.8): drag a card to another square (a card there
 * swaps with it) or off the map, drag from a card's handle to the course after it to draw a line, pick a line to
 * remove it, or arrange the whole map as an org chart. Nothing reaches learners until Save map. Picking a card, or a
 * course in the list, chooses the course edited below; its form does the same with menus and the arrow keys.
 */
const props = defineProps<{
  courses: readonly CourseRecord[];
  courseId: string;
}>();
const emit = defineEmits<{ select: [courseId: string]; changed: [courseId?: string] }>();

const board = ref<BoardCourse[]>(boardFrom(props.courses));
// A reload of the courses (a publish, a new course) keeps what was changed on the board and not saved yet.
watch(
  () => props.courses,
  (courses, before) => (board.value = boardFrom(courses, boardChanges(before, board.value))),
);
const changes = computed(() => boardChanges(props.courses, board.value));
const dirty = computed(() => changes.value.length > 0);

const records = computed(() => new Map(props.courses.map((course) => [course.courseId, course])));
const selected = computed(() => board.value.find((course) => course.courseId === props.courseId) ?? null);
const offMap = computed(() => board.value.filter((course) => !course.position));
const courseOptions = computed(() =>
  props.courses.map((course) => ({ value: course.courseId, label: course.title, caption: statusLabel(course) })),
);
const prerequisiteOptions = computed(() =>
  board.value.filter((course) => course.courseId !== props.courseId).map((course) => ({ value: course.courseId, label: course.title })),
);
const rowOptions = Array.from({ length: COURSE_MAP.rows }, (_, i) => ({ value: i, label: `Row ${i + 1}` }));
const columnOptions = Array.from({ length: COURSE_MAP.columns }, (_, i) => ({ value: i, label: `Column ${i + 1}` }));

function statusLabel(course: CourseRecord | undefined): string {
  if (!course || course.publishedVersion === null) return 'Draft, never published';
  return course.status === 'published' ? `Published, version ${course.publishedVersion}` : `Version ${course.publishedVersion} published; draft changes`;
}

/** Applies an edit to the board, or says why it was refused. */
function apply(edit: BoardEdit): boolean {
  if ('problem' in edit) {
    Notify.create({ type: 'warning', message: edit.problem });
    return false;
  }
  board.value = edit.board;
  return true;
}

// --- Layout -----------------------------------------------------------------------------------------------------

const rows = computed(() => boardRows(board.value));
const size = computed(() => boardSize(rows.value));
const layout = computed(() => courseMapLayout(board.value));
const { cardWidth, cardHeight, columnGap, rowGap } = MAP_GEOMETRY;
const squares = computed(() =>
  Array.from({ length: rows.value * COURSE_MAP.columns }, (_, i) => {
    const row = Math.floor(i / COURSE_MAP.columns);
    const column = i % COURSE_MAP.columns;
    return { row, column, x: column * (cardWidth + columnGap), y: row * (cardHeight + rowGap) };
  }),
);
const cardAt = (courseId: string) => layout.value.cards.find((card) => card.course.courseId === courseId);

// --- Dragging -----------------------------------------------------------------------------------------------------

/** A card being moved (from the map or the list under it), or a line being drawn from a card's handle. */
type Drag =
  | { kind: 'move'; courseId: string; startX: number; startY: number; grabX: number; grabY: number; clientX: number; clientY: number; moved: boolean }
  | { kind: 'link'; courseId: string; startX: number; startY: number; clientX: number; clientY: number };
const drag = ref<Drag | null>(null);
const canvas = ref<HTMLElement>();
const tray = ref<HTMLElement>();
/** A click that ended a drag is not also a pick. */
let dragged = false;
/** After a click on a card's handle: the next card picked comes after this one. */
const linkingFrom = ref<string | null>(null);
const selectedLink = ref<{ from: string; to: string } | null>(null);

function boardPoint(clientX: number, clientY: number) {
  const rect = canvas.value!.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}
const hovered = computed<CoursePosition | null>(() => {
  const d = drag.value;
  if (!d || !canvas.value) return null;
  const { x, y } = boardPoint(d.clientX, d.clientY);
  return squareAt(x, y, rows.value);
});
const overTray = computed(() => {
  const d = drag.value;
  if (!d || d.kind !== 'move' || !d.moved || !tray.value) return false;
  const rect = tray.value.getBoundingClientRect();
  return d.clientX >= rect.left && d.clientX <= rect.right && d.clientY >= rect.top && d.clientY <= rect.bottom;
});

/**
 * Takes the pointer for a drag. The browser's own default (selecting text, or dragging a selection, which cancels
 * the pointer) is stopped, so the element is focused by hand, as a click would.
 */
function capture(event: PointerEvent): HTMLElement {
  const element = event.currentTarget as HTMLElement;
  event.preventDefault();
  window.getSelection()?.removeAllRanges();
  element.focus({ preventScroll: true });
  element.setPointerCapture(event.pointerId);
  return element;
}

function startMove(event: PointerEvent, courseId: string) {
  if (event.button !== 0) return;
  dragged = false;
  const rect = capture(event).getBoundingClientRect();
  drag.value = {
    kind: 'move',
    courseId,
    startX: event.clientX,
    startY: event.clientY,
    grabX: event.clientX - rect.left,
    grabY: event.clientY - rect.top,
    clientX: event.clientX,
    clientY: event.clientY,
    moved: false,
  };
}

function startLink(event: PointerEvent, courseId: string) {
  if (event.button !== 0) return;
  event.stopPropagation();
  dragged = false;
  capture(event);
  drag.value = { kind: 'link', courseId, startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY };
}

function onPointerMove(event: PointerEvent) {
  const d = drag.value;
  if (!d) return;
  d.clientX = event.clientX;
  d.clientY = event.clientY;
  if (d.kind === 'move' && !d.moved && Math.hypot(event.clientX - d.startX, event.clientY - d.startY) > 6) d.moved = true;
}

function onPointerUp() {
  const d = drag.value;
  // Where it was let go, read before the drag ends.
  const square = hovered.value;
  const toTray = overTray.value;
  drag.value = null;
  if (!d) return;
  if (d.kind === 'move') {
    if (!d.moved) return;
    // The click that follows this pointerup is the end of the drag, not a pick.
    dragged = true;
    if (toTray) apply(moveCourse(board.value, d.courseId, null));
    else if (square) apply(moveCourse(board.value, d.courseId, square));
    emit('select', d.courseId);
    return;
  }
  if (Math.hypot(d.clientX - d.startX, d.clientY - d.startY) <= 6) {
    // A tap on the handle: the next course picked comes after this one.
    linkingFrom.value = d.courseId;
    return;
  }
  const target = square ? courseAt(board.value, square) : undefined;
  if (target && target.courseId !== d.courseId && apply(addLink(board.value, d.courseId, target.courseId))) {
    selectedLink.value = { from: d.courseId, to: target.courseId };
  }
}

function cancelDrag() {
  drag.value = null;
  linkingFrom.value = null;
}

function pick(courseId: string) {
  if (dragged) {
    dragged = false;
    return;
  }
  if (linkingFrom.value) {
    const from = linkingFrom.value;
    linkingFrom.value = null;
    if (from !== courseId && apply(addLink(board.value, from, courseId))) selectedLink.value = { from, to: courseId };
    return;
  }
  selectedLink.value = null;
  emit('select', courseId);
}

const ARROWS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
function onCardKey(event: KeyboardEvent, courseId: string) {
  const step = ARROWS[event.key];
  if (event.key === 'Escape') return cancelDrag();
  if (!step) return;
  event.preventDefault();
  apply(nudgeCourse(board.value, courseId, step[0], step[1]));
  emit('select', courseId);
}

function onBoardKey(event: KeyboardEvent) {
  if (event.key === 'Escape') cancelDrag();
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedLink.value) {
    event.preventDefault();
    removeSelectedLink();
  }
}

function removeSelectedLink() {
  const link = selectedLink.value;
  if (!link) return;
  board.value = removeLink(board.value, link.from, link.to);
  selectedLink.value = null;
}

/** The line being drawn: from the bottom of the card it starts at to the pointer. */
const drawing = computed(() => {
  const d = drag.value;
  if (!d || d.kind !== 'link' || !canvas.value) return null;
  const card = cardAt(d.courseId);
  if (!card) return null;
  const to = boardPoint(d.clientX, d.clientY);
  return { x1: card.x + cardWidth / 2, y1: card.y + cardHeight, x2: to.x, y2: to.y };
});

const ghost = computed(() => {
  const d = drag.value;
  if (!d || d.kind !== 'move' || !d.moved) return null;
  return { course: board.value.find((course) => course.courseId === d.courseId), left: d.clientX - d.grabX, top: d.clientY - d.grabY };
});

// --- The selected course's form -------------------------------------------------------------------------------------

const prerequisitesModel = computed({
  get: () => [...(selected.value?.prerequisites ?? [])],
  set: (ids: string[]) => selected.value && apply(setPrerequisites(board.value, selected.value.courseId, ids)),
});
const onMapModel = computed({
  get: () => !!selected.value?.position,
  set: (on: boolean) => {
    if (!selected.value) return;
    apply(moveCourse(board.value, selected.value.courseId, on ? freeSquare() : null));
  },
});
function setSquare(part: 'row' | 'column', value: number) {
  const position = selected.value?.position;
  if (!selected.value || !position) return;
  apply(moveCourse(board.value, selected.value.courseId, { ...position, [part]: value }));
}

/** The first square no course sits on, row by row, for a course put on the map from its form. */
function freeSquare(): CoursePosition {
  for (let row = 0; row < COURSE_MAP.rows; row++) {
    for (let column = 0; column < COURSE_MAP.columns; column++) if (!courseAt(board.value, { row, column })) return { row, column };
  }
  return { row: 0, column: 0 };
}

// --- Saving -------------------------------------------------------------------------------------------------------

function arrange() {
  if (apply(arrangeAsOrgChart(board.value))) Notify.create({ type: 'info', message: 'Arranged as an org chart. Save map to show it to learners.' });
}

const saving = ref(false);
async function save() {
  saving.value = true;
  if (await attempt(() => api<CourseRecord[]>('PUT', '/v1/admin/course-map', { courses: changes.value }), 'Saved: learners see the new map now')) {
    selectedLink.value = null;
    emit('changed');
  }
  saving.value = false;
}

function discard() {
  board.value = boardFrom(props.courses);
  selectedLink.value = null;
  linkingFrom.value = null;
}

// Leaving the page with the board changed asks first.
const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
  if (dirty.value) event.preventDefault();
};
window.addEventListener('beforeunload', warnBeforeLeaving);
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeLeaving));

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
        Drag a course to another square (a course there swaps with it) or into “Not on the map”. Drag from the round handle
        under a course to the course that comes after it to draw a line; pick a line to remove it. Students read any course's
        lessons, but take its quizzes only once they have passed every course before it. Nothing changes for learners until
        you save the map.
      </p>
      <div class="row items-center q-gutter-sm q-mb-sm">
        <q-btn outline no-caps color="primary" icon="account_tree" label="Arrange as org chart" @click="arrange" />
        <q-space />
        <span v-if="dirty" class="text-body2" role="status">
          {{ changes.length === 1 ? '1 course changed' : `${changes.length} courses changed` }}, not saved
        </span>
        <q-btn flat no-caps color="primary" label="Discard changes" :disable="!dirty" @click="discard" />
        <q-btn unelevated no-caps color="primary" icon="save" label="Save map" :disable="!dirty" :loading="saving" @click="save" />
      </div>
      <q-banner v-if="linkingFrom" dense rounded class="bg-blue-1 text-black q-mb-sm">
        Pick the course that comes after {{ board.find((c) => c.courseId === linkingFrom)?.title }}.
        <template #action><q-btn flat dense no-caps color="black" label="Cancel" @click="linkingFrom = null" /></template>
      </q-banner>
      <q-banner v-else-if="selectedLink" dense rounded class="bg-blue-1 text-black q-mb-sm">
        {{ linkText(board, selectedLink.from, selectedLink.to) }}.
        <template #action>
          <q-btn flat dense no-caps color="red-10" icon="link_off" label="Remove line" @click="removeSelectedLink" />
          <q-btn flat dense no-caps color="black" label="Keep" @click="selectedLink = null" />
        </template>
      </q-banner>

      <div class="course-map course-board" role="group" aria-label="Course map board: every course, drafts included" @keydown="onBoardKey" @dragstart.prevent>
        <div ref="canvas" class="course-map__canvas" :style="{ width: `${size.width}px`, height: `${size.height}px` }">
          <div
            v-for="square in squares"
            :key="`${square.row}-${square.column}`"
            class="course-board__square"
            :class="{ 'course-board__square--target': ghost && hovered && hovered.row === square.row && hovered.column === square.column }"
            :style="{ left: `${square.x}px`, top: `${square.y}px`, width: `${cardWidth}px`, height: `${cardHeight}px` }"
          />
          <svg class="course-map__lines course-board__lines" :width="size.width" :height="size.height">
            <g v-for="line in layout.lines" :key="`${line.from}>${line.to}`">
              <path :d="line.path" :class="{ 'course-board__line--selected': selectedLink?.from === line.from && selectedLink?.to === line.to }" />
              <path
                :d="line.path"
                class="course-board__hit"
                role="button"
                tabindex="0"
                :aria-label="`${linkText(board, line.from, line.to)}: pick to remove`"
                @click="selectedLink = { from: line.from, to: line.to }"
                @keydown.enter.prevent="selectedLink = { from: line.from, to: line.to }"
              />
            </g>
            <line v-if="drawing" class="course-board__drawing" :x1="drawing.x1" :y1="drawing.y1" :x2="drawing.x2" :y2="drawing.y2" />
          </svg>
          <div
            v-for="card in layout.cards"
            :key="card.course.courseId"
            class="course-map__cell"
            :class="{ 'course-board__cell--lifted': ghost?.course?.courseId === card.course.courseId }"
            :style="{ left: `${card.x}px`, top: `${card.y}px`, width: `${cardWidth}px`, height: `${cardHeight}px` }"
          >
            <button
              type="button"
              class="course-card course-board__card"
              :class="{
                'course-card--soon': records.get(card.course.courseId)?.publishedVersion === null,
                'course-card--selected': card.course.courseId === courseId,
                'course-board__card--target': drag?.kind === 'link' && hovered && card.course.position?.row === hovered.row && card.course.position?.column === hovered.column,
              }"
              :aria-pressed="card.course.courseId === courseId"
              :aria-label="`${card.course.title}, row ${card.course.position!.row + 1}, column ${card.course.position!.column + 1}. Arrow keys move it.`"
              @pointerdown="startMove($event, card.course.courseId)"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointercancel="cancelDrag"
              @click="pick(card.course.courseId)"
              @keydown="onCardKey($event, card.course.courseId)"
            >
              <span class="course-card__title">{{ card.course.title }}</span>
              <span class="course-card__status">{{ statusLabel(records.get(card.course.courseId)) }}</span>
            </button>
            <button
              type="button"
              class="course-board__handle"
              :aria-label="`Draw a line from ${card.course.title} to the course after it`"
              title="Drag to the course that comes after this one"
              @pointerdown="startLink($event, card.course.courseId)"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointercancel="cancelDrag"
            />
          </div>
        </div>
      </div>

      <div ref="tray" class="course-board__tray q-mt-sm" :class="{ 'course-board__tray--target': overTray }" @dragstart.prevent>
        <span class="text-body2 q-mr-xs">Not on the map:</span>
        <span v-if="!offMap.length" class="text-grey-7 text-body2">none. Drag a course here to take it off.</span>
        <q-chip
          v-for="course in offMap"
          :key="course.courseId"
          clickable
          :outline="course.courseId !== courseId"
          color="primary"
          :text-color="course.courseId === courseId ? 'white' : 'primary'"
          class="course-board__chip"
          @pointerdown="startMove($event, course.courseId)"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="cancelDrag"
          @click="pick(course.courseId)"
        >
          {{ course.title }}
        </q-chip>
      </div>
      <div v-if="ghost?.course" class="course-board__ghost" :style="{ left: `${ghost.left}px`, top: `${ghost.top}px`, width: `${cardWidth}px` }" aria-hidden="true">
        {{ ghost.course.title }}
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
        <div class="text-caption text-grey-7">The same as dragging on the board: saved with the map.</div>
        <div class="row q-col-gutter-md q-mt-xs items-start">
          <q-select
            v-model="prerequisitesModel"
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
            <q-toggle v-model="onMapModel" label="On the map" />
            <div v-if="selected.position" class="row q-col-gutter-sm q-mt-xs">
              <q-select
                :model-value="selected.position.row"
                :options="rowOptions"
                emit-value
                map-options
                outlined
                dense
                class="col-6"
                label="Row"
                @update:model-value="(v: number) => setSquare('row', v)"
              />
              <q-select
                :model-value="selected.position.column"
                :options="columnOptions"
                emit-value
                map-options
                outlined
                dense
                class="col-6"
                label="Column"
                @update:model-value="(v: number) => setSquare('column', v)"
              />
            </div>
            <div v-else class="text-caption text-grey-7">Off the map, a published course is still listed on the Courses page.</div>
          </div>
        </div>
      </q-card-section>
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

<style scoped>
.course-board {
  max-height: 70vh;
  overflow: auto;
}
.course-board__square {
  position: absolute;
  box-sizing: border-box;
  border: 2px dashed rgba(107, 122, 153, 0.35);
  border-radius: 8px;
}
.course-board__square--target {
  border-color: #ffb300;
  background: rgba(255, 179, 0, 0.12);
}
.course-board__lines {
  pointer-events: none;
}
.course-board__lines .course-board__hit {
  stroke: transparent;
  stroke-width: 16;
  pointer-events: stroke;
  cursor: pointer;
}
.course-board__lines .course-board__line--selected {
  stroke: #ffb300;
  stroke-width: 5;
}
.course-board__lines .course-board__drawing {
  stroke: #d32f2f;
  stroke-width: 3;
  stroke-dasharray: 6 4;
}
.course-board__card {
  touch-action: none;
  cursor: grab;
  user-select: none;
}
.course-board__cell--lifted {
  opacity: 0.35;
}
.course-board__card--target {
  outline: 4px solid #ffb300;
  outline-offset: 2px;
}
.course-board__handle {
  position: absolute;
  left: 50%;
  bottom: -12px;
  width: 24px;
  height: 24px;
  margin-left: -12px;
  border-radius: 50%;
  border: 3px solid #d32f2f;
  background: #fff;
  cursor: crosshair;
  touch-action: none;
  padding: 0;
}
.course-board__handle:hover,
.course-board__handle:focus-visible {
  background: #d32f2f;
}
.course-board__tray {
  min-height: 48px;
  padding: 6px 8px;
  border: 2px dashed transparent;
  border-radius: 8px;
}
.course-board__tray--target {
  border-color: #ffb300;
  background: rgba(255, 179, 0, 0.12);
}
.course-board__chip {
  touch-action: none;
}
.course-board__ghost {
  position: fixed;
  z-index: 9000;
  box-sizing: border-box;
  padding: 12px;
  border-radius: 8px;
  background: #1d3fd8;
  color: #fff;
  font-weight: 700;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  opacity: 0.9;
}
</style>
