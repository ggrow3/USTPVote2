import { z } from 'zod';
import { OK, refuse, type Check, type Outcome } from '../check.js';
import { passRuleSchema, quorumSchema } from '../election-api.js';
import type { LedgerEvent } from '../ledger-events.js';

/**
 * The forum (design §5.9): Active members post discussions and proposals, reply in threads and vote posts and comments
 * up or down, Reddit-style. Each member has one vote per post or comment, which they can change or take back; everyone
 * sees the score, nobody sees who voted. Membership Admins moderate: remove (with a reason the author sees) and restore
 * posts and comments, lock and pin threads. An Election Admin can put a proposal on a draft election's ballot, which
 * freezes its text as a proposal snapshot (§6.4); forum votes themselves decide nothing.
 */

export const FORUM_POST_KINDS = ['discussion', 'proposal'] as const;
export type ForumPostKind = (typeof FORUM_POST_KINDS)[number];

/** How a list of posts is ordered: by `hotRank`, newest first, or by score. */
export const FORUM_SORTS = ['hot', 'new', 'top'] as const;
export type ForumSort = (typeof FORUM_SORTS)[number];

/** Which posts a list holds: every visible post, one kind, or (Membership Admins only) those removed. */
export const FORUM_FEEDS = ['all', 'discussion', 'proposal', 'removed'] as const;
export type ForumFeed = (typeof FORUM_FEEDS)[number];

/** How a thread's comments are ordered: by `confidence` (best), by score, newest or oldest first. */
export const FORUM_COMMENT_SORTS = ['best', 'top', 'new', 'old'] as const;
export type ForumCommentSort = (typeof FORUM_COMMENT_SORTS)[number];

export const FORUM_REPORT_REASONS = ['spam', 'harassment', 'off_topic', 'misleading', 'other'] as const;
export type ForumReportReason = (typeof FORUM_REPORT_REASONS)[number];

export const FORUM_MODERATION_ACTIONS = ['remove', 'restore', 'lock', 'unlock', 'pin', 'unpin'] as const;
export type ForumModerationAction = (typeof FORUM_MODERATION_ACTIONS)[number];

export const FORUM_LIMITS = {
  title: 200,
  body: 40_000,
  comment: 10_000,
  reason: 500,
  note: 500,
  /** Replies nest this deep at most: a top-level comment is depth 0. */
  depth: 8,
  /** Posts on each page of a list. */
  page: 25,
  /** How much of a post's text a list shows. */
  excerpt: 400,
  /** Comments a thread loads; a thread longer than this shows its first ones by time. */
  thread: 2000,
  /** Per member, in any 24 hours. */
  postsPerDay: 10,
  commentsPerDay: 200,
} as const;

/** A post or comment: shown, taken down by a Membership Admin, or deleted by its author (its text erased). */
export type ForumState = 'visible' | 'removed' | 'deleted';

const text = (max: number) => z.string().trim().max(max, `at most ${max} characters`);
/** Blank is none. */
const optionalText = (max: number) =>
  text(max)
    .nullable()
    .default(null)
    .transform((v) => v || null);
const id = z.string().trim().min(1).max(64);

const postShape = {
  title: text(FORUM_LIMITS.title).min(1, 'enter a title'),
  body: text(FORUM_LIMITS.body).default(''),
};

/** `POST /v1/forum/posts`. A proposal needs its text: it is what would go on a ballot. */
export const createPostSchema = z
  .strictObject({ kind: z.enum(FORUM_POST_KINDS), ...postShape })
  .refine((p) => p.kind !== 'proposal' || p.body.length > 0, { path: ['body'], message: 'write the proposal’s text' });
export type CreatePostInput = z.infer<typeof createPostSchema>;

/** `PUT /v1/forum/posts/{postId}`: the author's new title and text; the kind stays. */
export const editPostSchema = z.strictObject(postShape);
export type EditPostInput = z.infer<typeof editPostSchema>;

