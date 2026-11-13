import { Injectable } from '@nestjs/common';
import { Collections } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/**
 * The forum context's port for the others (design §3.3): whether someone has taken part, read only. The join funnel
 * (§5.15) counts new members who have.
 */
@Injectable()
export class ForumActivity {
  constructor(private readonly firebase: Firebase) {}

  /** Whether the account has written a post or a comment. */
  async hasPosted(accountId: string): Promise<boolean> {
    const db = this.firebase.db;
    const wrote = async (collection: string) => !(await db.collection(collection).where('authorId', '==', accountId).limit(1).get()).empty;
    const [post, comment] = await Promise.all([wrote(Collections.forumPosts), wrote(Collections.forumComments)]);
    return post || comment;
  }
}
