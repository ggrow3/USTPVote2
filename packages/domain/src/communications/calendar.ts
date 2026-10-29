import { z } from 'zod';
import { refuse, type Outcome } from '../check.js';
import { SOCIAL_NETWORKS, type SocialNetwork } from '../governance/hub.js';
import { addressSchema, basedOnSchema, oneLine, stale, text } from './common.js';

/**
 * The social media calendar (design §10.9): Communications Admins plan what the party's own accounts post, and when,
 * then mark each as posted with its link, or skipped. It is the team's own planning, so it is not ledgered; what is
 * posted is public on the site it went to.
 */

export const CALENDAR_STATUSES = ['planned', 'posted', 'skipped'] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];

export const CALENDAR_LIMITS = { account: 80, text: 5000, notes: 1000 } as const;

const isoDateTime = z.iso.datetime({ offset: true, message: 'a date and time' });

const contentShape = {
  network: z.enum(SOCIAL_NETWORKS),
  /** Which of the party's accounts on it ("@USTranshumanist"); empty when it has one. */
  account: oneLine(CALENDAR_LIMITS.account).default(''),
  /** When it should go out. */
  scheduledFor: isoDateTime,
  text: text(CALENDAR_LIMITS.text),
  /** What it links to: a page of this site or an `https://` address; empty for none. */
  url: addressSchema(true),
  /** A Communications Admin who will post it; null for anyone on the team. */
  assignee: z.string().trim().max(128).nullable().default(null),
  notes: text(CALENDAR_LIMITS.notes),
};

export const calendarContentSchema = z.strictObject(contentShape);
export type CalendarContent = Readonly<z.output<typeof calendarContentSchema>>;

export const createCalendarItemSchema = calendarContentSchema;
export type CreateCalendarItemInput = z.infer<typeof createCalendarItemSchema>;

export const updateCalendarItemSchema = z.strictObject({ ...contentShape, basedOn: basedOnSchema });
export type UpdateCalendarItemInput = z.infer<typeof updateCalendarItemSchema>;

/** `POST …/calendar/{itemId}/status`: posted (with the post's link), skipped, or planned again. */
export const calendarStatusSchema = z.strictObject({
  basedOn: basedOnSchema,
  status: z.enum(CALENDAR_STATUSES),
  postedUrl: addressSchema(false),
});
export type CalendarStatusInput = z.infer<typeof calendarStatusSchema>;

/** `calendar_items/{itemId}` */
export interface CalendarItemRecord extends CalendarContent {
  readonly itemId: string;
  readonly status: CalendarStatus;
  /** The post itself, once it is up; empty until then. */
  readonly postedUrl: string;
  readonly postedAt: string | null;
  readonly postedBy: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export function createCalendarItem(input: CreateCalendarItemInput, itemId: string, actor: string, at: string): CalendarItemRecord {
  return {
    itemId,
    ...input,
    scheduledFor: new Date(input.scheduledFor).toISOString(),
    status: 'planned',
    postedUrl: '',
    postedAt: null,
    postedBy: null,
    version: 1,
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
    updatedBy: actor,
  };
}

export function updateCalendarItem(
  item: CalendarItemRecord | null,
  input: CalendarContent,
  basedOn: number,
  actor: string,
  at: string,
): Outcome<CalendarItemRecord> {
  if (!item) return refuse('not_found', 'no such calendar item');
  if (basedOn !== item.version) return refuse('conflict', stale('calendar item'));
  return {
    ok: true,
    value: { ...item, ...input, scheduledFor: new Date(input.scheduledFor).toISOString(), version: item.version + 1, updatedAt: at, updatedBy: actor },
  };
}

/** Marks an item posted (its link is optional but asked for), skipped, or planned again. */
export function setCalendarStatus(item: CalendarItemRecord | null, input: CalendarStatusInput, actor: string, at: string): Outcome<CalendarItemRecord> {
  if (!item) return refuse('not_found', 'no such calendar item');
  if (input.basedOn !== item.version) return refuse('conflict', stale('calendar item'));
  const posted = input.status === 'posted';
  return {
    ok: true,
    value: {
      ...item,
      status: input.status,
      postedUrl: posted ? input.postedUrl : '',
      postedAt: posted ? (item.status === 'posted' ? item.postedAt : at) : null,
      postedBy: posted ? (item.status === 'posted' ? item.postedBy : actor) : null,
      version: item.version + 1,
      updatedAt: at,
      updatedBy: actor,
    },
  };
}

/** Still planned, and its time has passed. */
export function calendarItemOverdue(item: Pick<CalendarItemRecord, 'status' | 'scheduledFor'>, now: string): boolean {
  return item.status === 'planned' && item.scheduledFor < now;
}

/** How long the calendar keeps showing items done (posted or skipped): those planned for the last 90 days. */
export const CALENDAR_PAST_DAYS = 90;

/** The network an item is on, for the share button that opens its composer (`share.ts`), where there is one. */
export const COMPOSER_NETWORKS: readonly SocialNetwork[] = ['x', 'facebook', 'linkedin', 'bluesky', 'threads', 'mastodon', 'reddit', 'telegram'];
