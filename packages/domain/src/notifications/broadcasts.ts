import { z } from 'zod';
import { countryOf, DEFAULT_COUNTRY, isCountryCode } from '../membership/countries.js';
import { US_STATES } from '../membership/places.js';
import type { MemberRecord } from '../membership/records.js';
import type { NoticeHold } from './send-checks.js';
import type { NoticeOutcome } from './notices.js';

/**
 * An email a System or Membership Admin writes to members themselves (design §10.12): to all Active members, those in
 * chosen states or countries, or ones picked by hand, and among them only those who opted in to the newsletter or
 * announcements. Members who unsubscribed or whose email an admin stopped never get one, and each one sent is ledgered.
 * It goes through the same gate as all the site's email, a batch a tick, after any election email that is due.
 */

export const MAX_BROADCAST_SUBJECT = 150;
export const MAX_BROADCAST_BODY = 20_000;
/** How many members one email can name by hand; beyond this a place or everyone is the way. */
export const MAX_BROADCAST_PICKED = 500;

const STATE_CODES: ReadonlySet<string> = new Set(US_STATES.map((s) => s.code));

export const broadcastAudienceSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('all_active') }),
    z.strictObject({
      kind: z.literal('place'),
      countries: z.array(z.string().refine(isCountryCode, 'not a country')).max(300),
      states: z.array(z.string().refine((s) => STATE_CODES.has(s), 'not a US state')).max(60),
    }),
    z.strictObject({ kind: z.literal('picked'), accountIds: z.array(z.string().min(1).max(64)).min(1, 'pick at least one member').max(MAX_BROADCAST_PICKED) }),
  ])
  .refine((a) => a.kind !== 'place' || a.countries.length + a.states.length > 0, 'choose at least one state or country');
export type BroadcastAudience = z.infer<typeof broadcastAudienceSchema>;

/** `POST /v1/admin/mail/broadcasts/preview`. */
export const broadcastPreviewSchema = z.strictObject({ audience: broadcastAudienceSchema });

/** `POST /v1/admin/mail/broadcasts`: plain text, which the email escapes. Blank lines make paragraphs. */
export const broadcastSchema = z.strictObject({
  subject: z
    .string()
    .trim()
    .min(1, 'write a subject')
    .max(MAX_BROADCAST_SUBJECT)
    .refine((s) => !/[\r\n]/.test(s), 'a subject is one line'),
  body: z.string().trim().min(1, 'write the email').max(MAX_BROADCAST_BODY),
  audience: broadcastAudienceSchema,
});
export type BroadcastInput = z.infer<typeof broadcastSchema>;

type AudienceMember = Pick<MemberRecord, 'accountId' | 'status' | 'country' | 'state' | 'communications'>;

/**
 * Whether the audience takes in this member: Active ones only, whichever way they were chosen. In the United States a
 * state chosen counts, or the country; elsewhere the country.
 */
export function inBroadcastAudience(audience: BroadcastAudience, member: AudienceMember): boolean {
  if (member.status !== 'active') return false;
  if (audience.kind === 'all_active') return true;
  if (audience.kind === 'picked') return audience.accountIds.includes(member.accountId);
  const country = countryOf(member);
  return audience.countries.includes(country) || (country === DEFAULT_COUNTRY && !!member.state && audience.states.includes(member.state));
}

/** Whether the member asked for party email beyond election notices (design §5.2). */
export function hasOptedInToEmail(member: Pick<MemberRecord, 'communications'>): boolean {
  return !!(member.communications?.newsletter || member.communications?.announcements);
}

/** Why a member in the audience does not get it, first reason first; null when they do. */
export type BroadcastSkip = 'email_stopped' | 'unsubscribed' | 'not_opted_in' | 'no_address' | 'unverified' | 'undeliverable';

export function broadcastSkip(input: {
  readonly member: Pick<MemberRecord, 'communications'>;
  readonly mailbox: { readonly email: string | null; readonly verified: boolean } | undefined;
  readonly stop: 'email_stopped' | 'unsubscribed' | null;
  /** The address bounced for good, or was marked as spam. */
  readonly suppressed: boolean;
}): BroadcastSkip | null {
  if (input.stop) return input.stop;
  if (!hasOptedInToEmail(input.member)) return 'not_opted_in';
  if (!input.mailbox?.email) return 'no_address';
  if (!input.mailbox.verified) return 'unverified';
  return input.suppressed ? 'undeliverable' : null;
}

/** Who an audience comes to before it is sent: how many it takes in, how many get it, and why the rest do not. */
export interface BroadcastPreview {
  readonly matched: number;
  readonly willGet: number;
  readonly skipped: Readonly<Record<BroadcastSkip, number>>;
}

/**
 * `awaiting_approval`: System Admins have approval switched on (design §10.12), and none has approved it yet. `rejected`:
 * a System Admin would not send it. Then `preparing` and `sending` by the worker, and `done`; `cancelled` when stopped.
 */
export const BROADCAST_STATUSES = ['awaiting_approval', 'preparing', 'sending', 'done', 'cancelled', 'rejected'] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

