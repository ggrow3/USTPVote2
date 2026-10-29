import { describe, expect, it } from 'vitest';
import { isPublicLedgerEvent } from '../ledger.js';
import {
  castVote,
  checkBallotable,
  confidence,
  createCommentSchema,
  createPostSchema,
  deleteComment,
  deletePost,
  editComment,
  editPost,
  hotRank,
  linkBallot,
  moderateComment,
  moderatePost,
  moderationSchema,
  newComment,
  newPost,
  newReport,
  type ForumBallotLink,
  type ForumCommentRecord,
  type ForumPostRecord,
} from './forum.js';
import {
  commentTree,
  commentView,
  excerptOf,
  postView,
  reportGroups,
  type ForumCommentNode,
  type ForumViewContext,
  type ForumViewer,
} from './views.js';

const NOW = '2026-10-29T12:00:00.000Z';
const LATER = '2026-10-29T13:00:00.000Z';
const { post } = newPost({ kind: 'proposal', title: 'Adopt ranked choice', body: 'Use IRV for every office.' }, 'p1', 'ada', NOW);
const comment = (commentId: string, parentId: string | null = null, extra: Partial<ForumCommentRecord> = {}): ForumCommentRecord => ({
  commentId,
  postId: 'p1',
  parentId,
  depth: parentId ? 1 : 0,
  body: `says ${commentId}`,
  authorId: 'bo',
  createdAt: NOW,
  editedAt: null,
  up: 1,
  down: 0,
  score: 1,
  state: 'visible',
  removal: null,
  deletedAt: null,
  ...extra,
});
const LINK: ForumBallotLink = {
  electionId: 'e1',
  electionTitle: '2027 Platform Vote',
  contestId: 'c1',
  snapshotId: 's1',
  contentHash: 'h',
  at: LATER,
  by: 'ea',
};
const member: ForumViewer = { accountId: 'cy', moderator: false };
const ctx = (viewer: ForumViewer, extra: Partial<ForumViewContext> = {}): ForumViewContext => ({
  viewer,
  people: new Map([
    ['ada', { name: 'Ada Brooks', state: 'TX' }],
    ['bo', { name: 'Bo', state: 'CA' }],
  ]),
  votes: new Map(),
  ...extra,
});

describe('posts', () => {
  it('start with their author’s upvote, in the lists for all posts and their kind', () => {
    expect(post).toMatchObject({ up: 1, down: 0, score: 1, state: 'visible', feeds: ['all', 'proposal'], ballots: [], comments: 0 });
    expect(post.hot).toBe(hotRank(1, NOW));
  });

  it('need a title, and a proposal its text', () => {
    expect(createPostSchema.safeParse({ kind: 'discussion', title: 'Hello' }).success).toBe(true);
    const bare = createPostSchema.safeParse({ kind: 'proposal', title: 'Hello', body: '  ' });
    expect(bare.success).toBe(false);
    expect(bare.error?.issues[0]?.path).toEqual(['body']);
    expect(createPostSchema.safeParse({ kind: 'discussion', title: ' ' }).success).toBe(false);
  });

  it('are changed and deleted only by their author; deleting erases the text and leaves every list', () => {
    expect(editPost(post, { title: 'New', body: 'x' }, 'bo', LATER)).toMatchObject({ ok: false, refusal: 'forbidden' });
    const edited = editPost(post, { title: 'Adopt IRV', body: post.body }, 'ada', LATER);
    expect(edited).toMatchObject({ ok: true, value: { title: 'Adopt IRV', editedAt: LATER } });
    expect(editPost(post, { title: post.title, body: post.body }, 'ada', LATER)).toEqual({ ok: true, value: null });
    expect(editPost(post, { title: 'x', body: '' }, 'ada', LATER)).toMatchObject({ ok: false, reason: 'a proposal needs its text' });
    const deleted = deletePost(post, 'ada', LATER);
    expect(deleted).toMatchObject({ ok: true, value: { title: '', body: '', state: 'deleted', deletedAt: LATER, feeds: [] } });
    if (deleted.ok) expect(editPost(deleted.value, { title: 'x', body: 'y' }, 'ada', LATER)).toMatchObject({ refusal: 'not_found' });
  });

  it('keep their text once on a ballot', () => {
    const linked = linkBallot(post, LINK);
    expect(linked).toMatchObject({ ok: true, value: { ballots: [LINK] } });
    if (linked.ok) expect(editPost(linked.value, { title: 'x', body: 'y' }, 'ada', LATER)).toMatchObject({ ok: false, refusal: 'conflict' });
  });

  it('go on a ballot only as visible proposals', () => {
    expect(checkBallotable(post).ok).toBe(true);
    expect(checkBallotable({ ...post, kind: 'discussion' })).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(checkBallotable({ ...post, state: 'removed' })).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(checkBallotable(null)).toMatchObject({ ok: false, refusal: 'not_found' });
  });
});

