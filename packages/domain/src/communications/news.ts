import { z } from 'zod';
import { refuse, type Outcome } from '../check.js';
import type { LedgerEvent } from '../ledger-events.js';
import { basedOnSchema, changedFields, communicationsEvent, hashtagsSchema, oneLine, slugSchema, stale, text } from './common.js';

/**
 * News and press releases (design §10.7): what the party says in public, on the News page and in the news feeds. A
 * Communications Admin drafts, publishes, edits and withdraws them alone; each publication, edit of a published post and
 * withdrawal is in the audit ledger. Drafts are the team's own work and are not.
 */

export const NEWS_KINDS = ['press_release', 'statement', 'news'] as const;
export type NewsKind = (typeof NEWS_KINDS)[number];

export const NEWS_STATUSES = ['draft', 'published', 'withdrawn'] as const;
export type NewsStatus = (typeof NEWS_STATUSES)[number];

export const NEWS_LIMITS = { title: 140, summary: 300, body: 20_000, dateline: 80 } as const;

/** The most posts the news feeds list, newest first. */
export const FEED_SIZE = 50;

const contentShape = {
  kind: z.enum(NEWS_KINDS),
  title: oneLine(NEWS_LIMITS.title).pipe(z.string().min(1, 'enter a title')),
  /** One or two sentences: the list's text, the page's description, and what share buttons and feeds carry. */
  summary: oneLine(NEWS_LIMITS.summary).default(''),
  /** Plain text (`news-body.ts`). */
  body: text(NEWS_LIMITS.body),
  /** Where it is from, as press releases open ("Washington, D.C."); empty for none. */
  dateline: oneLine(NEWS_LIMITS.dateline).default(''),
  hashtags: hashtagsSchema,
};

export const newsContentSchema = z.strictObject(contentShape);
export type NewsContent = Readonly<z.output<typeof newsContentSchema>>;

/** `POST /v1/admin/communications/news`: a new draft and its address. */
export const createNewsSchema = z.strictObject({ ...contentShape, slug: slugSchema });
export type CreateNewsInput = z.infer<typeof createNewsSchema>;

/** `PUT /v1/admin/communications/news/{postId}`: the content (and, while a draft, its address) from the version edited. */
export const updateNewsSchema = z.strictObject({ ...contentShape, slug: slugSchema, basedOn: basedOnSchema });
export type UpdateNewsInput = z.infer<typeof updateNewsSchema>;

/** `POST …/news/{postId}/publish` and `…/withdraw`: the version it was looked at. */
export const newsVersionSchema = z.strictObject({ basedOn: basedOnSchema });
export type NewsVersionInput = z.infer<typeof newsVersionSchema>;

/** `news_posts/{postId}` */
export interface NewsPostRecord extends NewsContent {
  readonly postId: string;
  /** Its page is `/news/{slug}`; fixed once it is first published, so links to it keep working. */
  readonly slug: string;
  readonly status: NewsStatus;
  /** Counts saves, so a change made from an older copy is refused instead of undoing someone else's. */
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  /** When it was first published: the date it carries. Kept when it is withdrawn and published again. */
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  /** When its published text last changed, if it has since it was first published. */
  readonly editedAt: string | null;
  readonly withdrawnAt: string | null;
  readonly withdrawnBy: string | null;
}

const CONTENT = Object.keys(contentShape) as (keyof NewsContent)[];
type Field = keyof NewsContent | 'slug';
const FIELDS: readonly Field[] = [...CONTENT, 'slug'];

/** `news.published`, `news.changed` and `news.withdrawn`. */
export interface NewsEventPayload {
  readonly postId: string;
  readonly slug: string;
  readonly kind: NewsKind;
  readonly title: string;
  readonly version: number;
  /** `news.changed`: the fields whose published text changed. */
  readonly fields?: readonly Field[];
}

function newsEvent(type: 'news.published' | 'news.changed' | 'news.withdrawn', actor: string, post: NewsPostRecord, fields?: Field[]) {
  const payload: NewsEventPayload = { postId: post.postId, slug: post.slug, kind: post.kind, title: post.title, version: post.version, ...(fields && { fields }) };
  return communicationsEvent(type, actor, post.postId, payload);
}

/** What a post needs before it can be published: a summary and a body, besides its title. */
export function publishProblem(content: Pick<NewsContent, 'summary' | 'body'>): string | null {
  if (!content.summary) return 'add a summary before publishing: share buttons and the news feeds carry it';
  if (!content.body) return 'add the text before publishing';
  return null;
}

/** A new draft; its address must not be another post's (checked by the caller). */
export function createNews(input: CreateNewsInput, postId: string, slugTaken: boolean, actor: string, at: string): Outcome<NewsPostRecord> {
  if (slugTaken) return refuse('conflict', `another post already uses the address /news/${input.slug}`);
  const { slug, ...content } = input;
  return {
    ok: true,
    value: {
      postId,
      slug,
      ...content,
      status: 'draft',
      version: 1,
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
      updatedBy: actor,
      publishedAt: null,
      publishedBy: null,
      editedAt: null,
      withdrawnAt: null,
      withdrawnBy: null,
    },
  };
}

