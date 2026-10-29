import { hotRank, type ForumCommentView, type ForumPage, type ForumReportGroup, type ForumThread, type ForumVoteResult, type LedgerEntry } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;
let ma: Member;
let ea: Member;
let ada: Member;
let bo: Member;
let cy: Member;

async function memberRecord(user: Member, legalName: string, status = 'active', preferredName: string | null = null) {
  await api.firebase.db
    .collection('members')
    .doc(user.accountId)
    .set({ accountId: user.accountId, status, legalName, preferredName, state: 'TX' });
}

const post = (by: User, body: Record<string, unknown> = {}) =>
  api.call('POST', '/v1/forum/posts', by, { kind: 'proposal', title: 'Adopt ranked choice', body: 'Use IRV for every office.', ...body });
const created = async (by: User, body: Record<string, unknown> = {}) => {
  const res = await post(by, body);
  expect(res.status).toBe(201);
  return (res.body as ForumThread).post.postId;
};
const thread = async (by: User, postId: string, admin = false) =>
  (await api.call('GET', `/v1/${admin ? 'admin/' : ''}forum/posts/${postId}`, by)).body as ForumThread;
const list = async (by: User, query = '', admin = false) => (await api.call('GET', `/v1/${admin ? 'admin/' : ''}forum/posts${query}`, by)).body as ForumPage;
const vote = (by: User, postId: string, value: number) => api.call('PUT', `/v1/forum/posts/${postId}/vote`, by, { value });
const comment = (by: User, postId: string, body: string, parentId: string | null = null) =>
  api.call('POST', `/v1/forum/posts/${postId}/comments`, by, { body, parentId });
const moderate = (by: User, postId: string, action: string, reason: string | null = null) =>
  api.call('POST', `/v1/admin/forum/posts/${postId}/moderation`, by, { action, reason });

async function entries(type: string): Promise<LedgerEntry[]> {
  const snap = await api.firebase.db.collection('audit_events').where('type', '==', type).orderBy('seq').get();
  return snap.docs.map((d) => d.data() as LedgerEntry);
}

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  ma = await api.member('membership.admin@example.test');
  ea = await api.member('election.admin@example.test');
  ada = await api.member('ada@example.test');
  bo = await api.member('bo@example.test');
  cy = await api.member('cy@example.test');
  await api.grant(ma.accountId, 'membership_admin', sa1);
  await api.grant(ea.accountId, 'election_admin', sa1);
  await memberRecord(ada, 'Ada Brooks');
  await memberRecord(bo, 'Robert Lee', 'active', 'Bo');
  await memberRecord(cy, 'Cy Park', 'applicant');
});

