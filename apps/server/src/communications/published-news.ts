import { Injectable } from '@nestjs/common';
import { Collections, type NewsPostRecord } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/**
 * The communications context's port for the others (design §3.3): the news posts published since a moment, read only.
 * The weekly digest (§10.14) lists them.
 */
@Injectable()
export class PublishedNews {
  constructor(private readonly firebase: Firebase) {}

  /** Posts first published at or after `since` that are still published, newest first. */
  async since(since: string): Promise<Pick<NewsPostRecord, 'title' | 'slug' | 'publishedAt'>[]> {
    const snap = await this.firebase.db.collection(Collections.newsPosts).where('publishedAt', '>=', since).get();
    return snap.docs
      .map((d) => d.data() as NewsPostRecord)
      .filter((post) => post.status === 'published')
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
      .map(({ title, slug, publishedAt }) => ({ title, slug, publishedAt }));
  }
}