describe('hot and best', () => {
  it('rank a newer post above an older one with ten times the score after 12.5 hours', () => {
    const older = hotRank(10, '2026-10-29T00:00:00.000Z');
    expect(hotRank(1, '2026-10-29T12:30:00.000Z')).toBeCloseTo(older, 5);
    expect(hotRank(1, '2026-10-29T13:00:00.000Z')).toBeGreaterThan(older);
    expect(hotRank(-5, NOW)).toBeLessThan(hotRank(0, NOW));
  });

  it('trusts many votes over few', () => {
    expect(confidence(10, 1)).toBeGreaterThan(confidence(1, 0));
    expect(confidence(0, 0)).toBe(0);
    expect(confidence(5, 5)).toBeLessThan(confidence(6, 4));
  });
});

describe('votes', () => {
  const ids = { targetId: 'p1', postId: 'p1', accountId: 'bo' };

  it('add, change and take back one vote per member', () => {
    const up = castVote(post, 'post', null, 1, ids, NOW);
    expect(up).toMatchObject({ ok: true, value: { tally: { up: 2, down: 0, score: 2 }, vote: { value: 1, at: NOW } } });
    const vote = up.ok ? up.value.vote : null;
    const tally = { ...post, up: 2, score: 2 };
    expect(castVote(tally, 'post', vote, -1, ids, LATER)).toMatchObject({ ok: true, value: { tally: { up: 1, down: 1, score: 0 }, vote: { value: -1, at: LATER } } });
    expect(castVote(tally, 'post', vote, 0, ids, LATER)).toMatchObject({ ok: true, value: { tally: { up: 1, down: 0, score: 1 }, vote: null } });
    // The same vote again changes nothing, and keeps when it was cast.
    expect(castVote(tally, 'post', vote, 1, ids, LATER)).toMatchObject({ ok: true, value: { tally: { up: 2, score: 2 }, vote: { at: NOW } } });
  });

  it('are refused on removed and deleted posts', () => {
    expect(castVote({ ...post, state: 'removed' }, 'post', null, 1, ids, NOW)).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(castVote({ ...post, state: 'deleted' }, 'post', null, 1, ids, NOW)).toMatchObject({ ok: false, refusal: 'not_found' });
  });
});

describe('comments', () => {
  it('count on the post and nest replies', () => {
    const made = newComment(post, null, { parentId: null, body: 'Yes' }, 'c1', 'bo', LATER);
    expect(made).toMatchObject({ ok: true, value: { comment: { depth: 0, score: 1 }, post: { comments: 1, lastCommentAt: LATER } } });
    const reply = newComment(post, comment('c1'), { parentId: 'c1', body: 'Agreed' }, 'c2', 'ada', LATER);
    expect(reply).toMatchObject({ ok: true, value: { comment: { parentId: 'c1', depth: 1 } } });
  });

  it('are refused on locked or removed posts, under removed comments, too deep, or under another post’s comment', () => {
    const body = { parentId: null, body: 'Hi' };
    const locked = { ...post, lock: { at: NOW, by: 'ma', reason: 'Decided' } };
    expect(newComment(locked, null, body, 'c', 'bo', NOW)).toMatchObject({ ok: false, reason: 'the thread is locked: nobody can comment on it' });
    expect(newComment({ ...post, state: 'removed' }, null, body, 'c', 'bo', NOW)).toMatchObject({ ok: false, refusal: 'conflict' });
    const reply = { parentId: 'c1', body: 'Hi' };
    expect(newComment(post, comment('c1', null, { state: 'removed' }), reply, 'c', 'bo', NOW)).toMatchObject({ ok: false });
    expect(newComment(post, comment('c1', null, { depth: 8 }), reply, 'c', 'bo', NOW)).toMatchObject({ ok: false });
    expect(newComment(post, comment('c1', null, { postId: 'p2' }), reply, 'c', 'bo', NOW)).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(createCommentSchema.safeParse({ body: '' }).success).toBe(false);
  });

  it('are changed and deleted only by their author', () => {
    const c = comment('c1');
    expect(editComment(c, { body: 'Changed' }, 'ada', LATER)).toMatchObject({ ok: false, refusal: 'forbidden' });
    expect(editComment(c, { body: 'Changed' }, 'bo', LATER)).toMatchObject({ ok: true, value: { body: 'Changed', editedAt: LATER } });
    expect(deleteComment(c, 'bo', LATER)).toMatchObject({ ok: true, value: { body: '', state: 'deleted' } });
  });
});