/** `broadcasts/{broadcastId}`: what was written, and to whom in terms of the audience, kept for the record. */
export interface BroadcastRecord {
  readonly broadcastId: string;
  readonly subject: string;
  readonly body: string;
  readonly audience: BroadcastAudience;
  readonly status: BroadcastStatus;
  readonly createdBy: string;
  readonly createdAt: string;
  /** Who it came to when the worker prepared it; null before. */
  readonly preview: BroadcastPreview | null;
  readonly completedAt: string | null;
  /** Why nothing more goes for now: the email setup check is failing. */
  readonly held?: NoticeHold | null;
  /** Whether it needed a System Admin's approval, and what became of that; absent or null when it did not. */
  readonly approval?: BroadcastApproval | null;
}

/** A System Admin's decision on an email that needed one (design §10.12). Any System Admin decides, the sender included. */
export interface BroadcastApproval {
  readonly status: 'waiting' | 'approved' | 'rejected';
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  /** Why it was rejected, in the System Admin's words; null when approved. */
  readonly reason: string | null;
}

/** `POST /v1/admin/mail/broadcasts/{id}/reject`: why, for whoever wrote it. */
export const broadcastRejectSchema = z.strictObject({ reason: z.string().trim().min(1, 'say why').max(500) });
export type BroadcastRejectInput = z.infer<typeof broadcastRejectSchema>;

/** Waiting for a System Admin, or about to go or going: only one at a time. */
export function isBroadcastOpen(record: Pick<BroadcastRecord, 'status'>): boolean {
  return record.status === 'awaiting_approval' || record.status === 'preparing' || record.status === 'sending';
}

export const BROADCAST_RECIPIENT_STATUSES = ['pending', 'sending', 'sent', 'skipped', 'failed'] as const;
export type BroadcastRecipientStatus = (typeof BROADCAST_RECIPIENT_STATUSES)[number];

/** `broadcast_recipients/{broadcastId}_{accountId}`: one member's copy. Kept 180 days, and never their address. */
export interface BroadcastRecipientRecord {
  readonly broadcastId: string;
  readonly accountId: string;
  readonly status: BroadcastRecipientStatus;
  readonly outcome: NoticeOutcome | null;
  readonly messageId: string | null;
  readonly attempts: number;
  readonly claimedAt: string | null;
  readonly updatedAt: string;
}

export const BROADCAST_RECIPIENT_RETENTION_DAYS = 180;

/** How a sent email stands: its copies, and what the mail service reported of those it took. */
export interface BroadcastCounts {
  readonly pending: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
  readonly delivered: number;
  readonly bounced: number;
  readonly complained: number;
}

/** `GET /v1/admin/mail/broadcasts`: never who it went to, only how many. */
export interface BroadcastSummary extends Omit<BroadcastRecord, 'audience' | 'createdBy' | 'approval'> {
  /** For hand-picked members, how many rather than who. */
  readonly audience: { readonly kind: 'all_active' } | { readonly kind: 'place'; readonly countries: readonly string[]; readonly states: readonly string[] } | { readonly kind: 'picked'; readonly count: number };
  readonly createdByName: string | null;
  readonly counts: BroadcastCounts;
  /** The approval with who decided by name; null when none was needed. */
  readonly approval: (Omit<BroadcastApproval, 'decidedBy'> & { readonly decidedByName: string | null }) | null;
  /** Whether the caller wrote it, so may withdraw it while it waits. */
  readonly mine: boolean;
  /** For an email waiting for approval: how many it would come to now. */
  readonly willGetNow: number | null;
}

/** `GET /v1/admin/mail/broadcasts`. */
export interface BroadcastsView {
  /** Why no email can be sent now, in the admin's words; null when one can. */
  readonly blocked: string | null;
  /** The contact the emails give, for the preview. */
  readonly contact: string | null;
  /** Whether a System Admin must approve each email before it goes (Admin › Email › Settings). */
  readonly approvalRequired: boolean;
  /** Whether the caller may approve or reject: a System Admin. */
  readonly canApprove: boolean;
  /** Newest first, the last few. */
  readonly broadcasts: readonly BroadcastSummary[];
}

/** `notice.broadcast_requested`: the ledger cannot be erased, so never the members picked, and the body only as a hash. */
export interface BroadcastRequestedPayload {
  readonly broadcastId: string;
  readonly subject: string;
  readonly bodyHash: string;
  readonly audience: BroadcastSummary['audience'];
  readonly willGet: number;
  /** It waits for a System Admin's approval. Absent before approval existed. */
  readonly approvalRequired?: boolean;
}

/** `notice.broadcast_approved` / `notice.broadcast_rejected`: which email, and for a rejection why. */
export interface BroadcastDecidedPayload {
  readonly broadcastId: string;
  readonly subject: string;
  readonly reason?: string;
}

export function broadcastAudienceSummary(audience: BroadcastAudience): BroadcastSummary['audience'] {
  return audience.kind === 'picked' ? { kind: 'picked', count: audience.accountIds.length } : audience;
}
