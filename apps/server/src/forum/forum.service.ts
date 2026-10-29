import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  castVote,
  checkBallotable,
  checkDailyLimit,
  checkForumMember,
  commentView,
  deleteComment,
  deletePost,
  editComment,
  editPost,
  FORUM_LIMITS,
  hotRank,
  linkBallot,
  moderateComment,
  moderatePost,
  newComment,
  newPost,
  newReport,
  postView,
  reportGroups,
  uuidv7,
  type CreateCommentInput,
  type CreatePostInput,
  type DismissReportsInput,
  type EditCommentInput,
  type EditPostInput,
  type ForumBallotInput,
  type ForumBallotView,
  type ForumCommentRecord,
  type ForumCommentView,
  type ForumListQuery,
  type ForumPage,
  type ForumPostRecord,
  type ForumReportGroup,
  type ForumReportInput,
  type ForumTargetKind,
  type ForumThread,
  type ForumViewContext,
  type ForumViewer,
  type ForumVoteResult,
  type ForumVoteValue,
  type ModerationInput,
} from 'ustp-domain';
import type { RequestContext } from '../auth/principal.js';
import { accepted, assertCheck } from '../common/validation.js';
import { ElectionReader } from '../elections/election-reader.js';
import { ElectionsService } from '../elections/elections.service.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { ForumRepository } from './forum.repository.js';

/** Who is calling: an Active member (`/v1/forum`), or someone at the console (`/v1/admin/forum`; design §5.9). */
export interface ForumCaller extends ForumViewer {
  /** At the console: no membership needed, since the route checked the role. */
  readonly admin: boolean;
}

const DAY_MS = 86_400_000;

/**
 * The forum (design §5.9). Active members post, comment and vote through `/v1/forum`; Membership Admins moderate and
 * Election Admins put proposals on ballots through `/v1/admin/forum`. Each change runs in one transaction that re-reads
 * what it changes; moderation is ledgered with it (`forum.moderated`), posts, comments and votes are not.
 */
@Injectable()
export class ForumService {
  constructor(
    private readonly firebase: Firebase,
    private readonly forum: ForumRepository,
    private readonly ledger: LedgerService,
    private readonly members: MemberDirectory,
    private readonly elections: ElectionsService,
    private readonly electionReader: ElectionReader,
  ) {}

