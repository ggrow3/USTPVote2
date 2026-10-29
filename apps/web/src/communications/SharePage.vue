<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { kitItem, type MemberSharePost } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { shareKit } from './api.js';
import CommsNav from './CommsNav.vue';
import { kitShareable, longDate } from './comms-text.js';
import ShareButtons from './ShareButtons.vue';

/**
 * The share kit (design §10.7): posts the communications team has written for Active members to share from their own
 * accounts. Each button opens that site with the post filled in; under it, what the site will make of it.
 */
usePageTitle('Share kit');
const posts = ref<MemberSharePost[] | null>(null);
const notMember = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    posts.value = await shareKit();
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notMember.value = true;
    else error.value = errorMessage(e);
  }
});
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <CommsNav />
      <div>
        <h1 class="text-h5 q-mb-xs">Share kit</h1>
        <div class="text-grey-7">
          Posts the party's communications team has written for members to share. Pick a site: it opens with the post
          filled in, and nothing is posted until you press Post there. Change the words as you like.
        </div>
      </div>
      <p v-if="notMember">
        The share kit is for Active members. Anyone can share the party's <router-link to="/news">news</router-link> from
        each post's page.
      </p>
      <q-banner v-else-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!posts" class="text-grey-7">Loading…</div>
      <div v-else-if="posts.length === 0" class="text-grey-7">Nothing to share right now. Check back soon.</div>
      <q-card v-for="p in posts ?? []" :key="p.shareId" flat bordered>
        <q-card-section>
          <h2 class="text-subtitle1">{{ p.title }}</h2>
          <div class="text-caption text-grey-7">
            Added {{ longDate(p.publishedAt) }}<template v-if="p.until"> · share until {{ longDate(`${p.until}T12:00:00Z`) }}</template>
          </div>
          <div v-if="p.note" class="q-mt-xs"><q-icon name="info" class="q-mr-xs" />{{ p.note }}</div>
        </q-card-section>
        <q-card-section>
          <blockquote class="share-text">
            {{ [p.text, ...p.hashtags.map((t) => `#${t}`)].join(' ') }}
            <div v-if="p.url" class="text-caption"><a :href="p.url" target="_blank" rel="noopener noreferrer">{{ p.url }}</a></div>
          </blockquote>
        </q-card-section>
        <q-card-section>
          <ShareButtons :item="kitShareable(p)" :count-as="kitItem(p.shareId)" fit />
        </q-card-section>
      </q-card>
    </div>
  </PageShell>
</template>

<style scoped>
.share-text {
  margin: 0;
  padding: 8px 12px;
  border-left: 3px solid var(--q-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
