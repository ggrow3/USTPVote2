import type { ElectionState } from '../election-state.js';
import {
  confidence,
  FORUM_LIMITS,
  type ForumBallotLink,
  type ForumCommentRecord,
  type ForumCommentSort,
  type ForumModeration,
  type ForumPostKind,
  type ForumPostRecord,
  type ForumReportReason,
  type ForumReportRecord,
  type ForumState,
  type ForumTally,
  type ForumTargetKind,
  type ForumVoteValue,
} from './forum.js';

/**
 * What the API shows of the forum (design §5.8, §12). Every Active member sees every visible post and comment, who wrote
 * it and its score, and their own votes, never anyone else's. Of a removed post or comment, its author sees what it said
 * and why it was removed; others see only that it was. Membership Admins at the console see it all, and the reports.
 */

/** Who wrote a post or comment: preferred name, else legal name, and state, as on the teams pages. */
export interface ForumAuthor {
  readonly accountId: string;
  readonly name: string;
  readonly state: string;
}

/** Who is looking: an Active member, or someone at the console (a Membership Admin moderates; an Election Admin reads). */
export interface ForumViewer {
  readonly accountId: string;
  readonly moderator: boolean;
}

/** An election a proposal was put on, with where that election is now (`deleted` if it no longer exists). */
export interface ForumBallotView extends Pick<ForumBallotLink, 'electionId' | 'contestId' | 'at'> {
  readonly electionTitle: string;
  readonly state: ElectionState | 'deleted';
}

/** One post, in a list (`body` cut to an excerpt) or on its page. */
export interface ForumPostView {
  readonly postId: string;
  readonly kind: ForumPostKind;
  /** Empty when the viewer cannot see it (removed, for anyone but its author and moderators; deleted). */
  readonly title: string;
  readonly body: string;
  /** The text was cut for a list. */
  readonly excerpt: boolean;
  /** Null once deleted. */
  readonly author: ForumAuthor | null;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly score: number;
  readonly comments: number;
  readonly lastCommentAt: string | null;
  readonly pinned: boolean;
  /** Shown to everyone: why the thread is locked. */
  readonly lock: Pick<ForumModeration, 'at' | 'reason'> | null;
  readonly state: ForumState;
  /** Why it was removed, for its author and moderators; null otherwise. */
  readonly removal: Pick<ForumModeration, 'at' | 'reason'> | null;
  readonly mine: boolean;
  readonly myVote: ForumVoteValue;
  readonly ballots: readonly ForumBallotView[];
  /** Open reports on it: for moderators, else null. */
  readonly reports: number | null;
}

export interface ForumCommentView {
  readonly commentId: string;
  readonly postId: string;
  readonly parentId: string | null;
  readonly depth: number;
  /** Empty when the viewer cannot see it. */
  readonly body: string;
  readonly author: ForumAuthor | null;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly up: number;
  readonly down: number;
  readonly score: number;
  readonly state: ForumState;
  readonly removal: Pick<ForumModeration, 'at' | 'reason'> | null;
  readonly mine: boolean;
  readonly myVote: ForumVoteValue;
  readonly reports: number | null;
}

/** `GET /v1/forum/posts`: a page of posts, with the pinned ones before the first page. */
export interface ForumPage {
  readonly pinned: readonly ForumPostView[];
  readonly posts: readonly ForumPostView[];
  /** Pass as `after` for the next page; null on the last. */
  readonly next: string | null;
}

/** `GET /v1/forum/posts/{postId}`: the post and every comment on it, in the order they were made. */
export interface ForumThread {
  readonly post: ForumPostView;
  readonly comments: readonly ForumCommentView[];
}

/** `PUT …/vote`: the new tally and the voter's own vote. */
export interface ForumVoteResult extends ForumTally {
  readonly targetId: string;
  readonly myVote: ForumVoteValue;
}

/** `GET /v1/admin/forum/reports`: the open reports on one post or comment, without who made them. */
export interface ForumReportGroup {
  readonly targetKind: ForumTargetKind;
  readonly targetId: string;
  readonly postId: string;
  readonly count: number;
  readonly reasons: Readonly<Partial<Record<ForumReportReason, number>>>;
  readonly notes: readonly string[];
  readonly firstAt: string;
  readonly lastAt: string;
  /** The post, or the post the comment is on, for context. */
  readonly post: ForumPostView;
  readonly comment: ForumCommentView | null;
}

export interface ForumViewContext {
  readonly viewer: ForumViewer;
  /** Authors by accountId. */
  readonly people: ReadonlyMap<string, Omit<ForumAuthor, 'accountId'>>;
  /** The viewer's votes, by target ID. */
  readonly votes: ReadonlyMap<string, ForumVoteValue>;
  /** Open reports, by target ID: read for moderators only. */
  readonly reports?: ReadonlyMap<string, number>;
}

const UNKNOWN = { name: 'Unknown member', state: '' };

function author(accountId: string, state: ForumState, ctx: ForumViewContext): ForumAuthor | null {
  return state === 'deleted' ? null : { accountId, ...(ctx.people.get(accountId) ?? UNKNOWN) };
}

/** Whether the viewer sees what a post or comment says. */
const readable = (state: ForumState, authorId: string, viewer: ForumViewer) =>
  state === 'visible' || (state === 'removed' && (viewer.moderator || authorId === viewer.accountId));

