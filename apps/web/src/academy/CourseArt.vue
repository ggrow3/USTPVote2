<script setup lang="ts">
import { computed } from 'vue';
import { courseArt } from './course-catalog.js';

/** A course's artwork (design §10.8): its gradient and icon, made from its ID. Decoration only; the title says what it is. */
const props = defineProps<{ courseId: string }>();
const art = computed(() => courseArt(props.courseId));
</script>

<template>
  <div class="course-art" :style="{ '--art-from': art.from, '--art-to': art.to }" aria-hidden="true">
    <q-icon :name="art.icon" class="course-art__icon" />
  </div>
</template>
