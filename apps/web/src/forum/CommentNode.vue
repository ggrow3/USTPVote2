<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { FORUM_LIMITS, type ForumCommentNode } from 'ustp-domain';
import { ago, goneText } from './forum-text.js';
import PostText from './PostText.vue';
import { THREAD_ACTIONS } from './thread.js';
import VoteButtons from './VoteButtons.vue';

/**
 * One comment and its replies (design §5.8): who wrote it and when, its score and the viewer's vote, and replying,
 * changing one's own, reporting, and for Membership Admins removing or restoring. A thread line beside the replies
 * collapses them.
 */
const props = defineProps<{ node: ForumCommentNode; op: string | null }>();
const actions = inject(THREAD_ACTIONS)!;
const c = computed(() => props.node.comment);
const collapsed = ref(false);
const replying = ref(false);
const editing = ref(false);
const draft = ref('');
const busy = ref(false);

const shown = computed(() => c.value.body !== '');
const what = computed(() => (c.value.author ? `${c.value.author.name}’s comment` : 'this comment'));
const canReply = computed(() => actions.interactive() && actions.open() && c.value.state === 'visible' && c.value.depth < FORUM_LIMITS.depth);
const count = (nodes: readonly ForumCommentNode[]): number => nodes.reduce((n, r) => n + 1 + count(r.replies), 0);
/** Replies at every depth, for the collapsed line. */
const replies = computed(() => count(props.node.replies));

function startReply() {
  draft.value = '';
  replying.value = true;
}

function startEdit() {
  draft.value = c.value.body;
  editing.value = true;
}

async function send() {
  if (!draft.value.trim()) return;
  busy.value = true;
  const ok = editing.value ? await actions.edit(c.value, draft.value) : await actions.reply(c.value, draft.value);
  busy.value = false;
  if (ok) replying.value = editing.value = false;
}
</script>

<template>
  <div class="forum-comment">
    <div class="forum-comment__head text-caption">
      <q-btn
        flat
        dense
        round
        size="xs"
        :icon="collapsed ? 'add_circle_outline' : 'remove_circle_outline'"
        :aria-label="collapsed ? `Show ${what}${replies ? ` and ${replies} ${replies === 1 ? 'reply' : 'replies'}` : ''}` : `Hide ${what}`"
        :aria-expanded="!collapsed"
        @click="collapsed = !collapsed"
      />
      <strong v-if="c.author">{{ c.author.name }}</strong><span v-else class="text-grey-7">[deleted]</span>
      <q-badge v-if="c.author && c.author.accountId === op" color="primary" label="OP" class="q-ml-xs" title="Wrote the post" />
      <span v-if="c.author?.state" class="text-grey-7">&nbsp;({{ c.author.state }})</span>
      <span class="text-grey-7">&nbsp;· <time :datetime="c.createdAt" :title="new Date(c.createdAt).toLocaleString()">{{ ago(c.createdAt) }}</time></span>
      <span v-if="c.editedAt" class="text-grey-7" :title="`Edited ${new Date(c.editedAt).toLocaleString()}`">&nbsp;· edited</span>
      <span v-if="collapsed" class="text-grey-7">
        &nbsp;· {{ c.score }} {{ Math.abs(c.score) === 1 ? 'point' : 'points' }}<template v-if="replies"> · {{ replies }} {{ replies === 1 ? 'reply' : 'replies' }} hidden</template>
      </span>
      <q-badge v-if="c.reports" color="orange-9" class="q-ml-xs">{{ c.reports }} {{ c.reports === 1 ? 'report' : 'reports' }}</q-badge>
    </div>

    <div v-show="!collapsed" class="forum-comment__body">
      <q-banner v-if="c.removal" dense class="bg-orange-1 text-black q-mb-xs" rounded>
        {{ c.mine ? 'A Membership Admin removed your comment.' : 'Removed.' }} Others see only that it was removed. Reason: “{{ c.removal.reason }}”
      </q-banner>
      <q-form v-if="editing" class="ustp-form" @submit.prevent="send">
        <q-input v-model="draft" outlined type="textarea" autogrow autofocus label="Your comment" :maxlength="FORUM_LIMITS.comment" />
        <div class="ustp-actions">
          <q-btn unelevated dense no-caps color="primary" type="submit" label="Save" :loading="busy" />
          <q-btn flat dense no-caps label="Cancel" @click="editing = false" />
        </div>
      </q-form>
      <PostText v-else-if="shown" :text="c.body" />
      <div v-else class="text-grey-7">{{ goneText(c.state) }}</div>

      <div v-if="!editing" class="forum-comment__actions">
        <VoteButtons
          row
          :score="c.score"
          :my-vote="c.myVote"
          :what="what"
          :disable="!actions.interactive() || c.state !== 'visible'"
          @vote="(v) => actions.vote(c, v)"
        />
        <q-btn v-if="canReply" flat dense no-caps size="sm" icon="reply" label="Reply" @click="startReply">
          <span class="sr-only">&nbsp;to {{ what }}</span>
        </q-btn>
        <template v-if="actions.interactive() && c.mine && c.state !== 'deleted'">
          <q-btn v-if="c.state === 'visible'" flat dense no-caps size="sm" label="Edit" @click="startEdit">
            <span class="sr-only">&nbsp;your comment</span>
          </q-btn>
          <q-btn flat dense no-caps size="sm" label="Delete" @click="actions.remove(c)">
            <span class="sr-only">&nbsp;your comment</span>
          </q-btn>
        </template>
        <q-btn v-if="actions.interactive() && !c.mine && c.state === 'visible'" flat dense no-caps size="sm" label="Report" @click="actions.report(c)">
          <span class="sr-only">&nbsp;{{ what }}</span>
        </q-btn>
        <template v-if="actions.moderator()">
          <q-btn v-if="c.state === 'visible'" flat dense no-caps size="sm" color="negative" label="Remove" @click="actions.moderate(c, 'remove')">
            <span class="sr-only">&nbsp;{{ what }}</span>
          </q-btn>
          <q-btn v-else-if="c.state === 'removed'" flat dense no-caps size="sm" color="positive" label="Restore" @click="actions.moderate(c, 'restore')">
            <span class="sr-only">&nbsp;{{ what }}</span>
          </q-btn>
        </template>
      </div>

      <q-form v-if="replying" class="ustp-form q-mt-sm" @submit.prevent="send">
        <q-input v-model="draft" outlined type="textarea" autogrow autofocus :label="`Reply to ${c.author?.name ?? 'this comment'}`" :maxlength="FORUM_LIMITS.comment" />
        <div class="ustp-actions">
          <q-btn unelevated dense no-caps color="primary" type="submit" label="Reply" :loading="busy" :disable="!draft.trim()" />
          <q-btn flat dense no-caps label="Cancel" @click="replying = false" />
        </div>
      </q-form>

      <div v-if="node.replies.length" class="forum-comment__replies">
        <CommentNode v-for="r in node.replies" :key="r.comment.commentId" :node="r" :op="op" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.forum-comment {
  padding-top: 8px;
}
.forum-comment__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  margin-left: -6px;
}
.forum-comment__body {
  padding-left: 10px;
  margin-left: 4px;
  border-left: 2px solid rgba(128, 128, 128, 0.35);
}
.forum-comment__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  margin-left: -6px;
}
.forum-comment__replies {
  padding-left: 4px;
}
</style>
