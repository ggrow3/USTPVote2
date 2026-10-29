import { z } from 'zod';
import { isUuidV7 } from '../ids.js';
import { SLUG } from './common.js';
import { SHARE_TARGETS, type ShareTarget } from './share.js';

/**
 * How often each share button is pressed (design §10.9): counts only, as the hub's clicks (§10.6). Nothing about who
 * pressed it is kept, and whether they then posted is the site's to know, not ours.
 */

/** What a button was on: a news post (by its address) or a share kit post (by its ID). */
export type ShareItem = `news-${string}` | `kit-${string}`;

export const newsItem = (slug: string): ShareItem => `news-${slug}`;
export const kitItem = (shareId: string): ShareItem => `kit-${shareId}`;

/** The kind and key of an item, or null if it is not one. */
export function parseShareItem(item: string): { kind: 'news'; slug: string } | { kind: 'kit'; shareId: string } | null {
  if (item.startsWith('news-') && SLUG.test(item.slice(5))) return { kind: 'news', slug: item.slice(5) };
  if (item.startsWith('kit-') && isUuidV7(item.slice(4))) return { kind: 'kit', shareId: item.slice(4) };
  return null;
}

/** `POST /v1/share/clicks`: a button pressed. */
export const shareClickSchema = z.strictObject({ item: z.string().max(100), target: z.enum(SHARE_TARGETS) });
export type ShareClickInput = z.infer<typeof shareClickSchema>;

/** `share_counts/{item}` */
export interface ShareCountsRecord {
  readonly item: ShareItem;
  readonly total: number;
  readonly targets: Readonly<Partial<Record<ShareTarget, number>>>;
  readonly firstAt: string;
  readonly lastAt: string;
}
