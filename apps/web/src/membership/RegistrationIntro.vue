<script setup lang="ts">
import { computed } from 'vue';
import { introParagraphs } from 'ustp-domain';

/** The intro above Register's steps (design §5.2): the Membership Admins' paragraphs, as plain text. */
const props = defineProps<{ intro: string }>();
const paragraphs = computed(() => introParagraphs(props.intro));
</script>

<template>
  <div v-if="paragraphs.length" class="registration-intro">
    <p v-for="(p, i) in paragraphs" :key="i">{{ p }}</p>
  </div>
</template>

<style scoped>
.registration-intro {
  max-width: 70ch;
}
.registration-intro p:last-child {
  margin-bottom: 0;
}
</style>
