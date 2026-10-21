/** Ledger entry types (design §8.2). Member- and identity-related entries are visible to Auditors only. */
export const LEDGER_EVENT_TYPES = [
  'member.status_changed',
  'identity.linked',
  'identity.unlinked',
  'bylaws.published',
  'role.granted',
  'role.revoked',
  'approval.requested',
  'approval.decided',
  'signin_method.changed',
] as const;
export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

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