describe('posting and reading', () => {
  it('Active members post and read; anyone else is refused', async () => {
    const res = await post(ada);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      post: { kind: 'proposal', title: 'Adopt ranked choice', score: 1, myVote: 1, mine: true, author: { name: 'Ada Brooks', state: 'TX' }, reports: null },
      comments: [],
    });
    const postId = (res.body as ForumThread).post.postId;
    expect(await thread(bo, postId)).toMatchObject({ post: { myVote: 0, mine: false } });
    expect((await post(cy)).status).toBe(403);
    expect((await api.call('GET', '/v1/forum/posts', cy)).status).toBe(403);
    expect((await api.call('GET', `/v1/forum/posts/${postId}`, cy)).status).toBe(403);
    expect((await api.call('GET', '/v1/forum/posts/nope', bo)).status).toBe(404);
    // Staff without a membership read at the console.
    expect((await api.call('GET', '/v1/forum/posts', ea)).status).toBe(403);
    expect((await api.call('GET', `/v1/admin/forum/posts/${postId}`, ea)).status).toBe(200);
    expect((await api.call('GET', '/v1/admin/forum/posts', ada)).status).toBe(403);
  });

  it('refuses a proposal without text, and bad sorts', async () => {
    const bare = await post(ada, { body: '' });
    expect(bare.status).toBe(400);
    expect(bare.body.errors).toEqual([{ path: 'body', message: 'write the proposal’s text' }]);
    expect((await post(ada, { kind: 'discussion', body: '' })).status).toBe(201);
    expect((await api.call('GET', '/v1/forum/posts?sort=random', ada)).status).toBe(400);
  });

  it('lists by new, top and hot, by kind, a page at a time, with pinned posts first', async () => {
    const first = await created(ada, { title: 'First' });
    const second = await created(ada, { kind: 'discussion', title: 'Second', body: 'Hello' });
    const third = await created(ada, { title: 'Third' });
    await vote(bo, first, 1);
    const titles = (page: ForumPage) => page.posts.map((p) => p.title);
    expect(titles(await list(bo, '?sort=new'))).toEqual(['Third', 'Second', 'First']);
    expect(titles(await list(bo, '?sort=top'))[0]).toBe('First');
    expect(titles(await list(bo, '?feed=discussion'))).toEqual(['Second']);
    expect(titles(await list(bo, '?feed=proposal&sort=new'))).toEqual(['Third', 'First']);
    expect((await list(bo)).next).toBeNull();

    expect((await moderate(ma, second, 'pin')).status).toBe(201);
    const pinned = await list(bo, '?sort=new');
    expect(pinned.pinned.map((p) => p.postId)).toEqual([second]);
    expect(pinned.posts.map((p) => p.postId)).toEqual([third, first]);
    expect((await list(bo, '?feed=proposal')).pinned).toEqual([]);
    await moderate(ma, second, 'unpin');

    for (let i = 0; i < 24; i++) await api.firebase.db.collection('forum_posts').doc(`old-${i}`).set({ ...(await rawPost(first)), postId: `old-${i}`, createdAt: `2026-01-0${(i % 9) + 1}T00:00:00.000Z`, pinned: false });
    const page1 = await list(bo, '?sort=new');
    expect(page1.posts).toHaveLength(25);
    expect(page1.next).not.toBeNull();
    const page2 = await list(bo, `?sort=new&after=${page1.next}`);
    expect(page2.pinned).toEqual([]);
    expect(page2.posts).toHaveLength(2);
    expect(page2.next).toBeNull();
  });

  it('lets only the author edit or delete; a deleted post leaves the lists and names nobody', async () => {
    const postId = await created(ada);
    expect((await api.call('PUT', `/v1/forum/posts/${postId}`, bo, { title: 'Mine now', body: 'x' })).status).toBe(403);
    const edited = await api.call('PUT', `/v1/forum/posts/${postId}`, ada, { title: 'Adopt IRV', body: 'Use IRV.' });
    expect(edited.body).toMatchObject({ post: { title: 'Adopt IRV', editedAt: expect.any(String) } });
    expect((await api.call('DELETE', `/v1/forum/posts/${postId}`, bo)).status).toBe(403);
    const deleted = await api.call('DELETE', `/v1/forum/posts/${postId}`, ada);
    expect(deleted.body).toMatchObject({ post: { state: 'deleted', title: '', body: '', author: null } });
    expect((await list(bo)).posts).toEqual([]);
  });

  it('allows ten posts in 24 hours', async () => {
    for (let i = 0; i < 10; i++) await created(ada, { title: `Post ${i}` });
    const eleventh = await post(ada);
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.detail).toMatch(/10 posts in any 24 hours/);
  });
});

async function rawPost(postId: string): Promise<Record<string, unknown>> {
  return (await api.firebase.db.collection('forum_posts').doc(postId).get()).data()!;
}

describe('votes', () => {
  it('one per member, changed or taken back, the score for all and each vote for its voter only', async () => {
    const postId = await created(ada);
    expect((await vote(bo, postId, 1)).body).toEqual({ targetId: postId, up: 2, down: 0, score: 2, myVote: 1 } satisfies ForumVoteResult);
    expect((await vote(bo, postId, -1)).body).toMatchObject({ up: 1, down: 1, score: 0, myVote: -1 });
    expect((await thread(ada, postId)).post).toMatchObject({ score: 0, myVote: 1 });
    expect((await thread(bo, postId)).post.myVote).toBe(-1);
    expect((await vote(bo, postId, 0)).body).toMatchObject({ score: 1, myVote: 0 });
    expect((await vote(ada, postId, 0)).body).toMatchObject({ score: 0 });
    expect((await vote(bo, postId, 2)).status).toBe(400);
    expect((await vote(cy, postId, 1)).status).toBe(403);
    // The hot rank follows the score.
    await vote(bo, postId, 1);
    const raw = await rawPost(postId);
    expect(raw.hot).toBe(hotRank(1, raw.createdAt as string));
  });

  it('on comments too', async () => {
    const postId = await created(ada);
    const c = (await comment(bo, postId, 'Yes')).body as ForumCommentView;
    const res = await api.call('PUT', `/v1/forum/comments/${c.commentId}/vote`, ada, { value: -1 });
    expect(res.body).toEqual({ targetId: c.commentId, up: 1, down: 1, score: 0, myVote: -1 });
    expect((await thread(ada, postId)).comments[0]).toMatchObject({ up: 1, down: 1, myVote: -1 });
    expect((await thread(bo, postId)).comments[0]).toMatchObject({ myVote: 1 });
  });
});

