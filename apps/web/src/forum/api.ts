import type {
  CreateCommentInput,
  CreatePostInput,
  ElectionRecord,
  ForumBallotInput,
  ForumCommentView,
  ForumFeed,
  ForumPage,
  ForumReportGroup,
  ForumReportInput,
  ForumSort,
  ForumTargetKind,
  ForumThread,
  ForumVoteResult,
  ForumVoteValue,
  ModerationInput,
} from 'ustp-domain';
import { api } from '../api.js';

/**
 * The forum context's API (design §5.9, §12): the only place its routes are written. Active members use `/v1/forum`;
 * Membership Admins (moderating) and Election Admins (putting proposals on ballots) use `/v1/admin/forum`.
 */

/** Where a page reads from: as an Active member, or at the console. */
export type ForumMode = 'member' | 'admin';

const base = (mode: ForumMode) => (mode === 'admin' ? '/v1/admin/forum' : '/v1/forum');
const postPath = (mode: ForumMode, postId: string) => `${base(mode)}/posts/${encodeURIComponent(postId)}`;
const commentPath = (commentId: string) => `/v1/forum/comments/${encodeURIComponent(commentId)}`;
const targetPath = (kind: ForumTargetKind, id: string) => (kind === 'post' ? postPath('member', id) : commentPath(id));

export function listPosts(mode: ForumMode, query: { sort: ForumSort; feed: ForumFeed; after?: string | null }): Promise<ForumPage> {
  const params = new URLSearchParams({ sort: query.sort, feed: query.feed, ...(query.after && { after: query.after }) });
  return api<ForumPage>('GET', `${base(mode)}/posts?${params}`);
}

export function getThread(mode: ForumMode, postId: string): Promise<ForumThread> {
  return api<ForumThread>('GET', postPath(mode, postId));
}

export function createPost(input: CreatePostInput): Promise<ForumThread> {
  return api<ForumThread>('POST', '/v1/forum/posts', input);
}

export function editPost(postId: string, input: { title: string; body: string }): Promise<ForumThread> {
  return api<ForumThread>('PUT', postPath('member', postId), input);
}

export function deletePost(postId: string): Promise<ForumThread> {
  return api<ForumThread>('DELETE', postPath('member', postId));
}

export function vote(kind: ForumTargetKind, id: string, value: ForumVoteValue): Promise<ForumVoteResult> {
  return api<ForumVoteResult>('PUT', `${targetPath(kind, id)}/vote`, { value });
}

export function report(kind: ForumTargetKind, id: string, input: ForumReportInput): Promise<void> {
  return api<void>('POST', `${targetPath(kind, id)}/report`, input);
}

export function addComment(postId: string, input: CreateCommentInput): Promise<ForumCommentView> {
  return api<ForumCommentView>('POST', `${postPath('member', postId)}/comments`, input);
}

export function editComment(commentId: string, body: string): Promise<ForumCommentView> {
  return api<ForumCommentView>('PUT', commentPath(commentId), { body });
}

export function deleteComment(commentId: string): Promise<ForumCommentView> {
  return api<ForumCommentView>('DELETE', commentPath(commentId));
}

/** A Membership Admin's action on a post (remove, restore, lock, unlock, pin, unpin). */
export function moderatePost(postId: string, input: ModerationInput): Promise<ForumThread> {
  return api<ForumThread>('POST', `${postPath('admin', postId)}/moderation`, input);
}

/** A Membership Admin removes or restores a comment. */
export function moderateComment(commentId: string, input: ModerationInput): Promise<ForumCommentView> {
  return api<ForumCommentView>('POST', `/v1/admin/forum/comments/${encodeURIComponent(commentId)}/moderation`, input);
}

export function listReports(): Promise<ForumReportGroup[]> {
  return api<ForumReportGroup[]>('GET', '/v1/admin/forum/reports');
}

export function dismissReports(targetKind: ForumTargetKind, targetId: string): Promise<void> {
  return api<void>('POST', '/v1/admin/forum/reports/dismiss', { targetKind, targetId });
}

/** An Election Admin puts the proposal on a draft election as a proposal question. */
export function putOnBallot(postId: string, input: ForumBallotInput): Promise<ForumThread> {
  return api<ForumThread>('POST', `${postPath('admin', postId)}/ballot`, input);
}

/** The draft elections a proposal can be put on. */
export async function draftElections(): Promise<ElectionRecord[]> {
  return (await api<ElectionRecord[]>('GET', '/v1/admin/elections')).filter((e) => e.state === 'draft');
}
