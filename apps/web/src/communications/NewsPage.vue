<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { PublicNewsSummary } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { hubState } from '../governance/hub.js';
import { hubIcon } from '../governance/hub-icons.js';
import { FEEDS, newsList } from './api.js';
import CommsNav from './CommsNav.vue';
import { longDate, NEWS_KIND_NAMES } from './comms-text.js';

/**
 * News (design §10.9): the party's press releases, statements and news, newest first, for everyone. The party's
 * accounts from the hub's icon row, and the feeds for readers and bots.
 */
usePageTitle('News');
const posts = ref<PublicNewsSummary[] | null>(null);
const error = ref<string | null>(null);
const follow = computed(() => hubState.hub?.icons ?? []);

onMounted(async () => {
  try {
    posts.value = await newsList();
  } catch (e) {
    error.value = errorMessage(e);
  }
});
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <CommsNav />
      <div>
        <h1 class="text-h5 q-mb-xs">News</h1>
        <div class="text-grey-7">Press releases, statements and news from the party.</div>
      </div>
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!posts" class="text-grey-7">Loading…</div>
      <div v-else-if="posts.length === 0" class="text-grey-7">Nothing has been published yet.</div>
      <q-list v-else separator>
        <q-item v-for="p in posts" :key="p.slug" class="q-px-none news-item">
          <q-item-section>
            <q-item-label caption class="text-uppercase news-item__kind">{{ NEWS_KIND_NAMES[p.kind] }}</q-item-label>
            <q-item-label class="text-subtitle1 text-weight-medium">
              <router-link :to="`/news/${p.slug}`">{{ p.title }}</router-link>
            </q-item-label>
            <q-item-label caption>
              <time :datetime="p.publishedAt">{{ longDate(p.publishedAt) }}</time><template v-if="p.dateline"> · {{ p.dateline }}</template>
            </q-item-label>
            <q-item-label v-if="p.summary" class="q-mt-xs">{{ p.summary }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>

      <q-card flat bordered>
        <q-card-section>
          <h2 class="text-subtitle1">Follow the party</h2>
          <div v-if="follow.length" class="news-follow">
            <q-btn
              v-for="i in follow"
              :key="i.id"
              flat
              round
              :icon="hubIcon(i.icon)"
              :href="i.url"
              :target="i.url.startsWith('/') ? undefined : '_blank'"
              rel="noopener noreferrer"
              :aria-label="i.title"
            >
              <q-tooltip>{{ i.title }}</q-tooltip>
            </q-btn>
          </div>
          <div class="text-caption text-grey-7 q-mt-sm">
            Or follow the news itself in a feed reader:
            <a :href="FEEDS.rss">RSS</a> · <a :href="FEEDS.json">JSON Feed</a>. Journalists: see the
            <router-link to="/press">Press page</router-link>.
          </div>
        </q-card-section>
      </q-card>
    </div>
  </PageShell>
</template>

<style scoped>
.news-item__kind {
  letter-spacing: 0.06em;
}
.news-follow {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
