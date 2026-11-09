import { Injectable } from '@nestjs/common';
import { NEWS_KIND_NAMES, type LinkPreview } from 'ustp-domain';
import { orNone, type LinkPreviewSource } from '../link-previews/link-previews.js';
import { NewsService } from './news.service.js';

/** "November 9, 2026", in UTC as the feeds date posts. */
export const longDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** A published post's link preview (design §15, "Link previews"): its title and summary, as its page shows them. */
@Injectable()
export class NewsPreviews implements LinkPreviewSource {
  readonly page = '/news/:slug';

  constructor(private readonly news: NewsService) {}

  async preview({ slug }: Readonly<Record<string, string>>): Promise<LinkPreview | null> {
    const post = await orNone(this.news.post(slug!));
    if (post?.status !== 'published') return null;
    return {
      title: post.title,
      description: post.summary,
      type: 'article',
      card: {
        kicker: post.kind === 'news' ? 'News' : `News · ${NEWS_KIND_NAMES[post.kind]}`,
        title: post.title,
        lines: [[post.dateline, longDay(post.publishedAt)].filter(Boolean).join(' · ')],
      },
    };
  }
}
