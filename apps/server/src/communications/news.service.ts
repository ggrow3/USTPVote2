import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  checkDeleteNews,
  createNews,
  FEED_SIZE,
  jsonFeed,
  newsSummary,
  publicNewsPost,
  publishedNews,
  publishNews,
  rssFeed,
  updateNews,
  uploadedVideoIds,
  uuidv7,
  withdrawNews,
  type CreateNewsInput,
  type FeedSite,
  type JsonFeed,
  type LedgerEvent,
  type NewsPostRecord,
  type Outcome,
  type PublicNewsPost,
  type PublicNewsSummary,
  type UpdateNewsInput,
} from 'ustp-domain';
import { HubService } from '../administration/hub.js';
import { accepted } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { VideosService } from '../videos/videos.js';
import { CommunicationsRepository } from './communications.repository.js';

/** The public list and feeds are read by every visitor and every bot, so each api instance keeps them for this long. */
const CACHE_MS = 30_000;

/**
 * News and press releases (design §10.9): the public News page and feeds, and Communications Admins' drafts. Each
 * publication, edit of a published post and withdrawal is ledgered in the transaction that makes it.
 */
@Injectable()
export class NewsService {
  private cache: { at: number; posts: NewsPostRecord[] } | null = null;

  constructor(
    private readonly firebase: Firebase,
    private readonly repo: CommunicationsRepository,
    private readonly ledger: LedgerService,
    private readonly hub: HubService,
    private readonly videos: VideosService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  // --- Public ------------------------------------------------------------------------------------------------------

  /** Published posts, newest first (cached briefly). */
  private async published(): Promise<NewsPostRecord[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.posts;
    const posts = publishedNews(await this.repo.publicNews());
    this.cache = { at: Date.now(), posts };
    return posts;
  }

  async list(): Promise<PublicNewsSummary[]> {
    return (await this.published()).map(newsSummary);
  }

  /** A published post, or the notice that one was withdrawn; 404 for anything else. */
  async post(slug: string): Promise<PublicNewsPost> {
    const post = await this.repo.newsBySlug(slug);
    const shown = post && publicNewsPost(post);
    if (!shown) throw new NotFoundException('no such post');
    return shown;
  }

  /** The feeds' site: where the web app is (WEB_ORIGIN, else where this request came to), and the hub's name. */
  private async site(requestOrigin: string): Promise<FeedSite> {
    const { profile } = await this.hub.shown();
    return { origin: (this.config.webOrigin ?? requestOrigin).replace(/\/$/, ''), name: profile.name, description: profile.tagline || profile.name };
  }

  async rss(requestOrigin: string): Promise<string> {
    return rssFeed(await this.site(requestOrigin), (await this.published()).slice(0, FEED_SIZE));
  }

  async json(requestOrigin: string): Promise<JsonFeed> {
    return jsonFeed(await this.site(requestOrigin), (await this.published()).slice(0, FEED_SIZE));
  }

  // --- Communications Admins ---------------------------------------------------------------------------------------

  /** Every post: drafts first, most recently changed first, then the rest newest first. */
  async all(): Promise<NewsPostRecord[]> {
    const posts = await this.repo.allNews();
    const rank = (p: NewsPostRecord) => (p.status === 'draft' ? 0 : 1);
    const when = (p: NewsPostRecord) => (p.status === 'draft' ? p.updatedAt : (p.publishedAt ?? p.updatedAt));
    return posts.sort((a, b) => rank(a) - rank(b) || when(b).localeCompare(when(a)));
  }

  async detail(postId: string): Promise<NewsPostRecord> {
    const post = await this.repo.findNews(postId);
    if (!post) throw new NotFoundException('no such post');
    return post;
  }

  async create(actor: string, input: CreateNewsInput): Promise<NewsPostRecord> {
    const postId = uuidv7();
    await this.firebase.db.runTransaction(async (tx) => {
      const taken = !!(await this.repo.newsBySlug(input.slug, tx));
      await this.videos.requireReady(uploadedVideoIds([input.video]), tx);
      this.repo.setNews(tx, accepted(createNews(input, postId, taken, actor, new Date().toISOString())));
    });
    return this.detail(postId);
  }

  async update(actor: string, postId: string, input: UpdateNewsInput): Promise<NewsPostRecord> {
    const { basedOn, ...content } = input;
    return this.change(postId, async (tx, post) => {
      const other = content.slug === post?.slug ? null : await this.repo.newsBySlug(content.slug, tx);
      await this.videos.requireReady(uploadedVideoIds([content.video]), tx);
      return updateNews(post, content, basedOn, !!other && other.postId !== postId, actor, new Date().toISOString());
    });
  }

  async publish(actor: string, postId: string, basedOn: number): Promise<NewsPostRecord> {
    return this.change(postId, async (_tx, post) => publishNews(post, basedOn, actor, new Date().toISOString()));
  }

  async withdraw(actor: string, postId: string, basedOn: number): Promise<NewsPostRecord> {
    return this.change(postId, async (_tx, post) => withdrawNews(post, basedOn, actor, new Date().toISOString()));
  }

  /** Deletes a draft that was never published. */
  async delete(postId: string): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const post = accepted(checkDeleteNews(await this.repo.getNews(tx, postId)));
      this.repo.deleteNews(tx, post.postId);
    });
  }

  /** Runs a change to one post in a transaction: its ledger entry first (it reads the ledger head), then the post. */
  private async change(
    postId: string,
    act: (tx: Transaction, post: NewsPostRecord | null) => Promise<Outcome<{ post: NewsPostRecord; event: LedgerEvent | null }>>,
  ): Promise<NewsPostRecord> {
    const saved = await this.firebase.db.runTransaction(async (tx) => {
      const { post, event } = accepted(await act(tx, await this.repo.getNews(tx, postId)));
      if (event) await this.ledger.record(tx, [event]);
      this.repo.setNews(tx, post);
      return post;
    });
    this.cache = null;
    return saved;
  }
}
