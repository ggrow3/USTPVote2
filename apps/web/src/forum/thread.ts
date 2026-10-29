import type { InjectionKey } from 'vue';
import type { ForumCommentView, ForumVoteValue } from 'ustp-domain';

/** What a thread page lets each comment in it do, for its comments however deep they nest. */
export interface ThreadActions {
  /** Voting, replying, reporting and changing one's own: an Active member on the member page. */
  readonly interactive: () => boolean;
  /** New comments and replies: the thread is open. */
  readonly open: () => boolean;
  /** Removing and restoring: a Membership Admin. */
  readonly moderator: () => boolean;
  vote(comment: ForumCommentView, value: ForumVoteValue): void;
  /** Resolves whether the reply was posted. */
  reply(parent: ForumCommentView, body: string): Promise<boolean>;
  edit(comment: ForumCommentView, body: string): Promise<boolean>;
  remove(comment: ForumCommentView): void;
  report(comment: ForumCommentView): void;
  moderate(comment: ForumCommentView, action: 'remove' | 'restore'): void;
}

export const THREAD_ACTIONS: InjectionKey<ThreadActions> = Symbol('forum-thread');
