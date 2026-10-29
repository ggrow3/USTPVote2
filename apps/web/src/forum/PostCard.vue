<script setup lang="ts">
import { computed } from 'vue';
import type { ForumPostView, ForumVoteValue } from 'ustp-domain';
import { ago, ballotLine, commentsLine, goneText, KIND_LABELS } from './forum-text.js';
import VoteButtons from './VoteButtons.vue';

/** One post in a list (design §5.9): its votes beside it, its title, kind, who posted it and when, and the start of its text. */
const props = defineProps<{
  post: ForumPostView;
  /** Its page: the member's, or the console's. */
  to: string;
  /** Votes can be cast here (an Active member's list). */
  voting?: boolean;
}>();
const emit = defineEmits<{ vote: [value: ForumVoteValue] }>();
const title = computed(() => props.post.title || goneText(props.post.state));
</script>

<template>
  <q-card flat bordered class="forum-card" :class="{ 'forum-card--pinned': post.pinned }">
    <VoteButtons
      :score="post.score"
      :my-vote="post.myVote"
      :what="`“${title}”`"
      :disable="!voting || post.state !== 'visible'"
      @vote="(v) => emit('vote', v)"
    />
    <div class="forum-card__main">
      <div class="forum-card__flags">
        <q-badge v-if="post.pinned" color="green-8" class="forum-card__flag"><q-icon name="push_pin" size="12px" class="q-mr-xs" />Pinned</q-badge>
        <q-badge :color="post.kind === 'proposal' ? 'purple-7' : 'blue-grey-6'" :label="KIND_LABELS[post.kind]" class="forum-card__flag" />
        <q-badge v-if="post.lock" color="grey-8" class="forum-card__flag"><q-icon name="lock" size="12px" class="q-mr-xs" />Locked</q-badge>
        <q-badge v-for="b in post.ballots" :key="b.electionId" color="indigo-7" class="forum-card__flag">
          <q-icon name="how_to_vote" size="12px" class="q-mr-xs" />{{ ballotLine(b) }}
        </q-badge>
        <q-badge v-if="post.reports" color="orange-9" class="forum-card__flag">{{ post.reports }} {{ post.reports === 1 ? 'report' : 'reports' }}</q-badge>
      </div>
      <h3 class="text-subtitle1 forum-card__title">
        <router-link :to="to" class="forum-card__link" :class="{ 'text-grey-7': !post.title }">{{ title }}</router-link>
      </h3>
      <div class="text-caption text-grey-7">
        <template v-if="post.author">{{ post.author.name }}<template v-if="post.author.state"> ({{ post.author.state }})</template></template>
        <template v-else>[deleted]</template>
        · <time :datetime="post.createdAt" :title="new Date(post.createdAt).toLocaleString()">{{ ago(post.createdAt) }}</time>
      </div>
      <p v-if="post.body" class="forum-card__excerpt">{{ post.body }}</p>
      <router-link :to="to" class="forum-card__comments text-caption">
        <q-icon name="chat_bubble_outline" size="16px" class="q-mr-xs" />{{ commentsLine(post.comments) }}
      </router-link>
    </div>
  </q-card>
</template>

<style scoped>
.forum-card {
  display: flex;
  gap: 8px;
  padding: 8px 12px 8px 4px;
}
.forum-card--pinned {
  border-color: var(--q-positive, #2e7d32);
}
.forum-card__main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.forum-card__flags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.forum-card__flag {
  max-width: 100%;
  white-space: normal;
}
.forum-card__title {
  margin: 0;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.forum-card__link {
  color: inherit;
  text-decoration: none;
}
.forum-card__link:hover,
.forum-card__link:focus-visible {
  text-decoration: underline;
}
.forum-card__excerpt {
  margin: 4px 0 0;
  white-space: pre-line;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.forum-card__comments {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  margin-top: 4px;
  color: inherit;
  opacity: 0.75;
  text-decoration: none;
}
.forum-card__comments:hover,
.forum-card__comments:focus-visible {
  text-decoration: underline;
}
</style>
