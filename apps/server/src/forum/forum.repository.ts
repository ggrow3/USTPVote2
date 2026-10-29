import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  Collections,
  FORUM_LIMITS,
  forumVoteId,
  type ForumCommentRecord,
  type ForumFeed,
  type ForumPostRecord,
  type ForumReportRecord,
  type ForumSort,
  type ForumTargetKind,
  type ForumVoteRecord,
  type ForumVoteValue,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/** The field each sort orders a list by. */
const SORT_FIELDS: Readonly<Record<ForumSort, keyof ForumPostRecord>> = { hot: 'hot', new: 'createdAt', top: 'score' };

/**
 * Storage of the forum (design §5.8, §11): `forum_posts`, `forum_comments`, `forum_votes` and `forum_reports`. Only the
 * forum context uses it. A list is one query on the `feeds` a post is in, ordered by its sort's field (composite
 * indexes in `firestore.indexes.json`); post and comment IDs are UUIDv7, so ID order is the order they were made.
 */
@Injectable()
export class ForumRepository {
  constructor(private readonly firebase: Firebase) {}

  private posts() {
    return this.firebase.db.collection(Collections.forumPosts);
  }

  private comments() {
    return this.firebase.db.collection(Collections.forumComments);
  }

  private votes() {
    return this.firebase.db.collection(Collections.forumVotes);
  }

  private reports() {
    return this.firebase.db.collection(Collections.forumReports);
  }

  async findPost(postId: string): Promise<ForumPostRecord | null> {
    return ((await this.posts().doc(postId).get()).data() as ForumPostRecord | undefined) ?? null;
  }

  async getPost(tx: Transaction, postId: string): Promise<ForumPostRecord | null> {
    return ((await tx.get(this.posts().doc(postId))).data() as ForumPostRecord | undefined) ?? null;
  }

  /**
   * One page of a list, best first by `sort`, after the post `after` (null if that post is gone), with one more than
   * `limit` so the caller knows whether another page follows.
   */
  async page(feed: ForumFeed, sort: ForumSort, after: string | undefined, limit: number): Promise<ForumPostRecord[] | null> {
    let query = this.posts().where('feeds', 'array-contains', feed).orderBy(SORT_FIELDS[sort], 'desc');
    if (after) {
      const last = await this.posts().doc(after).get();
      if (!last.exists) return null;
      query = query.startAfter(last);
    }
    return (await query.limit(limit + 1).get()).docs.map((d) => d.data() as ForumPostRecord);
  }

  async pinned(): Promise<ForumPostRecord[]> {
    return (await this.posts().where('pinned', '==', true).get()).docs.map((d) => d.data() as ForumPostRecord);
  }

  /** The post's comments, the first `FORUM_LIMITS.thread` made. */
  async commentsOn(postId: string): Promise<ForumCommentRecord[]> {
    const snap = await this.comments().where('postId', '==', postId).limit(FORUM_LIMITS.thread).get();
    return snap.docs.map((d) => d.data() as ForumCommentRecord);
  }

  async findComment(commentId: string): Promise<ForumCommentRecord | null> {
    return ((await this.comments().doc(commentId).get()).data() as ForumCommentRecord | undefined) ?? null;
  }

  async getComment(tx: Transaction, commentId: string): Promise<ForumCommentRecord | null> {
    return ((await tx.get(this.comments().doc(commentId))).data() as ForumCommentRecord | undefined) ?? null;
  }

  /** How many posts or comments the member made since `since`, for the daily limits. */
  async madeSince(kind: ForumTargetKind, accountId: string, since: string): Promise<number> {
    const collection = kind === 'post' ? this.posts() : this.comments();
    const snap = await collection.where('authorId', '==', accountId).where('createdAt', '>=', since).count().get();
    return snap.data().count;
  }

  /** The member's votes on these posts, by post ID. */
  async votesOnPosts(accountId: string, postIds: readonly string[]): Promise<Map<string, ForumVoteValue>> {
    if (!postIds.length) return new Map();
    const snaps = await this.firebase.db.getAll(...postIds.map((id) => this.votes().doc(forumVoteId('post', id, accountId))));
    return new Map(snaps.filter((s) => s.exists).map((s) => [s.get('targetId') as string, s.get('value') as ForumVoteValue]));
  }

  /** The member's votes on a post and its comments, by target ID. */
  async votesInThread(accountId: string, postId: string): Promise<Map<string, ForumVoteValue>> {
    const snap = await this.votes().where('postId', '==', postId).where('accountId', '==', accountId).get();
    return new Map(snap.docs.map((d) => [d.get('targetId') as string, d.get('value') as ForumVoteValue]));
  }

  async getVote(tx: Transaction, kind: ForumTargetKind, targetId: string, accountId: string): Promise<ForumVoteRecord | null> {
    return ((await tx.get(this.votes().doc(forumVoteId(kind, targetId, accountId)))).data() as ForumVoteRecord | undefined) ?? null;
  }

  /** Every open report, on any post or comment. */
  async openReports(): Promise<ForumReportRecord[]> {
    return (await this.reports().where('status', '==', 'open').get()).docs.map((d) => d.data() as ForumReportRecord);
  }

  /** Open reports on a post and its comments, by target ID. */
  async openReportCounts(postIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const postId of new Set(postIds)) {
      const snap = await this.reports().where('postId', '==', postId).get();
      for (const r of snap.docs.map((d) => d.data() as ForumReportRecord)) {
        if (r.status === 'open') counts.set(r.targetId, (counts.get(r.targetId) ?? 0) + 1);
      }
    }
    return counts;
  }

  /** The open reports on a post or comment, read in `tx`. */
  async openReportsOn(tx: Transaction, kind: ForumTargetKind, targetId: string): Promise<ForumReportRecord[]> {
    const snap = await tx.get(this.reports().where('targetId', '==', targetId));
    return snap.docs.map((d) => d.data() as ForumReportRecord).filter((r) => r.targetKind === kind && r.status === 'open');
  }

  createPost(tx: Transaction, post: ForumPostRecord): void {
    tx.create(this.posts().doc(post.postId), post);
  }

  setPost(tx: Transaction, post: ForumPostRecord): void {
    tx.set(this.posts().doc(post.postId), post);
  }

  createComment(tx: Transaction, comment: ForumCommentRecord): void {
    tx.create(this.comments().doc(comment.commentId), comment);
  }

  setComment(tx: Transaction, comment: ForumCommentRecord): void {
    tx.set(this.comments().doc(comment.commentId), comment);
  }

  setVote(tx: Transaction, vote: ForumVoteRecord): void {
    tx.set(this.votes().doc(forumVoteId(vote.targetKind, vote.targetId, vote.accountId)), vote);
  }

  deleteVote(tx: Transaction, kind: ForumTargetKind, targetId: string, accountId: string): void {
    tx.delete(this.votes().doc(forumVoteId(kind, targetId, accountId)));
  }

  setReport(tx: Transaction, report: ForumReportRecord): void {
    tx.set(this.reports().doc(report.reportId), report);
  }
}