describe('comments', () => {
  it('nest replies and count on the post; only their author changes them', async () => {
    const postId = await created(ada);
    const top = (await comment(bo, postId, 'Yes')).body as ForumCommentView;
    expect(top).toMatchObject({ depth: 0, parentId: null, author: { name: 'Bo' }, mine: true, score: 1 });
    const reply = await comment(ada, postId, 'Thanks', top.commentId);
    expect(reply.body).toMatchObject({ depth: 1, parentId: top.commentId });
    expect((await comment(ada, postId, 'x', 'missing')).status).toBe(404);
    expect((await comment(ada, postId, '')).status).toBe(400);
    expect((await thread(bo, postId)).post.comments).toBe(2);

    expect((await api.call('PUT', `/v1/forum/comments/${top.commentId}`, ada, { body: 'No' })).status).toBe(403);
    expect((await api.call('PUT', `/v1/forum/comments/${top.commentId}`, bo, { body: 'Yes!' })).body).toMatchObject({ body: 'Yes!' });
    expect((await api.call('DELETE', `/v1/forum/comments/${top.commentId}`, bo)).body).toMatchObject({ state: 'deleted', body: '', author: null });
    expect((await comment(ada, postId, 'Reply to deleted', top.commentId)).status).toBe(409);
  });

  it('are refused on a locked thread, which shows why', async () => {
    const postId = await created(ada);
    expect((await moderate(ma, postId, 'lock')).status).toBe(400);
    expect((await moderate(ma, postId, 'lock', 'Decided at the convention')).status).toBe(201);
    expect((await comment(bo, postId, 'Late')).status).toBe(409);
    expect((await thread(bo, postId)).post.lock).toMatchObject({ reason: 'Decided at the convention' });
    await moderate(ma, postId, 'unlock');
    expect((await comment(bo, postId, 'Now')).status).toBe(201);
  });
});

describe('moderation and reports', () => {
  it('a Membership Admin removes a post with a reason its author sees, ledgered; restoring brings it back', async () => {
    const postId = await created(ada);
    expect((await moderate(bo, postId, 'remove', 'Spam')).status).toBe(403);
    expect((await moderate(ea, postId, 'remove', 'Spam')).status).toBe(403);
    const removed = await moderate(ma, postId, 'remove', 'Off topic for the party');
    expect(removed.body).toMatchObject({ post: { state: 'removed', title: 'Adopt ranked choice', removal: { reason: 'Off topic for the party' }, reports: 0 } });
    expect((await thread(bo, postId)).post).toMatchObject({ state: 'removed', title: '', body: '', removal: null });
    expect((await thread(ada, postId)).post).toMatchObject({ title: 'Adopt ranked choice', removal: { reason: 'Off topic for the party' } });
    expect((await list(bo)).posts).toEqual([]);
    expect((await api.call('GET', '/v1/forum/posts?feed=removed', bo)).status).toBe(403);
    expect((await list(ma, '?feed=removed', true)).posts.map((p) => p.postId)).toEqual([postId]);
    expect((await vote(bo, postId, 1)).status).toBe(409);
    expect((await comment(bo, postId, 'Hi')).status).toBe(409);

    expect((await moderate(ma, postId, 'restore')).body).toMatchObject({ post: { state: 'visible', removal: null } });
    expect((await list(bo)).posts.map((p) => p.postId)).toEqual([postId]);
    expect((await entries('forum.moderated')).map((e) => [e.actor, e.subject, e.payload.action, e.payload.reason])).toEqual([
      [ma.accountId, ada.accountId, 'removed', 'Off topic for the party'],
      [ma.accountId, ada.accountId, 'restored', null],
    ]);
  });

  it('members report posts and comments; Membership Admins see them grouped, without who reported, and act or dismiss', async () => {
    const postId = await created(ada);
    const c = (await comment(ada, postId, 'Buy my book')).body as ForumCommentView;
    expect((await api.call('POST', `/v1/forum/posts/${postId}/report`, ada, { reason: 'spam' })).status).toBe(409);
    expect((await api.call('POST', `/v1/forum/posts/${postId}/report`, bo, { reason: 'off_topic', note: 'Not party business' })).status).toBe(204);
    expect((await api.call('POST', `/v1/forum/comments/${c.commentId}/report`, bo, { reason: 'spam' })).status).toBe(204);
    expect((await api.call('POST', `/v1/forum/posts/${postId}/report`, bo, { reason: 'nonsense' })).status).toBe(400);

    expect((await api.call('GET', '/v1/admin/forum/reports', ea)).status).toBe(403);
    const groups = (await api.call('GET', '/v1/admin/forum/reports', ma)).body as ForumReportGroup[];
    expect(groups.map((g) => [g.targetKind, g.count, g.reasons, g.notes])).toEqual([
      ['post', 1, { off_topic: 1 }, ['Not party business']],
      ['comment', 1, { spam: 1 }, []],
    ]);
    expect(JSON.stringify(groups)).not.toContain(bo.accountId);
    expect(groups[1]).toMatchObject({ post: { postId }, comment: { commentId: c.commentId, body: 'Buy my book' } });
    expect((await thread(ma, postId, true)).post.reports).toBe(1);

    const removed = await api.call('POST', `/v1/admin/forum/comments/${c.commentId}/moderation`, ma, { action: 'remove', reason: 'Advertising' });
    expect(removed.body).toMatchObject({ state: 'removed', removal: { reason: 'Advertising' } });
    expect((await thread(bo, postId)).comments).toMatchObject([{ state: 'removed', body: '', removal: null }]);
    expect((await api.call('POST', '/v1/admin/forum/reports/dismiss', ma, { targetKind: 'post', targetId: postId })).status).toBe(204);
    expect((await api.call('GET', '/v1/admin/forum/reports', ma)).body).toEqual([]);
    const statuses = (await api.firebase.db.collection('forum_reports').get()).docs.map((d) => [d.get('targetKind'), d.get('status')]).sort();
    expect(statuses).toEqual([
      ['comment', 'actioned'],
      ['post', 'dismissed'],
    ]);
  });
});

