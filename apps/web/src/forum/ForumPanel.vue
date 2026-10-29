<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { ForumPostView, ForumReportGroup, ForumReportReason } from 'ustp-domain';
import { askReason, attempt } from '../dialogs.js';
import { hasRole } from '../session.js';
import { dismissReports, listPosts, listReports, moderateComment, moderatePost } from './api.js';
import { ago, REPORT_REASON_LABELS } from './forum-text.js';
import PostCard from './PostCard.vue';

/**
 * The forum at the console (design §5.9). Membership Admins see what members reported, grouped by post or comment
 * without who reported it, and remove it or dismiss the reports, and the posts removed so far. Election Admins see the
 * proposals members support most, to put one on a ballot from its page.
 */
const moderator = hasRole('membership_admin');
const electionAdmin = hasRole('election_admin');
const reports = ref<ForumReportGroup[] | null>(null);
const removed = ref<ForumPostView[] | null>(null);
const proposals = ref<ForumPostView[] | null>(null);

async function load() {
  await attempt(async () => {
    const [r, gone, top] = await Promise.all([
      moderator ? listReports() : Promise.resolve(null),
      moderator ? listPosts('admin', { feed: 'removed', sort: 'new' }) : Promise.resolve(null),
      electionAdmin ? listPosts('admin', { feed: 'proposal', sort: 'top' }) : Promise.resolve(null),
    ]);
    reports.value = r;
    removed.value = gone && [...gone.posts];
    proposals.value = top && [...top.pinned, ...top.posts].sort((a, b) => b.score - a.score);
  });
}
onMounted(load);

const consolePage = (postId: string) => `/admin/forum/posts/${encodeURIComponent(postId)}`;
const reasonsLine = (g: ForumReportGroup) =>
  Object.entries(g.reasons)
    .map(([reason, n]) => `${REPORT_REASON_LABELS[reason as ForumReportReason]}${n > 1 ? ` ×${n}` : ''}`)
    .join(', ');

async function remove(g: ForumReportGroup) {
  const reason = await askReason(
    g.targetKind === 'post' ? 'Why remove this post?' : 'Why remove this comment?',
    'Its author sees this reason; others see only that it was removed. The reports on it are closed.',
  );
  if (reason === null) return;
  const ok = await attempt(
    () =>
      g.targetKind === 'post'
        ? moderatePost(g.targetId, { action: 'remove', reason })
        : moderateComment(g.targetId, { action: 'remove', reason }),
    g.targetKind === 'post' ? 'Post removed' : 'Comment removed',
  );
  if (ok) await load();
}

async function dismiss(g: ForumReportGroup) {
  if (await attempt(() => dismissReports(g.targetKind, g.targetId), 'Reports dismissed')) await load();
}
</script>

<template>
  <div class="ustp-content">
    <p class="text-grey-7">
      Active members talk things over and propose what the party should adopt on the <router-link to="/forum">Forum</router-link>.
      <template v-if="moderator">
        You moderate it: remove posts and comments with a reason their author sees, lock threads and pin posts. Each
        action is recorded in the ledger for Auditors.
      </template>
      <template v-if="electionAdmin">
        Forum votes decide nothing: open a proposal to put it on a draft election's ballot.
      </template>
    </p>

    <section v-if="moderator" class="ustp-stack">
      <h2 class="text-subtitle1">Reported</h2>
      <div v-if="!reports" class="text-grey-7">Loading…</div>
      <div v-else-if="!reports.length" class="text-grey-7">Nothing is waiting.</div>
      <q-list v-else bordered separator class="rounded-borders">
        <q-item v-for="g in reports" :key="`${g.targetKind}-${g.targetId}`">
          <q-item-section>
            <q-item-label>
              <q-badge color="orange-9" class="q-mr-xs">{{ g.count }}</q-badge>
              <template v-if="g.comment">A comment by {{ g.comment.author?.name ?? '[deleted]' }} on </template>
              <router-link :to="consolePage(g.postId)">{{ g.post.title || '[no title]' }}</router-link>
              <template v-if="!g.comment"> by {{ g.post.author?.name ?? '[deleted]' }}</template>
            </q-item-label>
            <q-item-label caption>{{ reasonsLine(g) }} · first {{ ago(g.firstAt) }}</q-item-label>
            <q-item-label v-if="g.comment" caption class="forum-quote">{{ g.comment.body }}</q-item-label>
            <q-item-label v-for="(note, i) in g.notes" :key="i" caption class="forum-quote">“{{ note }}”</q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="ustp-actions">
              <q-btn flat dense no-caps color="negative" label="Remove" @click="remove(g)" />
              <q-btn flat dense no-caps label="Dismiss" @click="dismiss(g)" />
            </div>
          </q-item-section>
        </q-item>
      </q-list>
    </section>

    <section v-if="electionAdmin" class="ustp-stack">
      <h2 class="text-subtitle1">Proposals, most supported first</h2>
      <div v-if="!proposals" class="text-grey-7">Loading…</div>
      <div v-else-if="!proposals.length" class="text-grey-7">Nobody has proposed anything yet.</div>
      <div v-else class="forum-list">
        <PostCard v-for="p in proposals" :key="p.postId" :post="p" :to="consolePage(p.postId)" />
      </div>
    </section>

    <section v-if="moderator" class="ustp-stack">
      <h2 class="text-subtitle1">Removed posts</h2>
      <div v-if="!removed" class="text-grey-7">Loading…</div>
      <div v-else-if="!removed.length" class="text-grey-7">None.</div>
      <div v-else class="forum-list">
        <PostCard v-for="p in removed" :key="p.postId" :post="p" :to="consolePage(p.postId)" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.forum-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.forum-quote {
  white-space: pre-line;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
