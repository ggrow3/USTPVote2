<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { newsItem, type PublicNewsPost } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { newsPost } from './api.js';
import CommsNav from './CommsNav.vue';
import { longDate, NEWS_KIND_NAMES, newsShareable } from './comms-text.js';
import NewsBody from './NewsBody.vue';
import ShareButtons from './ShareButtons.vue';

/** One news post (design §10.7), with share buttons; or, once withdrawn, a line saying so and when. */
const route = useRoute();
const post = ref<PublicNewsPost | null>(null);
const missing = ref(false);
const error = ref<string | null>(null);
usePageTitle(() => post.value?.title ?? 'News');

const published = computed(() => (post.value?.status === 'published' ? post.value : null));

watch(
  () => String(route.params.slug ?? ''),
  async (slug) => {
    post.value = null;
    missing.value = false;
    error.value = null;
    try {
      post.value = await newsPost(slug);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) missing.value = true;
      else error.value = errorMessage(e);
    }
  },
  { immediate: true },
);
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <CommsNav />
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="missing">
        <h1 class="text-h5">Not found</h1>
        <p>There is no news post at this address. <router-link to="/news">See all the news</router-link>.</p>
      </div>
      <div v-else-if="!post" class="text-grey-7">Loading…</div>
      <div v-else-if="post.status === 'withdrawn'">
        <h1 class="text-h5">{{ post.title }}</h1>
        <p>The party withdrew this post on {{ longDate(post.withdrawnAt) }}. <router-link to="/news">See the current news</router-link>.</p>
      </div>
      <article v-else-if="published">
        <div class="text-caption text-uppercase text-grey-7 news-post__kind">{{ NEWS_KIND_NAMES[published.kind] }}</div>
        <h1 class="text-h5 q-mt-xs q-mb-xs">{{ published.title }}</h1>
        <div class="text-caption text-grey-7">
          <time :datetime="published.publishedAt">{{ longDate(published.publishedAt) }}</time
          ><template v-if="published.editedAt"> · updated {{ longDate(published.editedAt) }}</template>
        </div>
        <p v-if="published.summary" class="text-subtitle1 q-mt-md">{{ published.summary }}</p>
        <p v-if="published.dateline" class="text-weight-bold q-mb-xs">{{ published.dateline }}</p>
        <NewsBody :body="published.body" />
        <div v-if="published.hashtags.length" class="text-grey-7 q-mb-md">
          <span v-for="t in published.hashtags" :key="t" class="q-mr-sm">#{{ t }}</span>
        </div>
        <q-separator class="q-my-md" />
        <h2 class="text-subtitle1">Share this</h2>
        <ShareButtons :item="newsShareable(published)" :count-as="newsItem(published.slug)" />
      </article>
    </div>
  </PageShell>
</template>

<style scoped>
.news-post__kind {
  letter-spacing: 0.06em;
}
</style>
