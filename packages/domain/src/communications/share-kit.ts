import { z } from 'zod';
import { refuse, type Outcome } from '../check.js';
import type { LedgerEvent } from '../ledger-events.js';
import { addressSchema, basedOnSchema, changedFields, communicationsEvent, hashtagsSchema, oneLine, stale, text } from './common.js';

/**
 * The share kit (design §10.7): ready-made posts Communications Admins write for Active members to share from their own
 * accounts, with a share button per site. Publishing one, changing a published one and archiving it are ledgered.
 */

export const SHARE_POST_STATUSES = ['draft', 'published', 'archived'] as const;
export type SharePostStatus = (typeof SHARE_POST_STATUSES)[number];

export const SHARE_POST_LIMITS = { title: 80, text: 1000, note: 300 } as const;

const contentShape = {
  /** What it is about, for the kit's list and as the title email and Reddit get. */
  title: oneLine(SHARE_POST_LIMITS.title).pipe(z.string().min(1, 'enter a title')),
  /** The words members post. */
  text: text(SHARE_POST_LIMITS.text).pipe(z.string().min(1, 'enter the text to share')),
  /** What it links to: a page of this site (a news post's, say) or an `https://` address; empty for none. */
  url: addressSchema(true),
  hashtags: hashtagsSchema,
  /** For members: when or why to share it ("during the debate tonight"). */
  note: oneLine(SHARE_POST_LIMITS.note).default(''),
  /** The last day (UTC, `YYYY-MM-DD`) it is offered; null to keep it until it is archived. */
  until: z.iso.date({ message: 'a day as YYYY-MM-DD' }).nullable().default(null),
};

export const sharePostContentSchema = z.strictObject(contentShape);
export type SharePostContent = Readonly<z.output<typeof sharePostContentSchema>>;

export const createSharePostSchema = sharePostContentSchema;
export type CreateSharePostInput = z.infer<typeof createSharePostSchema>;

export const updateSharePostSchema = z.strictObject({ ...contentShape, basedOn: basedOnSchema });
export type UpdateSharePostInput = z.infer<typeof updateSharePostSchema>;

/** `POST …/share/{shareId}/publish` and `…/archive`. */
export const sharePostVersionSchema = z.strictObject({ basedOn: basedOnSchema });
export type SharePostVersionInput = z.infer<typeof sharePostVersionSchema>;

/** `share_posts/{shareId}` */
export interface SharePostRecord extends SharePostContent {
  readonly shareId: string;
  readonly status: SharePostStatus;
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly publishedAt: string | null;
}

const FIELDS = Object.keys(contentShape) as (keyof SharePostContent)[];

/** `share_post.changed` */
export interface SharePostChangedPayload {
  readonly shareId: string;
  readonly change: 'published' | 'updated' | 'archived';
  readonly title: string;
  readonly version: number;
  readonly fields?: readonly (keyof SharePostContent)[];
}

const shareEvent = (actor: string, post: SharePostRecord, change: SharePostChangedPayload['change'], fields?: (keyof SharePostContent)[]) =>
  communicationsEvent('share_post.changed', actor, post.shareId, {
    shareId: post.shareId,
    change,
    title: post.title,
    version: post.version,
    ...(fields && { fields }),
  } satisfies SharePostChangedPayload);

export function createSharePost(input: CreateSharePostInput, shareId: string, actor: string, at: string): SharePostRecord {
  return { shareId, ...input, status: 'draft', version: 1, createdAt: at, createdBy: actor, updatedAt: at, updatedBy: actor, publishedAt: null };
}

/** The post with new content; ledgered while members can see it. An archived post is kept as it was. */
export function updateSharePost(
  post: SharePostRecord | null,
  input: SharePostContent,
  basedOn: number,
  actor: string,
  at: string,
): Outcome<{ post: SharePostRecord; event: LedgerEvent | null }> {
  if (!post) return refuse('not_found', 'no such post');
  if (basedOn !== post.version) return refuse('conflict', stale('post'));
  if (post.status === 'archived') return refuse('conflict', 'an archived post is kept as it was; write a new one');
  const next = { ...post, ...input };
  const fields = changedFields(FIELDS, post, next);
  if (!fields.length) return { ok: true, value: { post, event: null } };
  const updated: SharePostRecord = { ...next, version: post.version + 1, updatedAt: at, updatedBy: actor };
  return { ok: true, value: { post: updated, event: post.status === 'published' ? shareEvent(actor, updated, 'updated', fields) : null } };
}

/** Offers a draft to members. */
export function publishSharePost(post: SharePostRecord | null, basedOn: number, actor: string, at: string): Outcome<{ post: SharePostRecord; event: LedgerEvent }> {
  if (!post) return refuse('not_found', 'no such post');
  if (basedOn !== post.version) return refuse('conflict', stale('post'));
  if (post.status !== 'draft') return refuse('conflict', post.status === 'published' ? 'it is already in the share kit' : 'an archived post stays archived');
  const published: SharePostRecord = { ...post, status: 'published', version: post.version + 1, updatedAt: at, updatedBy: actor, publishedAt: at };
  return { ok: true, value: { post: published, event: shareEvent(actor, published, 'published') } };
}

/** Takes a post out of the kit for good (its share counts are kept). */
export function archiveSharePost(post: SharePostRecord | null, basedOn: number, actor: string, at: string): Outcome<{ post: SharePostRecord; event: LedgerEvent }> {
  if (!post) return refuse('not_found', 'no such post');
  if (basedOn !== post.version) return refuse('conflict', stale('post'));
  if (post.status !== 'published') return refuse('conflict', 'only a post in the share kit can be archived; delete a draft instead');
  const archived: SharePostRecord = { ...post, status: 'archived', version: post.version + 1, updatedAt: at, updatedBy: actor };
  return { ok: true, value: { post: archived, event: shareEvent(actor, archived, 'archived') } };
}

export function checkDeleteSharePost(post: SharePostRecord | null): Outcome<SharePostRecord> {
  if (!post) return refuse('not_found', 'no such post');
  if (post.status !== 'draft') return refuse('conflict', 'a post members have seen is archived, not deleted');
  return { ok: true, value: post };
}

/** Whether members are offered it on `today` (UTC `YYYY-MM-DD`): published, and not past its last day. */
export function sharePostOffered(post: SharePostRecord, today: string): boolean {
  return post.status === 'published' && (post.until === null || post.until >= today);
}

/** `GET /v1/share`: a post as members see it, without who wrote it. */
export interface MemberSharePost extends SharePostContent {
  readonly shareId: string;
  readonly publishedAt: string;
}

export function memberSharePost(post: SharePostRecord): MemberSharePost {
  const { title, text, url, hashtags, note, until } = post;
  return { shareId: post.shareId, title, text, url, hashtags, note, until, publishedAt: post.publishedAt ?? post.updatedAt };
}
