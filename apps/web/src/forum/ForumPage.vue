<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { FORUM_FEEDS, FORUM_SORTS, type ForumFeed, type ForumPostView, type ForumSort, type ForumVoteValue } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { attempt } from '../dialogs.js';
import { session } from '../session.js';
import { createPost, listPosts, vote } from './api.js';
import { FEED_LABELS, SORT_ICONS, SORT_LABELS } from './forum-text.js';
import PostCard from './PostCard.vue';
import PostEditor from './PostEditor.vue';

/**
 * The forum (design §5.8), for Active members: discussions and proposals, hot, new or top first, with pinned posts on
 * top, and a new post. The sort and list are in the address, so a link or the back button keeps them.
 */
usePageTitle('Forum');
const route = useRoute();
const router = useRouter();
const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;
const sort = computed<ForumSort>(() => pick(route.query.sort, FORUM_SORTS, 'hot'));
const feed = computed<ForumFeed>(() => pick(route.query.feed, FORUM_FEEDS.filter((f) => f !== 'removed'), 'all'));

const pinned = ref<ForumPostView[]>([]);
const posts = ref<ForumPostView[] | null>(null);
const next = ref<string | null>(null);
const error = ref<string | null>(null);
const notMember = ref(false);
const loadingMore = ref(false);
const writing = ref(false);
const active = computed(() => session.me?.member?.status === 'active');

async function load() {
  error.value = null;
  try {
    const page = await listPosts('member', { sort: sort.value, feed: feed.value });
    pinned.value = [...page.pinned];
    posts.value = [...page.posts];
    next.value = page.next;
  } catch (e) {
    posts.value = null;
    if (e instanceof ApiError && e.status === 403) notMember.value = true;
    else error.value = errorMessage(e);
  }
}
watch([sort, feed], load, { immediate: true });

async function more() {
  loadingMore.value = true;
  await attempt(async () => {
    const page = await listPosts('member', { sort: sort.value, feed: feed.value, after: next.value });
    const seen = new Set(posts.value?.map((p) => p.postId));
    posts.value = [...(posts.value ?? []), ...page.posts.filter((p) => !seen.has(p.postId))];
    next.value = page.next;
  });
  loadingMore.value = false;
}

const show = (query: { sort?: ForumSort; feed?: ForumFeed }) =>
  router.replace({ query: { ...route.query, ...query, ...(query.sort === 'hot' && { sort: undefined }), ...(query.feed === 'all' && { feed: undefined }) } });

/** Shows the vote at once, then the counts as the API has them; puts it back if refused. */
async function cast(post: ForumPostView, value: ForumVoteValue) {
  const replace = (changed: Partial<ForumPostView>) => {
    for (const list of [pinned.value, posts.value ?? []]) {
      const i = list.findIndex((p) => p.postId === post.postId);
      if (i >= 0) list[i] = { ...list[i]!, ...changed };
    }
  };
  replace({ myVote: value, score: post.score - post.myVote + value });
  const ok = await attempt(async () => {
    const result = await vote('post', post.postId, value);
    replace({ myVote: result.myVote, score: result.score });
  });
  if (!ok) replace({ myVote: post.myVote, score: post.score });
}

async function save(input: Parameters<typeof createPost>[0]) {
  const thread = await createPost(input);
  await router.push(`/forum/${encodeURIComponent(thread.post.postId)}`);
}

const postLink = (p: ForumPostView) => `/forum/${encodeURIComponent(p.postId)}`;
const feeds = FORUM_FEEDS.filter((f) => f !== 'removed');
const sorts = FORUM_SORTS.map((value) => ({ value, label: SORT_LABELS[value], icon: SORT_ICONS[value] }));
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <div class="ustp-header">
        <div>
          <h1 class="text-h5 q-mb-xs">Forum</h1>
          <div class="text-grey-7">
            Talk things over with other members and propose what the party should adopt. Vote posts and comments up or
            down: everyone sees the score, nobody sees how you voted. Votes here decide nothing; an Election Admin may
            put a proposal on a ballot.
          </div>
        </div>
        <div v-if="posts && !writing" class="ustp-actions">
          <q-btn unelevated no-caps color="primary" icon="edit" label="New post" @click="writing = true" />
        </div>
      </div>

      <q-banner v-if="notMember || (session.me && !active)" class="bg-blue-1 text-black" rounded>
        The forum is for Active members. <router-link v-if="!session.me?.member" to="/register">Apply to join the party</router-link
        ><template v-else>Your membership is not active now.</template>
      </q-banner>
      <q-banner v-else-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <template v-else>
        <q-card v-if="writing" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1 q-mb-sm">New post</h2>
            <PostEditor :save="save" @cancel="writing = false" />
          </q-card-section>
        </q-card>

        <div class="forum-controls">
          <q-tabs :model-value="feed" dense no-caps inline-label active-color="primary" align="left" class="forum-controls__feeds" @update:model-value="(f: ForumFeed) => show({ feed: f })">
            <q-tab v-for="f in feeds" :key="f" :name="f" :label="FEED_LABELS[f]" />
          </q-tabs>
          <q-btn-toggle
            :model-value="sort"
            dense
            no-caps
            unelevated
            toggle-color="primary"
            aria-label="Sort posts"
            :options="sorts"
            @update:model-value="(s: ForumSort) => show({ sort: s })"
          />
        </div>

        <div v-if="!posts" class="text-grey-7">Loading…</div>
        <div v-else-if="!posts.length && !pinned.length" class="text-grey-7">
          Nothing here yet. <a href="#" @click.prevent="writing = true">Start the conversation</a>.
        </div>
        <div v-else class="forum-list">
          <PostCard v-for="p in pinned" :key="`pin-${p.postId}`" :post="p" :to="postLink(p)" voting @vote="(v) => cast(p, v)" />
          <PostCard v-for="p in posts" :key="p.postId" :post="p" :to="postLink(p)" voting @vote="(v) => cast(p, v)" />
        </div>
        <q-btn v-if="next" flat no-caps color="primary" label="Show more" :loading="loadingMore" @click="more" />
      </template>
    </div>
  </PageShell>
</template>

<style scoped>
.forum-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.forum-controls__feeds {
  min-width: 0;
}
.forum-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
