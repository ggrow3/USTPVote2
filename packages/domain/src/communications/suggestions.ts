import { z } from 'zod';
import { refuse, type Check, OK } from '../check.js';
import { oneLine, text } from './common.js';

/**
 * Suggestions (design §10.9): a public form anyone may send, signed in or not, member or not, read by Communications
 * Admins only. A name and email are optional, kept only with the sender's consent so the party can reply, and every
 * suggestion is deleted a year after it arrives. Nothing here is ledgered: the ledger cannot be erased.
 */

export const SUGGESTION_TOPICS = ['policy', 'campaigns', 'events', 'media', 'website', 'membership', 'other'] as const;
export type SuggestionTopic = (typeof SUGGESTION_TOPICS)[number];

export const SUGGESTION_STATUSES = ['new', 'read', 'answered', 'archived', 'spam'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const SUGGESTION_LIMITS = { message: 4000, minMessage: 10, name: 100, email: 254, note: 1000 } as const;

/** How long a suggestion is kept, from when it arrived. */
export const SUGGESTION_RETENTION_DAYS = 365;

/**
 * The most suggestions taken in one UTC day from one sender (by a salted hash of their address, kept only for that
 * day), and from everyone, so a flood cannot bury the rest or fill the database.
 */
export const SUGGESTIONS_PER_SENDER_PER_DAY = 5;
export const SUGGESTIONS_PER_DAY = 300;

/** A message with more links than this is marked as possible spam (it is still kept for a person to judge). */
export const SUGGESTION_LINKS_FLAGGED = 3;

/** `POST /v1/suggestions` */
export const suggestionSchema = z
  .strictObject({
    topic: z.enum(SUGGESTION_TOPICS),
    message: text(SUGGESTION_LIMITS.message).pipe(
      z.string().min(SUGGESTION_LIMITS.minMessage, `write at least ${SUGGESTION_LIMITS.minMessage} characters`),
    ),
    name: oneLine(SUGGESTION_LIMITS.name).default(''),
    email: z
      .string()
      .trim()
      .max(SUGGESTION_LIMITS.email)
      .default('')
      .pipe(z.union([z.literal(''), z.email('enter an email address, or leave it empty')])),
    /** The sender agrees their name and email are kept for a reply: required when they give either. */
    consent: z.boolean().default(false),
    /** Left empty by people; a form filler that fills every field fills this too, and what it sends is dropped. */
    website: z.string().max(500).default(''),
  })
  .superRefine((v, ctx) => {
    if ((v.name || v.email) && !v.consent) {
      ctx.addIssue({ code: 'custom', path: ['consent'], message: 'tick this to let us keep your name and email to reply, or leave them empty' });
    }
  });
export type SuggestionInput = z.infer<typeof suggestionSchema>;

/** `suggestions/{suggestionId}` */
export interface SuggestionRecord {
  readonly suggestionId: string;
  readonly topic: SuggestionTopic;
  readonly message: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly receivedAt: string;
  readonly status: SuggestionStatus;
  /** It has many links: likely spam, for a person to judge. */
  readonly flagged: boolean;
  /** The team's own note on it. */
  readonly note: string;
  readonly handledAt: string | null;
  readonly handledBy: string | null;
}

/** How many links a message has. */
export function linkCount(message: string): number {
  return (message.match(/(https?:\/\/|www\.)\S+/gi) ?? []).length;
}

/** Whether what was sent is a person's suggestion (the trap field is empty) or a form filler's, which is dropped. */
export const isTrapped = (input: Pick<SuggestionInput, 'website'>) => input.website.trim() !== '';

export function newSuggestion(input: SuggestionInput, suggestionId: string, at: string): SuggestionRecord {
  return {
    suggestionId,
    topic: input.topic,
    message: input.message,
    name: input.name || null,
    email: input.email ? input.email.toLowerCase() : null,
    receivedAt: at,
    status: 'new',
    flagged: linkCount(input.message) > SUGGESTION_LINKS_FLAGGED,
    note: '',
    handledAt: null,
    handledBy: null,
  };
}

/** `PUT /v1/admin/communications/suggestions/{id}`: what the team did with it. */
export const suggestionTriageSchema = z.strictObject({
  status: z.enum(SUGGESTION_STATUSES),
  note: text(SUGGESTION_LIMITS.note),
});
export type SuggestionTriageInput = z.infer<typeof suggestionTriageSchema>;

export function triageSuggestion(s: SuggestionRecord, input: SuggestionTriageInput, actor: string, at: string): SuggestionRecord {
  if (s.status === input.status && s.note === input.note) return s;
  return { ...s, status: input.status, note: input.note, handledAt: at, handledBy: actor };
}

/** `suggestion_limits/{YYYY-MM-DD}`: that day's salt and counts, deleted the day after next. */
export interface SuggestionLimitsRecord {
  readonly day: string;
  /** Random, hex: senders' addresses are counted under SHA-256(salt + address), and the salt goes with the day. */
  readonly salt: string;
  readonly total: number;
  readonly senders: Readonly<Record<string, number>>;
}

/** Whether one more suggestion from this sender fits today's limits. */
export function checkSuggestionLimits(day: Pick<SuggestionLimitsRecord, 'total' | 'senders'> | null, sender: string): Check {
  if (!day) return OK;
  if (day.total >= SUGGESTIONS_PER_DAY) return refuse('rate_limited', 'we have had a great many suggestions today; please try again tomorrow');
  if ((day.senders[sender] ?? 0) >= SUGGESTIONS_PER_SENDER_PER_DAY) {
    return refuse('rate_limited', `that is ${SUGGESTIONS_PER_SENDER_PER_DAY} suggestions from you today, the most we take in a day; please send more tomorrow`);
  }
  return OK;
}

/** The UTC day of a time, `YYYY-MM-DD`. */
export const suggestionDay = (at: Date) => at.toISOString().slice(0, 10);

/** Before this time a suggestion is old enough to delete. */
export function suggestionsExpireBefore(now: Date): string {
  return new Date(now.getTime() - SUGGESTION_RETENTION_DAYS * 86_400_000).toISOString();
}
