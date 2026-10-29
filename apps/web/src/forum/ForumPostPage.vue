<script setup lang="ts">
import { computed, provide, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  commentTree,
  FORUM_COMMENT_SORTS,
  FORUM_LIMITS,
  FORUM_REPORT_REASONS,
  type ForumCommentSort,
  type ForumCommentView,
  type ForumModerationAction,
  type ForumReportReason,
  type ForumTargetKind,
  type ForumThread,
  type ForumVoteValue,
} from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { askReason, attempt, dialog } from '../dialogs.js';
import { hasRole, session } from '../session.js';
import {
  addComment,
  deleteComment,
  deletePost,
  editComment,
  editPost,
  getThread,
  moderateComment,
  moderatePost,
  report,
  vote,
  type ForumMode,
} from './api.js';
import BallotDialog from './BallotDialog.vue';
import CommentNode from './CommentNode.vue';
import { ago, ballotLine, ballotLink, COMMENT_SORT_LABELS, goneText, KIND_LABELS, REPORT_REASON_LABELS } from './forum-text.js';
import PostEditor from './PostEditor.vue';
import PostText from './PostText.vue';
import { THREAD_ACTIONS } from './thread.js';
import VoteButtons from './VoteButtons.vue';

/**
 * One post and its comments (design §5.9). Active members vote, comment and reply, change or delete their own, and
 * report others'. Membership Admins also remove and restore, lock and pin; Election Admins put a proposal on a ballot.
 * At the console (`admin`) the same page shows what moderators see, removed text included, for staff without a
 * membership too; votes and comments are made on the member page.
 */
const props = defineProps<{ admin?: boolean }>();
const mode = computed<ForumMode>(() => (props.admin ? 'admin' : 'member'));
const route = useRoute();
const postId = computed(() => String(route.params.postId));

const thread = ref<ForumThread | null>(null);
const comments = ref<ForumCommentView[]>([]);
const error = ref<string | null>(null);
const notMember = ref(false);
const sort = ref<ForumCommentSort>('best');
const post = computed(() => thread.value?.post ?? null);
usePageTitle(() => post.value?.title || 'Forum');

const active = computed(() => session.me?.member?.status === 'active');
const interactive = computed(() => !props.admin && active.value);
const moderator = computed(() => hasRole('membership_admin'));
const electionAdmin = computed(() => hasRole('election_admin'));
const open = computed(() => post.value?.state === 'visible' && !post.value.lock);
const tree = computed(() => commentTree(comments.value, sort.value));
const op = computed(() => post.value?.author?.accountId ?? null);

async function load() {
  error.value = null;
  notMember.value = false;
  try {
    show(await getThread(mode.value, postId.value));
  } catch (e) {
    thread.value = null;
    if (e instanceof ApiError && e.status === 403 && !props.admin) notMember.value = true;
    else error.value = errorMessage(e);
  }
}
watch(postId, load, { immediate: true });

function show(t: ForumThread) {
  thread.value = t;
  comments.value = [...t.comments];
}

const replaceComment = (c: ForumCommentView) => {
  const i = comments.value.findIndex((x) => x.commentId === c.commentId);
  if (i >= 0) comments.value[i] = c;
  else comments.value.push(c);
};

const confirm = (title: string, message: string, ok: string) =>
  new Promise<boolean>((resolve) => {
    dialog({ title, message, cancel: true, ok: { label: ok, color: 'primary', noCaps: true, unelevated: true } })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false));
  });

// Votes show at once, then the counts as the API has them; a refused vote is put back.
async function votePost(value: ForumVoteValue) {
  const before = thread.value!.post;
  thread.value = { ...thread.value!, post: { ...before, myVote: value, score: before.score - before.myVote + value } };
  const ok = await attempt(async () => {
    const r = await vote('post', before.postId, value);
    thread.value = { ...thread.value!, post: { ...thread.value!.post, myVote: r.myVote, score: r.score } };
  });
  if (!ok) thread.value = { ...thread.value!, post: before };
}

async function voteComment(c: ForumCommentView, value: ForumVoteValue) {
  const up = c.up - (c.myVote === 1 ? 1 : 0) + (value === 1 ? 1 : 0);
  const down = c.down - (c.myVote === -1 ? 1 : 0) + (value === -1 ? 1 : 0);
  replaceComment({ ...c, myVote: value, up, down, score: up - down });
  const ok = await attempt(async () => {
    const r = await vote('comment', c.commentId, value);
    const now = comments.value.find((x) => x.commentId === c.commentId)!;
    replaceComment({ ...now, myVote: r.myVote, up: r.up, down: r.down, score: r.score });
  });
  if (!ok) replaceComment(c);
}