/**
 * The post with new content, from the version it was edited from. Its address changes only while it has never been
 * published. An edit of a published post is ledgered with the fields that changed; a draft's is not.
 */
export function updateNews(
  post: NewsPostRecord | null,
  input: Omit<UpdateNewsInput, 'basedOn'>,
  basedOn: number,
  slugTaken: boolean,
  actor: string,
  at: string,
): Outcome<{ post: NewsPostRecord; event: LedgerEvent | null }> {
  if (!post) return refuse('not_found', 'no such post');
  if (basedOn !== post.version) return refuse('conflict', stale('post'));
  if (input.slug !== post.slug) {
    if (post.publishedAt) return refuse('conflict', 'a post keeps its address once it has been published, so links to it keep working');
    if (slugTaken) return refuse('conflict', `another post already uses the address /news/${input.slug}`);
  }
  const next = { ...post, ...input };
  const fields = changedFields(FIELDS, post, next);
  if (!fields.length) return { ok: true, value: { post, event: null } };
  if (post.status === 'published') {
    const problem = publishProblem(next);
    if (problem) return refuse('conflict', problem);
  }
  const updated: NewsPostRecord = {
    ...next,
    version: post.version + 1,
    updatedAt: at,
    updatedBy: actor,
    editedAt: post.status === 'published' ? at : post.editedAt,
  };
  const event = post.status === 'published' ? newsEvent('news.changed', actor, updated, fields) : null;
  return { ok: true, value: { post: updated, event } };
}

/** Publishes a draft or a withdrawn post: it is public at once, and ledgered. */
export function publishNews(post: NewsPostRecord | null, basedOn: number, actor: string, at: string): Outcome<{ post: NewsPostRecord; event: LedgerEvent }> {
  if (!post) return refuse('not_found', 'no such post');
  if (basedOn !== post.version) return refuse('conflict', stale('post'));
  if (post.status === 'published') return refuse('conflict', 'it is already published');
  const problem = publishProblem(post);
  if (problem) return refuse('conflict', problem);
  const published: NewsPostRecord = {
    ...post,
    status: 'published',
    version: post.version + 1,
    updatedAt: at,
    updatedBy: actor,
    publishedAt: post.publishedAt ?? at,
    publishedBy: post.publishedBy ?? actor,
    withdrawnAt: null,
    withdrawnBy: null,
  };
  return { ok: true, value: { post: published, event: newsEvent('news.published', actor, published) } };
}

/** Withdraws a published post: it leaves the News page and the feeds, and its page says it was withdrawn. */
export function withdrawNews(post: NewsPostRecord | null, basedOn: number, actor: string, at: string): Outcome<{ post: NewsPostRecord; event: LedgerEvent }> {
  if (!post) return refuse('not_found', 'no such post');
  if (basedOn !== post.version) return refuse('conflict', stale('post'));
  if (post.status !== 'published') return refuse('conflict', 'only a published post can be withdrawn');
  const withdrawn: NewsPostRecord = { ...post, status: 'withdrawn', version: post.version + 1, updatedAt: at, updatedBy: actor, withdrawnAt: at, withdrawnBy: actor };
  return { ok: true, value: { post: withdrawn, event: newsEvent('news.withdrawn', actor, withdrawn) } };
}

/** Only a draft that was never published can be deleted; a published post is withdrawn instead, and stays on record. */
export function checkDeleteNews(post: NewsPostRecord | null): Outcome<NewsPostRecord> {
  if (!post) return refuse('not_found', 'no such post');
  if (post.publishedAt) return refuse('conflict', 'a post that has been published is withdrawn, not deleted');
  return { ok: true, value: post };
}

/** A post in the News list and the feeds: what the public sees, without who wrote it. */
export interface PublicNewsSummary {
  readonly slug: string;
  readonly kind: NewsKind;
  readonly title: string;
  readonly summary: string;
  readonly dateline: string;
  readonly hashtags: readonly string[];
  readonly publishedAt: string;
  readonly editedAt: string | null;
}

/** `GET /v1/news/{slug}`: a published post in full, or the notice that it was withdrawn. */
export type PublicNewsPost =
  | (PublicNewsSummary & { readonly status: 'published'; readonly body: string })
  | { readonly status: 'withdrawn'; readonly slug: string; readonly title: string; readonly withdrawnAt: string };

export function newsSummary(post: NewsPostRecord): PublicNewsSummary {
  return {
    slug: post.slug,
    kind: post.kind,
    title: post.title,
    summary: post.summary,
    dateline: post.dateline,
    hashtags: post.hashtags,
    publishedAt: post.publishedAt ?? post.updatedAt,
    editedAt: post.editedAt,
  };
}

/** What `GET /v1/news/{slug}` shows of a post, or null when the public may not see it (a draft). */
export function publicNewsPost(post: NewsPostRecord): PublicNewsPost | null {
  if (post.status === 'published') return { ...newsSummary(post), status: 'published', body: post.body };
  if (post.status === 'withdrawn') return { status: 'withdrawn', slug: post.slug, title: post.title, withdrawnAt: post.withdrawnAt ?? post.updatedAt };
  return null;
}

/** Published posts, newest first. */
export function publishedNews(posts: readonly NewsPostRecord[]): NewsPostRecord[] {
  return posts.filter((p) => p.status === 'published').sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
}
