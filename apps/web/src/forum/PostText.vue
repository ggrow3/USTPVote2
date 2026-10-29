<script setup lang="ts">
import { computed } from 'vue';
import { paragraphs } from './forum-text.js';

/**
 * A post's or comment's text as members wrote it: paragraphs on blank lines, line breaks kept, and `http(s)://`
 * addresses as links that open in a new tab. Never read as HTML.
 */
const props = defineProps<{ text: string }>();
const parts = computed(() => paragraphs(props.text));
</script>

<template>
  <div class="forum-text">
    <p v-for="(paragraph, i) in parts" :key="i">
      <template v-for="(part, j) in paragraph" :key="j">
        <a v-if="part.href" :href="part.href" target="_blank" rel="noopener noreferrer nofollow ugc">{{ part.text }}</a>
        <template v-else>{{ part.text }}</template>
      </template>
    </p>
  </div>
</template>

<style scoped>
.forum-text {
  overflow-wrap: anywhere;
}
.forum-text p {
  margin: 0 0 0.75em;
  white-space: pre-line;
}
.forum-text p:last-child {
  margin-bottom: 0;
}
</style>