/** `POST /v1/forum/posts/{postId}/comments`: a comment on the post, or a reply to one of its comments. */
export const createCommentSchema = z.strictObject({
  parentId: id.nullable().default(null),
  body: text(FORUM_LIMITS.comment).min(1, 'write a comment'),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

/** `PUT /v1/forum/comments/{commentId}`. */
export const editCommentSchema = createCommentSchema.pick({ body: true });
export type EditCommentInput = z.infer<typeof editCommentSchema>;

/** `PUT …/vote`: up, down, or 0 to take the vote back. */
export const forumVoteSchema = z.strictObject({ value: z.union([z.literal(1), z.literal(0), z.literal(-1)]) });
export type ForumVoteValue = z.infer<typeof forumVoteSchema>['value'];

/** `POST …/report`: why a member thinks a Membership Admin should look at a post or comment. */
export const forumReportSchema = z.strictObject({
  reason: z.enum(FORUM_REPORT_REASONS),
  note: optionalText(FORUM_LIMITS.note),
});
export type ForumReportInput = z.infer<typeof forumReportSchema>;

/** A Membership Admin's action on a post (any) or comment (remove and restore). Removing or locking needs a reason. */
export const moderationSchema = z
  .strictObject({ action: z.enum(FORUM_MODERATION_ACTIONS), reason: optionalText(FORUM_LIMITS.reason) })
  .refine((m) => !(m.action === 'remove' || m.action === 'lock') || m.reason, {
    path: ['reason'],
    message: 'give a reason: it is shown with the post',
  });
export type ModerationInput = z.infer<typeof moderationSchema>;

/** `POST /v1/admin/forum/reports/dismiss`: closes the open reports on a post or comment without acting on it. */
export const dismissReportsSchema = z.strictObject({ targetKind: z.enum(['post', 'comment']), targetId: id });
export type DismissReportsInput = z.infer<typeof dismissReportsSchema>;

/**
 * `POST /v1/admin/forum/posts/{postId}/ballot`: an Election Admin puts the proposal on a draft election as a proposal
 * question, under the post's title unless they give another, with its pass rule and an optional quorum.
 */
export const forumBallotSchema = z.strictObject({
  electionId: id,
  title: optionalText(200),
  passRule: passRuleSchema,
  quorum: quorumSchema.optional(),
});
export type ForumBallotInput = z.infer<typeof forumBallotSchema>;

/** `GET /v1/forum/posts` (and `/v1/admin/forum/posts`). */
export const forumListQuerySchema = z.strictObject({
  sort: z.enum(FORUM_SORTS).default('hot'),
  feed: z.enum(FORUM_FEEDS).default('all'),
  /** The last post of the page before. */
  after: id.optional(),
});
export type ForumListQuery = z.infer<typeof forumListQuerySchema>;

/** Why a post or comment was taken down, or a thread locked: shown with it. */
export interface ForumModeration {
  readonly at: string;
  readonly by: string;
  readonly reason: string;
}

/** An election a proposal was put on: the snapshot frozen from its text then, and the question it is. */
export interface ForumBallotLink {
  readonly electionId: string;
  /** The election's title when it was put there. */
  readonly electionTitle: string;
  readonly contestId: string;
  readonly snapshotId: string;
  readonly contentHash: string;
  readonly at: string;
  readonly by: string;
}

/** What votes add up to on a post or comment. */
export interface ForumTally {
  readonly up: number;
  readonly down: number;
  /** `up - down`. */
  readonly score: number;
}

/** `forum_posts/{postId}` */
export interface ForumPostRecord extends ForumTally {
  readonly postId: string;
  readonly kind: ForumPostKind;
  /** Empty once the author deletes the post. */
  readonly title: string;
  readonly body: string;
  readonly authorId: string;
  readonly createdAt: string;
  readonly editedAt: string | null;
  /** `hotRank` of the score and creation time, kept with each vote so lists can be ordered by it. */
  readonly hot: number;
  /** Comments made on it, whatever became of them. */
  readonly comments: number;
  readonly lastCommentAt: string | null;
  readonly pinned: boolean;
  /** Set while the thread is locked: nobody comments, and the reason is shown. */
  readonly lock: ForumModeration | null;
  readonly state: ForumState;
  /** Set while a Membership Admin has it removed. */
  readonly removal: ForumModeration | null;
  readonly deletedAt: string | null;
  /** The lists it is in (`feedsOf`), so each list is one query. */
  readonly feeds: readonly ForumFeed[];
  /** Elections it was put on, oldest first. */
  readonly ballots: readonly ForumBallotLink[];
}

/** `forum_comments/{commentId}` */
export interface ForumCommentRecord extends ForumTally {
  readonly commentId: string;
  readonly postId: string;
  /** The comment it replies to, or null for a comment on the post. */
  readonly parentId: string | null;
  readonly depth: number;
  /** Empty once the author deletes it. */
  readonly body: string;
  readonly authorId: string;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly state: ForumState;
  readonly removal: ForumModeration | null;
  readonly deletedAt: string | null;
}

export type ForumTargetKind = 'post' | 'comment';

/** `forum_votes/{voteId}`: one member's vote on a post or comment. Never shown to anyone but them. */
export interface ForumVoteRecord {
  readonly targetKind: ForumTargetKind;
  readonly targetId: string;
  readonly postId: string;
  readonly accountId: string;
  readonly value: 1 | -1;
  readonly at: string;
}

export type ForumReportStatus = 'open' | 'dismissed' | 'actioned';

/** `forum_reports/{reportId}`: one member's report of a post or comment; reporting it again replaces it. */
export interface ForumReportRecord {
  readonly reportId: string;
  readonly targetKind: ForumTargetKind;
  readonly targetId: string;
  readonly postId: string;
  readonly accountId: string;
  readonly reason: ForumReportReason;
  readonly note: string | null;
  readonly at: string;
  readonly status: ForumReportStatus;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
}

/** IDs of votes and reports: one per member per post or comment (post and comment IDs have no underscore). */
export const forumVoteId = (targetKind: ForumTargetKind, targetId: string, accountId: string) => `${targetKind}_${targetId}_${accountId}`;
export const forumReportId = forumVoteId;

/** `forum.moderated`: a Membership Admin's action, with the author as subject (Auditors only). */
export interface ForumModeratedPayload {
  readonly target: ForumTargetKind;
  readonly postId: string;
  readonly commentId: string | null;
  readonly action: 'removed' | 'restored' | 'locked' | 'unlocked' | 'pinned' | 'unpinned';
  readonly reason: string | null;
}

/** Hot ranks count from here, so they stay small numbers. */
const HOT_EPOCH = Date.parse('2026-01-01T00:00:00Z') / 1000;

/**
 * Reddit's hot rank: each tenfold of score is worth 12.5 hours of age, so a new post with a few votes rises above an
 * older one with more. It depends only on the score and when the post was made, so it changes only with votes.
 */
export function hotRank(score: number, createdAt: string): number {
  const order = Math.log10(Math.max(Math.abs(score), 1));
  const seconds = Date.parse(createdAt) / 1000 - HOT_EPOCH;
  return Math.round((Math.sign(score) * order + seconds / 45_000) * 1e7) / 1e7;
}

/**
 * How sure we can be that a comment is liked, from its votes: the lower bound of the Wilson score interval (80%), so a
 * comment with 10 up and 1 down ranks above one with 1 up and none down. "Best", as Reddit sorts comments.
 */
export function confidence(up: number, down: number): number {
  const n = up + down;
  if (n === 0) return 0;
  const z = 1.281551565545;
  const p = up / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n);
}

/** The lists a post is in: all and its kind's while visible, Removed while removed, none once deleted. */
export function feedsOf(post: Pick<ForumPostRecord, 'state' | 'kind'>): ForumFeed[] {
  if (post.state === 'visible') return ['all', post.kind];
  return post.state === 'removed' ? ['removed'] : [];
}

/** A new post, with its author's upvote (as on Reddit; they can take it back). */
export function newPost(input: CreatePostInput, postId: string, authorId: string, at: string): { post: ForumPostRecord; vote: ForumVoteRecord } {
  const post: ForumPostRecord = {
    postId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    authorId,
    createdAt: at,
    editedAt: null,
    up: 1,
    down: 0,
    score: 1,
    hot: hotRank(1, at),
    comments: 0,
    lastCommentAt: null,
    pinned: false,
    lock: null,
    state: 'visible',
    removal: null,
    deletedAt: null,
    feeds: feedsOf({ state: 'visible', kind: input.kind }),
    ballots: [],
  };
  return { post, vote: { targetKind: 'post', targetId: postId, postId, accountId: authorId, value: 1, at } };
}

const notFound = (what: ForumTargetKind) => refuse('not_found', what === 'post' ? 'no such post' : 'no such comment');
const GONE = { removed: 'a Membership Admin removed it', deleted: 'its author deleted it' } as const;

function authorsOwn<T extends { authorId: string; state: ForumState }>(item: T | null, kind: ForumTargetKind, actor: string): Outcome<T> {
  if (!item || item.state === 'deleted') return notFound(kind);
  if (item.authorId !== actor) return refuse('forbidden', `only its author changes a ${kind}`);
  return { ok: true, value: item };
}

/**
 * The author's new title and text. A removed post stays as it is, and so does a proposal on a ballot, whose text the
 * ballot has as it was then. Null when nothing changed.
 */
export function editPost(post: ForumPostRecord | null, input: EditPostInput, actor: string, at: string): Outcome<ForumPostRecord | null> {
  const own = authorsOwn(post, 'post', actor);
  if (!own.ok) return own;
  const p = own.value;
  if (p.state === 'removed') return refuse('conflict', `you cannot change it: ${GONE.removed}`);
  if (p.ballots.length) return refuse('conflict', 'it is on a ballot, which has its text as it was then, so it cannot change; post again instead');
  if (p.kind === 'proposal' && !input.body) return refuse('conflict', 'a proposal needs its text');
  if (p.title === input.title && p.body === input.body) return { ok: true, value: null };
  return { ok: true, value: { ...p, title: input.title, body: input.body, editedAt: at } };
}

/**
 * The author deletes the post: its title and text are erased and it leaves every list, while its comments and any
 * ballots it was put on stay.
 */
export function deletePost(post: ForumPostRecord | null, actor: string, at: string): Outcome<ForumPostRecord> {
  const own = authorsOwn(post, 'post', actor);
  if (!own.ok) return own;
  const deleted = { ...own.value, title: '', body: '', state: 'deleted' as const, deletedAt: at, pinned: false };
  return { ok: true, value: { ...deleted, feeds: feedsOf(deleted) } };
}

/** The author's new text for their comment; null when nothing changed. */
export function editComment(comment: ForumCommentRecord | null, input: EditCommentInput, actor: string, at: string): Outcome<ForumCommentRecord | null> {
  const own = authorsOwn(comment, 'comment', actor);
  if (!own.ok) return own;
  if (own.value.state === 'removed') return refuse('conflict', `you cannot change it: ${GONE.removed}`);
  if (own.value.body === input.body) return { ok: true, value: null };
  return { ok: true, value: { ...own.value, body: input.body, editedAt: at } };
}

/** The author deletes their comment: its text is erased; replies to it stay. */
export function deleteComment(comment: ForumCommentRecord | null, actor: string, at: string): Outcome<ForumCommentRecord> {
  const own = authorsOwn(comment, 'comment', actor);
  if (!own.ok) return own;
  return { ok: true, value: { ...own.value, body: '', state: 'deleted', deletedAt: at } };
}

/**
 * A comment on a visible, unlocked post, or a reply to a visible comment on it, with its author's upvote. Replies nest
 * `FORUM_LIMITS.depth` deep at most.
 */
export function newComment(
  post: ForumPostRecord | null,
  parent: ForumCommentRecord | null,
  input: CreateCommentInput,
  commentId: string,
  authorId: string,
  at: string,
): Outcome<{ comment: ForumCommentRecord; post: ForumPostRecord; vote: ForumVoteRecord }> {
  if (!post || post.state === 'deleted') return notFound('post');
  if (post.state === 'removed') return refuse('conflict', `you cannot comment on it: ${GONE.removed}`);
  if (post.lock) return refuse('conflict', 'the thread is locked: nobody can comment on it');
  if (input.parentId !== null) {
    if (!parent || parent.postId !== post.postId) return notFound('comment');
    if (parent.state !== 'visible') return refuse('conflict', `you cannot reply to it: ${GONE[parent.state]}`);
    if (parent.depth >= FORUM_LIMITS.depth) return refuse('conflict', 'replies cannot nest deeper here; reply to an earlier comment');
  }
  const comment: ForumCommentRecord = {
    commentId,
    postId: post.postId,
    parentId: input.parentId,
    depth: input.parentId === null ? 0 : parent!.depth + 1,
    body: input.body,
    authorId,
    createdAt: at,
    editedAt: null,
    up: 1,
    down: 0,
    score: 1,
    state: 'visible',
    removal: null,
    deletedAt: null,
  };
  return {
    ok: true,
    value: {
      comment,
      post: { ...post, comments: post.comments + 1, lastCommentAt: at },
      vote: { targetKind: 'comment', targetId: commentId, postId: post.postId, accountId: authorId, value: 1, at },
    },
  };
}

/**
 * A member's vote on a visible post or comment, replacing theirs (0 takes it back): the new tally, and their vote
 * record, or null when they have none now.
 */
export function castVote(
  target: (ForumTally & { state: ForumState }) | null,
  kind: ForumTargetKind,
  current: ForumVoteRecord | null,
  value: ForumVoteValue,
  ids: { targetId: string; postId: string; accountId: string },
  at: string,
): Outcome<{ tally: ForumTally; vote: ForumVoteRecord | null }> {
  if (!target || target.state === 'deleted') return notFound(kind);
  if (target.state === 'removed') return refuse('conflict', `you cannot vote on it: ${GONE.removed}`);
  const before = current?.value ?? 0;
  const up = target.up - (before === 1 ? 1 : 0) + (value === 1 ? 1 : 0);
  const down = target.down - (before === -1 ? 1 : 0) + (value === -1 ? 1 : 0);
  const vote: ForumVoteRecord | null = value === 0 ? null : { targetKind: kind, ...ids, value, at: before === value ? current!.at : at };
  return { ok: true, value: { tally: { up, down, score: up - down }, vote } };
}

/** A member's report of someone else's visible post or comment, for Membership Admins to look at. */
export function newReport(
  target: { authorId: string; state: ForumState } | null,
  kind: ForumTargetKind,
  ids: { targetId: string; postId: string },
  input: ForumReportInput,
  accountId: string,
  at: string,
): Outcome<ForumReportRecord> {
  if (!target || target.state === 'deleted') return notFound(kind);
  if (target.state === 'removed') return refuse('conflict', `there is nothing to report: ${GONE.removed}`);
  if (target.authorId === accountId) return refuse('conflict', `you cannot report your own ${kind}; edit or delete it instead`);
  return {
    ok: true,
    value: {
      reportId: forumReportId(kind, ids.targetId, accountId),
      targetKind: kind,
      ...ids,
      accountId,
      reason: input.reason,
      note: input.note,
      at,
      status: 'open',
      decidedAt: null,
      decidedBy: null,
    },
  };
}

const moderated = (actor: string, subject: string, payload: ForumModeratedPayload): LedgerEvent => ({
  type: 'forum.moderated',
  actor,
  subject,
  payload: { ...payload },
});

const PAST = { remove: 'removed', restore: 'restored', lock: 'locked', unlock: 'unlocked', pin: 'pinned', unpin: 'unpinned' } as const;

/**
 * A Membership Admin removes or restores a post, locks or unlocks its thread, or pins or unpins it (pinned posts come
 * first in their lists). A deleted post can only be locked or unlocked.
 */
export function moderatePost(
  post: ForumPostRecord | null,
  input: ModerationInput,
  actor: string,
  at: string,
): Outcome<{ post: ForumPostRecord; event: LedgerEvent }> {
  if (!post) return notFound('post');
  const reason = input.action === 'remove' || input.action === 'lock' ? input.reason : null;
  const mark: ForumModeration | null = reason ? { at, by: actor, reason } : null;
  let changed: ForumPostRecord;
  if (post.state === 'deleted' && input.action !== 'lock' && input.action !== 'unlock') return refuse('conflict', `${GONE.deleted}`);
  switch (input.action) {
    case 'remove':
      if (post.state === 'removed') return refuse('conflict', 'it is already removed');
      changed = { ...post, state: 'removed', removal: mark, pinned: false };
      break;
    case 'restore':
      if (post.state !== 'removed') return refuse('conflict', 'it is not removed');
      changed = { ...post, state: 'visible', removal: null };
      break;
    case 'lock':
      if (post.lock) return refuse('conflict', 'the thread is already locked');
      changed = { ...post, lock: mark };
      break;
    case 'unlock':
      if (!post.lock) return refuse('conflict', 'the thread is not locked');
      changed = { ...post, lock: null };
      break;
    case 'pin':
      if (post.state !== 'visible') return refuse('conflict', `only a visible post can be pinned: ${GONE[post.state]}`);
      if (post.pinned) return refuse('conflict', 'it is already pinned');
      changed = { ...post, pinned: true };
      break;
    case 'unpin':
      if (!post.pinned) return refuse('conflict', 'it is not pinned');
      changed = { ...post, pinned: false };
      break;
  }
  return {
    ok: true,
    value: {
      post: { ...changed, feeds: feedsOf(changed) },
      event: moderated(actor, post.authorId, { target: 'post', postId: post.postId, commentId: null, action: PAST[input.action], reason }),
    },
  };
}

/** A Membership Admin removes or restores a comment; its replies stay either way. */
export function moderateComment(
  comment: ForumCommentRecord | null,
  input: ModerationInput,
  actor: string,
  at: string,
): Outcome<{ comment: ForumCommentRecord; event: LedgerEvent }> {
  if (!comment) return notFound('comment');
  if (comment.state === 'deleted') return refuse('conflict', GONE.deleted);
  let changed: ForumCommentRecord;
  if (input.action === 'remove') {
    if (comment.state === 'removed') return refuse('conflict', 'it is already removed');
    changed = { ...comment, state: 'removed', removal: { at, by: actor, reason: input.reason! } };
  } else if (input.action === 'restore') {
    if (comment.state !== 'removed') return refuse('conflict', 'it is not removed');
    changed = { ...comment, state: 'visible', removal: null };
  } else {
    return refuse('conflict', 'comments can only be removed or restored');
  }
  return {
    ok: true,
    value: {
      comment: changed,
      event: moderated(actor, comment.authorId, {
        target: 'comment',
        postId: comment.postId,
        commentId: comment.commentId,
        action: PAST[input.action],
        reason: input.action === 'remove' ? input.reason : null,
      }),
    },
  };
}

/** Whether an Election Admin can put the post on a ballot: a visible proposal. */
export function checkBallotable(post: ForumPostRecord | null): Check {
  if (!post || post.state === 'deleted') return notFound('post');
  if (post.kind !== 'proposal') return refuse('conflict', 'only proposals go on a ballot; this is a discussion');
  if (post.state === 'removed') return refuse('conflict', `it cannot go on a ballot: ${GONE.removed}`);
  return OK;
}

/** The post with the election it was put on added. */
export function linkBallot(post: ForumPostRecord | null, link: ForumBallotLink): Outcome<ForumPostRecord> {
  const check = checkBallotable(post);
  if (!check.ok) return check;
  return { ok: true, value: { ...post!, ballots: [...post!.ballots, link] } };
}

/** Whether a member who made `made` posts (or comments) in the last 24 hours may make another. */
export function checkDailyLimit(kind: ForumTargetKind, made: number): Check {
  const limit = kind === 'post' ? FORUM_LIMITS.postsPerDay : FORUM_LIMITS.commentsPerDay;
  return made < limit ? OK : refuse('rate_limited', `you can make ${limit} ${kind}s in any 24 hours; try again later`);
}

export const checkForumMember = (status: string | null | undefined): Check =>
  status === 'active' ? OK : refuse('forbidden', 'the forum is for Active members');