describe('moderation', () => {
  it('needs a reason to remove or lock', () => {
    expect(moderationSchema.safeParse({ action: 'remove' }).success).toBe(false);
    expect(moderationSchema.safeParse({ action: 'lock', reason: ' ' }).success).toBe(false);
    expect(moderationSchema.safeParse({ action: 'pin' }).success).toBe(true);
  });

  it('removes and restores posts, ledgered for Auditors with the author as subject', () => {
    const removed = moderatePost({ ...post, pinned: true }, { action: 'remove', reason: 'Spam' }, 'ma', LATER);
    expect(removed).toMatchObject({
      ok: true,
      value: {
        post: { state: 'removed', removal: { at: LATER, by: 'ma', reason: 'Spam' }, feeds: ['removed'], pinned: false },
        event: {
          type: 'forum.moderated',
          actor: 'ma',
          subject: 'ada',
          payload: { target: 'post', postId: 'p1', commentId: null, action: 'removed', reason: 'Spam' },
        },
      },
    });
    expect(isPublicLedgerEvent('forum.moderated')).toBe(false);
    if (!removed.ok) return;
    expect(moderatePost(removed.value.post, { action: 'pin', reason: null }, 'ma', LATER)).toMatchObject({ ok: false });
    const restored = moderatePost(removed.value.post, { action: 'restore', reason: null }, 'ma', LATER);
    expect(restored).toMatchObject({ ok: true, value: { post: { state: 'visible', removal: null, feeds: ['all', 'proposal'] } } });
  });

  it('locks, unlocks, pins and unpins, refusing what is already so', () => {
    const locked = moderatePost(post, { action: 'lock', reason: 'Decided at the convention' }, 'ma', LATER);
    expect(locked).toMatchObject({ ok: true, value: { post: { lock: { reason: 'Decided at the convention' } }, event: { payload: { action: 'locked' } } } });
    if (locked.ok) expect(moderatePost(locked.value.post, { action: 'lock', reason: 'Again' }, 'ma', LATER)).toMatchObject({ ok: false });
    expect(moderatePost(post, { action: 'unpin', reason: null }, 'ma', LATER)).toMatchObject({ ok: false, reason: 'it is not pinned' });
    expect(moderatePost(post, { action: 'pin', reason: 'ignored' }, 'ma', LATER)).toMatchObject({ ok: true, value: { post: { pinned: true }, event: { payload: { reason: null } } } });
  });

  it('removes and restores comments only', () => {
    const c = comment('c1');
    expect(moderateComment(c, { action: 'remove', reason: 'Rude' }, 'ma', LATER)).toMatchObject({
      ok: true,
      value: { comment: { state: 'removed' }, event: { subject: 'bo', payload: { target: 'comment', commentId: 'c1', action: 'removed' } } },
    });
    expect(moderateComment(c, { action: 'lock', reason: 'x' }, 'ma', LATER)).toMatchObject({ ok: false });
    expect(moderateComment({ ...c, state: 'deleted' }, { action: 'remove', reason: 'x' }, 'ma', LATER)).toMatchObject({ ok: false });
  });
});