  /** A page of posts, with the pinned ones first on the first page. The removed list is for moderators. */
  async list(caller: ForumCaller, query: ForumListQuery): Promise<ForumPage> {
    await this.assertMember(caller);
    if (query.feed === 'removed' && !caller.moderator) throw new ForbiddenException('only Membership Admins see removed posts');
    const [found, pinned] = await Promise.all([
      this.forum.page(query.feed, query.sort, query.after, FORUM_LIMITS.page),
      query.after || query.feed === 'removed' ? Promise.resolve([]) : this.forum.pinned(),
    ]);
    if (!found) throw new NotFoundException('that page is gone; start from the first');
    const more = found.length > FORUM_LIMITS.page;
    const page = found.slice(0, FORUM_LIMITS.page);
    const pins = pinned.filter((p) => p.feeds.includes(query.feed)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const posts = page.filter((p) => !p.pinned || query.feed === 'removed');
    const ctx = await this.context(caller, [...pins, ...posts], [], (ids) => this.forum.votesOnPosts(caller.accountId, ids));
    const ballots = await this.ballots([...pins, ...posts]);
    const view = (p: ForumPostRecord) => postView(p, ctx, ballots.get(p.postId) ?? [], { excerpt: true });
    return { pinned: pins.map(view), posts: posts.map(view), next: more ? page[page.length - 1]!.postId : null };
  }

  /** A post and its comments. */
  async thread(caller: ForumCaller, postId: string): Promise<ForumThread> {
    await this.assertMember(caller);
    const [post, comments] = await Promise.all([this.forum.findPost(postId), this.forum.commentsOn(postId)]);
    if (!post) throw new NotFoundException('no such post');
    const ctx = await this.context(caller, [post], comments, () => this.forum.votesInThread(caller.accountId, postId));
    const ballots = await this.ballots([post]);
    return { post: postView(post, ctx, ballots.get(postId) ?? []), comments: comments.map((c) => commentView(c, ctx)) };
  }

  async create(caller: ForumCaller, input: CreatePostInput): Promise<ForumThread> {
    await this.assertMember(caller);
    await this.assertUnderLimit('post', caller.accountId);
    const postId = uuidv7();
    await this.firebase.db.runTransaction(async (tx) => {
      const { post, vote } = newPost(input, postId, caller.accountId, new Date().toISOString());
      this.forum.createPost(tx, post);
      this.forum.setVote(tx, vote);
    });
    return this.thread(caller, postId);
  }

  async edit(caller: ForumCaller, postId: string, input: EditPostInput): Promise<ForumThread> {
    await this.assertMember(caller);
    await this.firebase.db.runTransaction(async (tx) => {
      const post = accepted(editPost(await this.forum.getPost(tx, postId), input, caller.accountId, new Date().toISOString()));
      if (post) this.forum.setPost(tx, post);
    });
    return this.thread(caller, postId);
  }

  async delete(caller: ForumCaller, postId: string): Promise<ForumThread> {
    await this.assertMember(caller);
    await this.firebase.db.runTransaction(async (tx) => {
      this.forum.setPost(tx, accepted(deletePost(await this.forum.getPost(tx, postId), caller.accountId, new Date().toISOString())));
    });
    return this.thread(caller, postId);
  }

  async comment(caller: ForumCaller, postId: string, input: CreateCommentInput): Promise<ForumCommentView> {
    await this.assertMember(caller);
    await this.assertUnderLimit('comment', caller.accountId);
    const commentId = uuidv7();
    const made = await this.firebase.db.runTransaction(async (tx) => {
      const [post, parent] = await Promise.all([
        this.forum.getPost(tx, postId),
        input.parentId === null ? Promise.resolve(null) : this.forum.getComment(tx, input.parentId),
      ]);
      const { comment, post: counted, vote } = accepted(newComment(post, parent, input, commentId, caller.accountId, new Date().toISOString()));
      this.forum.createComment(tx, comment);
      this.forum.setPost(tx, counted);
      this.forum.setVote(tx, vote);
      return comment;
    });
    return this.commentAs(caller, made);
  }

  async editComment(caller: ForumCaller, commentId: string, input: EditCommentInput): Promise<ForumCommentView> {
    await this.assertMember(caller);
    const comment = await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.forum.getComment(tx, commentId);
      const edited = accepted(editComment(current, input, caller.accountId, new Date().toISOString()));
      if (edited) this.forum.setComment(tx, edited);
      return edited ?? current!;
    });
    return this.commentAs(caller, comment);
  }

  async deleteComment(caller: ForumCaller, commentId: string): Promise<ForumCommentView> {
    await this.assertMember(caller);
    const comment = await this.firebase.db.runTransaction(async (tx) => {
      const deleted = accepted(deleteComment(await this.forum.getComment(tx, commentId), caller.accountId, new Date().toISOString()));
      this.forum.setComment(tx, deleted);
      return deleted;
    });
    return this.commentAs(caller, comment);
  }

  /** The caller's vote on a post or comment, replacing theirs; 0 takes it back. */
  async vote(caller: ForumCaller, kind: ForumTargetKind, targetId: string, value: ForumVoteValue): Promise<ForumVoteResult> {
    await this.assertMember(caller);
    return this.firebase.db.runTransaction(async (tx) => {
      const [target, current] = await Promise.all([
        kind === 'post' ? this.forum.getPost(tx, targetId) : this.forum.getComment(tx, targetId),
        this.forum.getVote(tx, kind, targetId, caller.accountId),
      ]);
      const ids = { targetId, postId: target?.postId ?? targetId, accountId: caller.accountId };
      const { tally, vote } = accepted(castVote(target, kind, current, value, ids, new Date().toISOString()));
      if (kind === 'post') {
        const post = target as ForumPostRecord;
        this.forum.setPost(tx, { ...post, ...tally, hot: hotRank(tally.score, post.createdAt) });
      } else {
        this.forum.setComment(tx, { ...(target as ForumCommentRecord), ...tally });
      }
      if (vote) this.forum.setVote(tx, vote);
      else if (current) this.forum.deleteVote(tx, kind, targetId, caller.accountId);
      return { targetId, ...tally, myVote: value };
    });
  }

  /** The caller's report of a post or comment, replacing any they made of it before. */
  async report(caller: ForumCaller, kind: ForumTargetKind, targetId: string, input: ForumReportInput): Promise<void> {
    await this.assertMember(caller);
    await this.firebase.db.runTransaction(async (tx) => {
      const target = kind === 'post' ? await this.forum.getPost(tx, targetId) : await this.forum.getComment(tx, targetId);
      const ids = { targetId, postId: target?.postId ?? targetId };
      const report = accepted(newReport(target, kind, ids, input, caller.accountId, new Date().toISOString()));
      this.forum.setReport(tx, report);
    });
  }

  /** A Membership Admin's action on a post; removing it closes the reports on it as acted on. */
  async moderatePost(caller: ForumCaller, postId: string, input: ModerationInput): Promise<ForumThread> {
    await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.forum.getPost(tx, postId);
      const reports = input.action === 'remove' ? await this.forum.openReportsOn(tx, 'post', postId) : [];
      const at = new Date().toISOString();
      const { post, event } = accepted(moderatePost(current, input, caller.accountId, at));
      await this.ledger.record(tx, [event]);
      this.forum.setPost(tx, post);
      for (const r of reports) this.forum.setReport(tx, { ...r, status: 'actioned', decidedAt: at, decidedBy: caller.accountId });
    });
    return this.thread(caller, postId);
  }

  /** A Membership Admin removes or restores a comment; removing it closes the reports on it as acted on. */
  async moderateComment(caller: ForumCaller, commentId: string, input: ModerationInput): Promise<ForumCommentView> {
    const comment = await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.forum.getComment(tx, commentId);
      const reports = input.action === 'remove' ? await this.forum.openReportsOn(tx, 'comment', commentId) : [];
      const at = new Date().toISOString();
      const { comment: changed, event } = accepted(moderateComment(current, input, caller.accountId, at));
      await this.ledger.record(tx, [event]);
      this.forum.setComment(tx, changed);
      for (const r of reports) this.forum.setReport(tx, { ...r, status: 'actioned', decidedAt: at, decidedBy: caller.accountId });
      return changed;
    });
    return this.commentAs(caller, comment);
  }

  /** The open reports, grouped by post or comment, without who made them. */
  async reports(caller: ForumCaller): Promise<ForumReportGroup[]> {
    const open = await this.forum.openReports();
    const postIds = [...new Set(open.map((r) => r.postId))];
    const commentIds = [...new Set(open.filter((r) => r.targetKind === 'comment').map((r) => r.targetId))];
    const [posts, comments] = await Promise.all([
      Promise.all(postIds.map((id) => this.forum.findPost(id))),
      Promise.all(commentIds.map((id) => this.forum.findComment(id))),
    ]);
    const postsById = new Map(posts.flatMap((p) => (p ? [[p.postId, p] as const] : [])));
    const commentsById = new Map(comments.flatMap((c) => (c ? [[c.commentId, c] as const] : [])));
    const ctx = await this.context(caller, [...postsById.values()], [...commentsById.values()], async () => new Map());
    return reportGroups(open, (r) => {
      const post = postsById.get(r.postId);
      const comment = r.targetKind === 'comment' ? commentsById.get(r.targetId) : null;
      if (!post || comment === undefined) return null;
      return { post: postView(post, ctx, [], { excerpt: true }), comment: comment && commentView(comment, ctx) };
    });
  }

  /** Closes the open reports on a post or comment without acting on it. */
  async dismiss(caller: ForumCaller, input: DismissReportsInput): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const open = await this.forum.openReportsOn(tx, input.targetKind, input.targetId);
      if (!open.length) throw new NotFoundException('there are no open reports on it');
      const at = new Date().toISOString();
      for (const r of open) this.forum.setReport(tx, { ...r, status: 'dismissed', decidedAt: at, decidedBy: caller.accountId });
    });
  }

  /**
   * An Election Admin puts a proposal on a draft election (design §5.9, §6.4): its title and text are frozen as a
   * proposal snapshot naming the post as its source, a proposal question pointing at it is added to the election, and
   * the post records the election. Each step is the election editor's own, with its checks (a draft, no recusal).
   */
  async putOnBallot(ctx: RequestContext, caller: ForumCaller, postId: string, input: ForumBallotInput): Promise<ForumThread> {
    const post = await this.forum.findPost(postId);
    assertCheck(checkBallotable(post));
    const election = await this.electionReader.find(input.electionId);
    if (!election) throw new NotFoundException('no such election');
    const [author] = await this.members.findMany([post!.authorId]);
    const by = author ? (author.preferredName ?? author.legalName) : 'a member';
    const snapshot = await this.elections.createProposal(ctx, {
      title: post!.title,
      body: post!.body,
      source: `Forum proposal by ${by}, posted ${post!.createdAt.slice(0, 10)} (post ${postId})`,
    });
    const contest = await this.elections.addContest(ctx, input.electionId, {
      kind: 'proposal',
      title: input.title ?? post!.title,
      description: '',
      proposalSnapshotId: snapshot.snapshotId,
      passRule: input.passRule,
      ...(input.quorum && { quorum: input.quorum }),
    });
    await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.forum.getPost(tx, postId);
      const link = {
        electionId: election.electionId,
        electionTitle: election.title,
        contestId: contest.contestId,
        snapshotId: snapshot.snapshotId,
        contentHash: snapshot.contentHash,
        at: new Date().toISOString(),
        by: caller.accountId,
      };
      this.forum.setPost(tx, accepted(linkBallot(current, link)));
    });
    return this.thread(caller, postId);
  }

  private async commentAs(caller: ForumCaller, comment: ForumCommentRecord): Promise<ForumCommentView> {
    const ctx = await this.context(caller, [], [comment], () => this.forum.votesInThread(caller.accountId, comment.postId));
    return commentView(comment, ctx);
  }

  /** What views need: the authors' names, the caller's votes, and for moderators the open reports. */
  private async context(
    caller: ForumCaller,
    posts: readonly ForumPostRecord[],
    comments: readonly ForumCommentRecord[],
    votes: (postIds: string[]) => Promise<Map<string, ForumVoteValue>>,
  ): Promise<ForumViewContext> {
    const ids = [...new Set([...posts.map((p) => p.authorId), ...comments.map((c) => c.authorId)])];
    const postIds = [...new Set([...posts.map((p) => p.postId), ...comments.map((c) => c.postId)])];
    const [records, mine, reports] = await Promise.all([
      this.members.findMany(ids),
      votes(posts.map((p) => p.postId)),
      caller.moderator ? this.forum.openReportCounts(postIds) : Promise.resolve(undefined),
    ]);
    const people = new Map(ids.map((id, i) => [id, { name: records[i] ? (records[i]!.preferredName ?? records[i]!.legalName) : 'Unknown member', state: records[i]?.state ?? '' }]));
    return { viewer: caller, people, votes: mine, ...(reports && { reports }) };
  }

  /** Where each election the posts were put on is now, by post ID. */
  private async ballots(posts: readonly ForumPostRecord[]): Promise<Map<string, ForumBallotView[]>> {
    const electionIds = [...new Set(posts.flatMap((p) => p.ballots.map((b) => b.electionId)))];
    const elections = await Promise.all(electionIds.map((id) => this.electionReader.find(id)));
    const byId = new Map(electionIds.map((id, i) => [id, elections[i]]));
    return new Map(
      posts.map((p) => [
        p.postId,
        p.ballots.map((b) => {
          const election = byId.get(b.electionId);
          return {
            electionId: b.electionId,
            contestId: b.contestId,
            at: b.at,
            electionTitle: election?.title ?? b.electionTitle,
            state: election?.state ?? 'deleted',
          };
        }),
      ]),
    );
  }

  /** Members must be Active; at the console, the route already checked the role. */
  private async assertMember(caller: ForumCaller): Promise<void> {
    if (caller.admin) return;
    assertCheck(checkForumMember((await this.members.find(caller.accountId))?.status));
  }

  private async assertUnderLimit(kind: ForumTargetKind, accountId: string): Promise<void> {
    assertCheck(checkDailyLimit(kind, await this.forum.madeSince(kind, accountId, new Date(Date.now() - DAY_MS).toISOString())));
  }
}

/** Members' views are Active members'; Membership Admins at the console moderate. */
export function memberCaller(accountId: string): ForumCaller {
  return { accountId, moderator: false, admin: false };
}

export function consoleCaller(ctx: RequestContext, accountId: string): ForumCaller {
  return { accountId, moderator: ctx.roles.includes('membership_admin'), admin: true };
}