describe('putting a proposal on a ballot', () => {
  const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' };
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  let electionId: string;

  beforeEach(async () => {
    const res = await api.call('POST', '/v1/admin/elections', ea, { title: '2027 Platform Vote', secrecy: 'secret', opensAt: inDays(10), closesAt: inDays(12) });
    expect(res.status).toBe(201);
    electionId = res.body.electionId as string;
  });

  it('an Election Admin adds it to a draft election as a proposal question with its text frozen; the post links to it', async () => {
    const postId = await created(ada);
    const ballot = (by: User, body: Record<string, unknown> = {}) =>
      api.call('POST', `/v1/admin/forum/posts/${postId}/ballot`, by, { electionId, passRule: MAJORITY, ...body });
    expect((await ballot(ma)).status).toBe(403);
    expect((await ballot(ea, { electionId: 'nope' })).status).toBe(404);
    const res = await ballot(ea, { title: 'Plank 1: ranked choice' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ post: { ballots: [{ electionId, electionTitle: '2027 Platform Vote', state: 'draft' }] } });

    const detail = (await api.call('GET', `/v1/admin/elections/${electionId}`, ea)).body;
    const contest = detail.contests.find((c: { title: string }) => c.title === 'Plank 1: ranked choice');
    expect(contest).toMatchObject({ spec: { kind: 'proposal' } });
    const snapshots = (await api.call('GET', '/v1/admin/proposals', ea)).body as { title: string; body: string; source: string }[];
    expect(snapshots).toMatchObject([{ title: 'Adopt ranked choice', body: 'Use IRV for every office.', source: expect.stringContaining('Ada Brooks') }]);

    expect((await thread(bo, postId)).post.ballots).toMatchObject([{ electionTitle: '2027 Platform Vote', state: 'draft' }]);
    expect((await api.call('PUT', `/v1/forum/posts/${postId}`, ada, { title: 'Changed', body: 'Changed' })).status).toBe(409);
  });

  it('refuses a discussion, a removed post and an election that is not a draft', async () => {
    const discussion = await created(ada, { kind: 'discussion' });
    const body = { electionId, passRule: MAJORITY };
    expect((await api.call('POST', `/v1/admin/forum/posts/${discussion}/ballot`, ea, body)).status).toBe(409);
    const removed = await created(ada);
    await moderate(ma, removed, 'remove', 'Duplicate');
    expect((await api.call('POST', `/v1/admin/forum/posts/${removed}/ballot`, ea, body)).status).toBe(409);
    await api.firebase.db.collection('elections').doc(electionId).update({ state: 'scheduled' });
    expect((await api.call('POST', `/v1/admin/forum/posts/${await created(ada)}/ballot`, ea, body)).status).toBe(409);
  });
});
