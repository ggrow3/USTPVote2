/** Ledger entry types (design §8.2). Member-, identity- and account-related entries are visible to Auditors only. */
export const LEDGER_EVENT_TYPES = [
  'member.status_changed',
  'member.details_changed',
  'identity.linked',
  'identity.unlinked',
  'account.deleted',
  'bylaws.published',
  'registration_form.changed',
  'role.granted',
  'role.revoked',
  'approval.requested',
  'approval.decided',
  'signin_method.changed',
  'mfa_policy.changed',
  'navigation.changed',
  'home_quote.changed',
  'hub.changed',
  'analytics.changed',
  'anthropic_key.changed',
  'api_key.changed',
  'photo.decided',
  'roll.approved',
  'election.scheduled',
  'election.opened',
  'election.closed',
  'ballots.sealed',
  'election.sealed',
  'election.cancelled',
  'election.deleted',
  'results.computed',
  'results.certified',
  'election.pool_key_destroyed',
  'notice.sent',
  'notice.delivery_reported',
  'notice.resend_requested',
  'notice.settings_changed',
  'candidacy.changed',
  'area_contact.changed',
  'email_template.changed',
  'position.defined',
  'position_term.created',
  'position_term.appointed',
  'position_term.ended',
  'team.changed',
  'team.member_changed',
  'forum.moderated',
  'room.consent_changed',
  'room.assistant_switched',
  'room.settings_changed',
  'room.door_changed',
  'news.published',
  'news.changed',
  'news.withdrawn',
  'press_kit.changed',
  'share_post.changed',
  'bot.changed',
] as const;
export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

/**
 * A domain event as a context records it, before the ledger numbers and chains it into a `LedgerEntry` (design §8.2).
 * Recorded in the same transaction as the change it describes.
 */
export interface LedgerEvent {
  readonly type: LedgerEventType;
  readonly actor: string;
  readonly subject: string | null;
  /** Plain JSON only (it is JCS-hashed); no Firestore types or Dates. */
  readonly payload: Readonly<Record<string, unknown>>;
}

/** A ledger entry as stored in `audit_events/{seq}`: hash = H(JCS(entry without hash)). */
export interface LedgerEntry {
  readonly v: 1;
  readonly seq: number;
  readonly type: LedgerEventType;
  /** ISO 8601, server clock. */
  readonly at: string;
  /** accountId of the person who acted, or `system` / `bootstrap`. */
  readonly actor: string;
  /** accountId (or other ID) the entry is about, if any. */
  readonly subject: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly prevHash: string;
  readonly hash: string;
}