describe('reports', () => {
  it('are of someone else’s visible post or comment', () => {
    const ids = { targetId: 'p1', postId: 'p1' };
    expect(newReport(post, 'post', ids, { reason: 'spam', note: null }, 'bo', NOW)).toMatchObject({
      ok: true,
      value: { reportId: 'post_p1_bo', status: 'open', reason: 'spam' },
    });
    expect(newReport(post, 'post', ids, { reason: 'spam', note: null }, 'ada', NOW)).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(newReport({ ...post, state: 'removed' }, 'post', ids, { reason: 'spam', note: null }, 'bo', NOW)).toMatchObject({ ok: false });
  });

  it('group by what they are about, without who made them', () => {
    const report = (accountId: string, reason: 'spam' | 'other', note: string | null, at: string) => {
      const r = newReport(post, 'post', { targetId: 'p1', postId: 'p1' }, { reason, note }, accountId, at);
      if (!r.ok) throw new Error(r.reason);
      return r.value;
    };
    const view = postView(post, ctx({ accountId: 'ma', moderator: true }), []);
    const groups = reportGroups(
      [report('bo', 'spam', null, LATER), report('cy', 'other', 'Off topic', NOW), { ...report('di', 'spam', null, NOW), status: 'dismissed' }],
      () => ({ post: view, comment: null }),
    );
    expect(groups).toEqual([
      {
        targetKind: 'post',
        targetId: 'p1',
        postId: 'p1',
        count: 2,
        reasons: { spam: 1, other: 1 },
        notes: ['Off topic'],
        firstAt: NOW,
        lastAt: LATER,
        post: view,
        comment: null,
      },
    ]);
    expect(JSON.stringify(groups)).not.toContain('"cy"');
  });
});

describe('what each viewer sees', () => {
  const removed: ForumPostRecord = { ...post, state: 'removed', removal: { at: LATER, by: 'ma', reason: 'Spam' } };

  it('shows members a removed post’s place, its author what it said and why, and moderators all of it', () => {
    expect(postView(removed, ctx(member), [])).toMatchObject({ title: '', body: '', removal: null, author: { name: 'Ada Brooks' }, reports: null });
    expect(postView(removed, ctx({ accountId: 'ada', moderator: false }), [])).toMatchObject({
      title: 'Adopt ranked choice',
      removal: { at: LATER, reason: 'Spam' },
      mine: true,
    });
    expect(postView(removed, ctx({ accountId: 'ma', moderator: true }, { reports: new Map([['p1', 2]]) }), [])).toMatchObject({
      title: 'Adopt ranked choice',
      removal: { reason: 'Spam' },
      reports: 2,
    });
  });

  it('names nobody for a deleted post, and gives each viewer only their own vote', () => {
    const deleted = deletePost(post, 'ada', LATER);
    if (deleted.ok) expect(postView(deleted.value, ctx(member), [])).toMatchObject({ author: null, title: '' });
    expect(postView(post, ctx(member, { votes: new Map([['p1', -1]]) }), []).myVote).toBe(-1);
    expect(postView(post, ctx(member), []).myVote).toBe(0);
  });

  it('cuts long text for lists at a word', () => {
    expect(excerptOf('short')).toEqual({ text: 'short', cut: false });
    const long = excerptOf('word '.repeat(200));
    expect(long.cut).toBe(true);
    expect(long.text.length).toBeLessThanOrEqual(401);
    expect(long.text.endsWith('word…')).toBe(true);
  });

  it('builds the comment tree, dropping removed and deleted comments nobody replied to', () => {
    const view = (c: ForumCommentRecord) => commentView(c, ctx(member));
    const comments = [
      view(comment('a', null, { createdAt: '2026-10-29T12:01:00.000Z', up: 1 })),
      view(comment('b', null, { createdAt: '2026-10-29T12:02:00.000Z', up: 9, score: 9 })),
      view(comment('a1', 'a', { state: 'removed', removal: { at: NOW, by: 'ma', reason: 'x' } })),
      view(comment('b1', 'b', { state: 'deleted', body: '' })),
      view(comment('b1x', 'b1')),
      view(comment('orphan', 'gone', { createdAt: '2026-10-29T12:03:00.000Z' })),
    ];
    const ids = (nodes: readonly ForumCommentNode[]): unknown[] => nodes.map((n) => [n.comment.commentId, ...(n.replies.length ? [ids(n.replies)] : [])]);
    expect(ids(commentTree(comments, 'best'))).toEqual([['b', [['b1', [['b1x']]]]], ['a'], ['orphan']]);
    expect(commentTree(comments, 'old').map((n) => n.comment.commentId)).toEqual(['a', 'b', 'orphan']);
    expect(commentTree(comments, 'new').map((n) => n.comment.commentId)).toEqual(['orphan', 'b', 'a']);
  });
});
