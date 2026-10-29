<script setup lang="ts">
import { computed } from 'vue';
import { newsBlocks, textSegments } from 'ustp-domain';

/**
 * A news post's text (design §10.7): headings, paragraphs, lists and quotations from plain text, with `https://`
 * addresses as links. Nothing in it becomes markup: each piece is text Vue escapes.
 */
const props = defineProps<{ body: string }>();
const blocks = computed(() =>
  newsBlocks(props.body).map((b) => ({
    ...b,
    lines: b.kind === 'list' ? b.items.map((i) => [textSegments(i)]) : [b.text.split('\n').map(textSegments)],
  })),
);
</script>

<template>
  <div class="news-body">
    <template v-for="(b, i) in blocks" :key="i">
      <h2 v-if="b.kind === 'heading'" class="text-h6">
        <template v-for="(s, k) in b.lines[0]![0]" :key="k">
          <a v-if="'url' in s" :href="s.url" target="_blank" rel="noopener noreferrer nofollow">{{ s.url }}</a><template v-else>{{ s.text }}</template>
        </template>
      </h2>
      <ul v-else-if="b.kind === 'list'">
        <li v-for="(item, j) in b.lines" :key="j">
          <template v-for="(s, k) in item[0]" :key="k">
            <a v-if="'url' in s" :href="s.url" target="_blank" rel="noopener noreferrer nofollow">{{ s.url }}</a><template v-else>{{ s.text }}</template>
          </template>
        </li>
      </ul>
      <component :is="b.kind === 'quote' ? 'blockquote' : 'p'" v-else>
        <template v-for="(line, j) in b.lines[0]" :key="j">
          <br v-if="j > 0" />
          <template v-for="(s, k) in line" :key="k">
            <a v-if="'url' in s" :href="s.url" target="_blank" rel="noopener noreferrer nofollow">{{ s.url }}</a><template v-else>{{ s.text }}</template>
          </template>
        </template>
      </component>
    </template>
  </div>
</template>

<style scoped>
.news-body {
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.news-body h2 {
  margin: 1.2em 0 0.4em;
}
.news-body p,
.news-body ul {
  margin: 0 0 0.9em;
}
.news-body blockquote {
  margin: 0 0 0.9em;
  padding-left: 1em;
  border-left: 3px solid var(--q-primary);
  font-style: italic;
}
</style>
