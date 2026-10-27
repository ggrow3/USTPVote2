/** Ledger entry types (design §8.2). Member- and identity-related entries are visible to Auditors only. */
export const LEDGER_EVENT_TYPES = [
  'member.status_changed',
  'member.details_changed',
  'identity.linked',
  'identity.unlinked',
  'bylaws.published',
  'role.granted',
  'role.revoked',
  'approval.requested',
  'approval.decided',
  'signin_method.changed',
  'navigation.changed',
  'anthropic_key.changed',
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
  'notice.resend_requested',
  'position.defined',
  'position_term.created',
  'position_term.ended',
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