// Comments.
const draft = ref('');
const sending = ref(false);

async function send(parentId: string | null, body: string): Promise<boolean> {
  return attempt(async () => {
    replaceComment(await addComment(postId.value, { parentId, body: body.trim() }));
    if (thread.value) thread.value = { ...thread.value, post: { ...thread.value.post, comments: thread.value.post.comments + 1 } };
  });
}

async function comment() {
  if (!draft.value.trim()) return;
  sending.value = true;
  if (await send(null, draft.value)) draft.value = '';
  sending.value = false;
}

// Reports: why, and a note for the Membership Admins.
const reporting = reactive({ open: false, kind: 'post' as ForumTargetKind, id: '', what: '', reason: 'spam' as ForumReportReason, note: '' });
const reasons = FORUM_REPORT_REASONS.map((r) => ({ value: r, label: REPORT_REASON_LABELS[r] }));

function startReport(kind: ForumTargetKind, id: string, what: string) {
  Object.assign(reporting, { open: true, kind, id, what, reason: 'spam', note: '' });
}

async function sendReport() {
  const ok = await attempt(
    () => report(reporting.kind, reporting.id, { reason: reporting.reason, note: reporting.note.trim() || null }),
    'Reported to the Membership Admins',
  );
  if (ok) reporting.open = false;
}

provide(THREAD_ACTIONS, {
  interactive: () => interactive.value,
  open: () => open.value,
  moderator: () => moderator.value,
  vote: (c, value) => void voteComment(c, value),
  reply: (parent, body) => send(parent.commentId, body),
  edit: (c, body) => attempt(async () => replaceComment(await editComment(c.commentId, body.trim()))),
  remove: (c) => {
    void confirm('Delete your comment?', 'Its text is erased for good. Replies to it stay.', 'Delete').then(
      (ok) => ok && attempt(async () => replaceComment(await deleteComment(c.commentId)), 'Comment deleted'),
    );
  },
  report: (c) => startReport('comment', c.commentId, c.author ? `${c.author.name}’s comment` : 'this comment'),
  moderate: (c, action) => void moderateOne(c, action),
});

// The post: the author's changes, and moderation.
const editing = ref(false);

async function saveEdit(input: { title: string; body: string }) {
  show(await editPost(postId.value, { title: input.title, body: input.body }));
}

async function removeOwn() {
  if (!(await confirm('Delete your post?', 'Its title and text are erased for good, and it leaves the lists. Comments on it stay.', 'Delete'))) return;
  await attempt(async () => show(await deletePost(postId.value)), 'Post deleted');
}

const MODERATION: Readonly<Record<ForumModerationAction, { label: string; ask?: string; done: string }>> = {
  remove: { label: 'Remove', ask: 'Its author sees this reason; others see only that it was removed.', done: 'Post removed' },
  restore: { label: 'Restore', done: 'Post restored' },
  lock: { label: 'Lock the thread', ask: 'Everyone sees this reason; nobody can comment until you unlock it.', done: 'Thread locked' },
  unlock: { label: 'Unlock the thread', done: 'Thread unlocked' },
  pin: { label: 'Pin to the top', done: 'Post pinned' },
  unpin: { label: 'Unpin', done: 'Post unpinned' },
};

const postActions = computed(() => {
  const p = post.value;
  if (!p || !moderator.value) return [];
  const list: ForumModerationAction[] = [];
  if (p.state === 'visible') list.push(p.pinned ? 'unpin' : 'pin');
  list.push(p.lock ? 'unlock' : 'lock');
  if (p.state === 'visible') list.push('remove');
  if (p.state === 'removed') list.push('restore');
  return list;
});

async function moderate(action: ForumModerationAction) {
  const step = MODERATION[action];
  let reason: string | null = null;
  if (step.ask) {
    reason = await askReason(action === 'remove' ? 'Why remove this post?' : 'Why lock this thread?', step.ask);
    if (reason === null) return;
  }
  await attempt(async () => {
    const changed = await moderatePost(postId.value, { action, reason });
    if (props.admin) show(changed);
    else await load();
  }, step.done);
}