const removalFor = (item: { removal: ForumModeration | null; authorId: string }, viewer: ForumViewer) =>
  item.removal && (viewer.moderator || item.authorId === viewer.accountId) ? { at: item.removal.at, reason: item.removal.reason } : null;

/** Cuts text for a list at a word, if it is long. */
export function excerptOf(text: string, max: number = FORUM_LIMITS.excerpt): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const head = text.slice(0, max);
  const space = head.lastIndexOf(' ');
  return { text: `${(space > max * 0.6 ? head.slice(0, space) : head).trimEnd()}…`, cut: true };
}

export function postView(
  post: ForumPostRecord,
  ctx: ForumViewContext,
  ballots: readonly ForumBallotView[],
  options: { excerpt?: boolean } = {},
): ForumPostView {
  const shown = readable(post.state, post.authorId, ctx.viewer);
  const body = shown ? (options.excerpt ? excerptOf(post.body) : { text: post.body, cut: false }) : { text: '', cut: false };
  return {
    postId: post.postId,
    kind: post.kind,
    title: shown ? post.title : '',
    body: body.text,
    excerpt: body.cut,
    author: author(post.authorId, post.state, ctx),
    createdAt: post.createdAt,
    editedAt: shown ? post.editedAt : null,
    score: post.score,
    comments: post.comments,
    lastCommentAt: post.lastCommentAt,
    pinned: post.pinned,
    lock: post.lock && { at: post.lock.at, reason: post.lock.reason },
    state: post.state,
    removal: removalFor(post, ctx.viewer),
    mine: post.authorId === ctx.viewer.accountId,
    myVote: ctx.votes.get(post.postId) ?? 0,
    ballots,
    reports: ctx.viewer.moderator ? (ctx.reports?.get(post.postId) ?? 0) : null,
  };
}

export function commentView(comment: ForumCommentRecord, ctx: ForumViewContext): ForumCommentView {
  const shown = readable(comment.state, comment.authorId, ctx.viewer);
  return {
    commentId: comment.commentId,
    postId: comment.postId,
    parentId: comment.parentId,
    depth: comment.depth,
    body: shown ? comment.body : '',
    author: author(comment.authorId, comment.state, ctx),
    createdAt: comment.createdAt,
    editedAt: shown ? comment.editedAt : null,
    up: comment.up,
    down: comment.down,
    score: comment.score,
    state: comment.state,
    removal: removalFor(comment, ctx.viewer),
    mine: comment.authorId === ctx.viewer.accountId,
    myVote: ctx.votes.get(comment.commentId) ?? 0,
    reports: ctx.viewer.moderator ? (ctx.reports?.get(comment.commentId) ?? 0) : null,
  };
}

/** Open reports grouped by what they are about, the most reported first, then the longest waiting. */
export function reportGroups(
  reports: readonly ForumReportRecord[],
  view: (r: ForumReportRecord) => { post: ForumPostView; comment: ForumCommentView | null } | null,
): ForumReportGroup[] {
  const groups = new Map<string, ForumReportRecord[]>();
  for (const r of reports.filter((r) => r.status === 'open')) {
    const key = `${r.targetKind}_${r.targetId}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .flatMap((list) => {
      const first = list[0]!;
      const target = view(first);
      if (!target) return [];
      const times = list.map((r) => r.at).sort();
      const reasons: Partial<Record<ForumReportReason, number>> = {};
      for (const r of list) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
      return [
        {
          targetKind: first.targetKind,
          targetId: first.targetId,
          postId: first.postId,
          count: list.length,
          reasons,
          notes: list.flatMap((r) => (r.note ? [r.note] : [])),
          firstAt: times[0]!,
          lastAt: times[times.length - 1]!,
          ...target,
        },
      ];
    })
    .sort((a, b) => b.count - a.count || a.firstAt.localeCompare(b.firstAt));
}

/** A comment and its replies, as a thread page shows them. */
export interface ForumCommentNode {
  readonly comment: ForumCommentView;
  readonly replies: readonly ForumCommentNode[];
}

const ORDER: Readonly<Record<ForumCommentSort, (a: ForumCommentView, b: ForumCommentView) => number>> = {
  best: (a, b) => confidence(b.up, b.down) - confidence(a.up, a.down) || b.score - a.score || a.createdAt.localeCompare(b.createdAt),
  top: (a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt),
  new: (a, b) => b.createdAt.localeCompare(a.createdAt),
  old: (a, b) => a.createdAt.localeCompare(b.createdAt),
};

/**
 * The comments as a tree, each level in `sort` order. A removed or deleted comment with no replies left is dropped, as
 * there is nothing to show; one with replies stays, so they keep their place. A reply whose parent is missing (past the
 * thread's limit) is shown at the top level.
 */
export function commentTree(comments: readonly ForumCommentView[], sort: ForumCommentSort): ForumCommentNode[] {
  const ids = new Set(comments.map((c) => c.commentId));
  const children = new Map<string | null, ForumCommentView[]>();
  for (const c of comments) {
    const parent = c.parentId !== null && ids.has(c.parentId) ? c.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), c]);
  }
  const build = (parent: string | null): ForumCommentNode[] =>
    [...(children.get(parent) ?? [])]
      .sort(ORDER[sort])
      .map((comment) => ({ comment, replies: build(comment.commentId) }))
      .filter((node) => node.comment.body !== '' || node.replies.length > 0);
  return build(null);
}