async function moderateOne(c: ForumCommentView, action: 'remove' | 'restore') {
  let reason: string | null = null;
  if (action === 'remove') {
    reason = await askReason('Why remove this comment?', 'Its author sees this reason; others see only that it was removed.');
    if (reason === null) return;
  }
  await attempt(async () => replaceComment(await moderateComment(c.commentId, { action, reason })), action === 'remove' ? 'Comment removed' : 'Comment restored');
}

const balloting = ref(false);
const canBallot = computed(() => electionAdmin.value && post.value?.kind === 'proposal' && post.value.state === 'visible');

const back = computed(() => (props.admin ? { path: '/admin', query: { tab: 'forum' } } : { path: '/forum' }));
const consoleLink = computed(() => `/admin/forum/posts/${encodeURIComponent(postId.value)}`);
const memberLink = computed(() => `/forum/${encodeURIComponent(postId.value)}`);
const sorts = FORUM_COMMENT_SORTS.map((s) => ({ value: s, label: COMMENT_SORT_LABELS[s] }));
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <q-btn flat dense no-caps icon="arrow_back" :label="admin ? 'Admin › Forum' : 'Forum'" :to="back" class="ustp-back" />
      <q-banner v-if="notMember" class="bg-blue-1 text-black" rounded>
        The forum is for Active members. <router-link v-if="!session.me?.member" to="/register">Apply to join the party</router-link
        ><template v-else>Your membership is not active now.</template>
        <template v-if="moderator || electionAdmin"> As a party officer, <router-link :to="consoleLink">open it at the console</router-link>.</template>
      </q-banner>
      <q-banner v-else-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!thread || !post" class="text-grey-7">Loading…</div>
      <template v-else>
        <q-banner v-if="admin" class="bg-grey-3 text-black" rounded>
          You are reading this at the console{{ moderator ? ', where removed text shows' : '' }}.
          <template v-if="active">To vote or comment, <router-link :to="memberLink">open it as a member</router-link>.</template>
        </q-banner>

        <article class="forum-post">
          <VoteButtons
            :score="post.score"
            :my-vote="post.myVote"
            what="this post"
            :disable="!interactive || post.state !== 'visible'"
            @vote="votePost"
          />
          <div class="forum-post__main">
            <div class="forum-post__flags">
              <q-badge v-if="post.pinned" color="green-8"><q-icon name="push_pin" size="12px" class="q-mr-xs" />Pinned</q-badge>
              <q-badge :color="post.kind === 'proposal' ? 'purple-7' : 'blue-grey-6'" :label="KIND_LABELS[post.kind]" />
              <q-badge v-if="post.reports" color="orange-9">{{ post.reports }} open {{ post.reports === 1 ? 'report' : 'reports' }}</q-badge>
            </div>
            <h1 class="text-h5 forum-post__title" :class="{ 'text-grey-7': !post.title }">{{ post.title || goneText(post.state) }}</h1>
            <div class="text-caption text-grey-7">
              <template v-if="post.author">{{ post.author.name }}<template v-if="post.author.state"> ({{ post.author.state }})</template></template>
              <template v-else>[deleted]</template>
              · <time :datetime="post.createdAt" :title="new Date(post.createdAt).toLocaleString()">{{ ago(post.createdAt) }}</time>
              <template v-if="post.editedAt"> · <span :title="new Date(post.editedAt).toLocaleString()">edited {{ ago(post.editedAt) }}</span></template>
            </div>

            <q-banner v-if="post.removal" class="bg-orange-1 text-black" rounded>
              {{ post.mine ? 'A Membership Admin removed your post' : 'Removed' }} {{ ago(post.removal.at) }}. Others see only that it
              was removed. Reason: “{{ post.removal.reason }}”
            </q-banner>
            <q-banner v-if="post.lock" class="bg-grey-3 text-black" rounded>
              <template #avatar><q-icon name="lock" /></template>
              Locked {{ ago(post.lock.at) }}, so nobody can comment. Reason: “{{ post.lock.reason }}”
            </q-banner>

            <PostEditor v-if="editing" editing :initial="post" :save="saveEdit" @done="editing = false" @cancel="editing = false" />
            <PostText v-else-if="post.body" :text="post.body" class="forum-post__body" />

            <ul v-if="post.ballots.length" class="forum-post__ballots">
              <li v-for="b in post.ballots" :key="`${b.electionId}-${b.contestId}`">
                <q-icon name="how_to_vote" class="q-mr-xs" />
                <router-link v-if="ballotLink(b)" :to="ballotLink(b)!">{{ ballotLine(b) }}</router-link>
                <template v-else>{{ ballotLine(b) }}</template>
                <span class="text-grey-7"> · added {{ ago(b.at) }}</span>
              </li>
            </ul>

            <div v-if="!editing" class="ustp-actions forum-post__actions">
              <template v-if="interactive && post.mine && post.state !== 'deleted'">
                <q-btn
                  v-if="post.state === 'visible'"
                  flat
                  dense
                  no-caps
                  icon="edit"
                  label="Edit"
                  :disable="post.ballots.length > 0"
                  :title="post.ballots.length ? 'It is on a ballot, which has its text as it was' : undefined"
                  @click="editing = true"
                />
                <q-btn flat dense no-caps icon="delete" label="Delete" @click="removeOwn" />
              </template>
              <q-btn
                v-if="interactive && !post.mine && post.state === 'visible'"
                flat
                dense
                no-caps
                icon="flag"
                label="Report"
                @click="startReport('post', post.postId, 'this post')"
              />
              <q-btn v-if="canBallot" unelevated dense no-caps color="indigo-7" icon="how_to_vote" label="Put on a ballot" @click="balloting = true" />
              <q-btn v-if="postActions.length" flat dense no-caps icon="shield" label="Moderate">
                <q-menu>
                  <q-list dense style="min-width: 200px">
                    <q-item v-for="a in postActions" :key="a" v-close-popup clickable @click="moderate(a)">
                      <q-item-section :class="{ 'text-negative': a === 'remove' }">{{ MODERATION[a].label }}</q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-btn>
            </div>
          </div>
        </article>

        <section class="ustp-stack" aria-labelledby="forum-comments">
          <div class="ustp-header">
            <h2 id="forum-comments" class="text-subtitle1">{{ post.comments === 1 ? '1 comment' : `${post.comments} comments` }}</h2>
            <q-select v-model="sort" dense outlined emit-value map-options :options="sorts" label="Sort by" class="forum-sort" />
          </div>
          <q-form v-if="interactive && open" class="ustp-form" @submit.prevent="comment">
            <q-input v-model="draft" outlined type="textarea" autogrow label="Add a comment" :maxlength="FORUM_LIMITS.comment" />
            <div class="ustp-actions">
              <q-btn unelevated no-caps color="primary" type="submit" label="Comment" :loading="sending" :disable="!draft.trim()" />
            </div>
          </q-form>
          <div v-if="!tree.length" class="text-grey-7">No comments yet.</div>
          <div v-else class="forum-comments">
            <CommentNode v-for="n in tree" :key="n.comment.commentId" :node="n" :op="op" />
          </div>
        </section>
      </template>
    </div>

    <q-dialog v-model="reporting.open" aria-label="Report">
      <q-card class="forum-dialog">
        <q-card-section>
          <h2 class="text-h6">Report {{ reporting.what }}</h2>
          <div class="text-caption text-grey-7">The Membership Admins see why; they do not see who reported it.</div>
        </q-card-section>
        <q-card-section class="ustp-form">
          <q-option-group v-model="reporting.reason" :options="reasons" type="radio" />
          <q-input v-model="reporting.note" outlined type="textarea" autogrow label="Anything they should know (optional)" :maxlength="FORUM_LIMITS.note" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Cancel" @click="reporting.open = false" />
          <q-btn unelevated no-caps color="primary" label="Report" @click="sendReport" />
        </q-card-actions>
      </q-card>
    </q-dialog>
    <BallotDialog v-if="post && canBallot" v-model="balloting" :post="post" @added="(t) => (admin ? show(t) : load())" />
  </PageShell>
</template>

<style scoped>
.forum-post {
  display: flex;
  gap: 8px;
}
.forum-post__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.forum-post__flags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.forum-post__title {
  margin: 0;
  overflow-wrap: anywhere;
}
.forum-post__ballots {
  margin: 0;
  padding: 0;
  list-style: none;
}
.forum-post__actions {
  margin-left: -8px;
}
.forum-sort {
  min-width: 140px;
}
.forum-comments {
  display: flex;
  flex-direction: column;
}
.forum-dialog {
  width: min(520px, 100vw - 32px);
}
</style>
