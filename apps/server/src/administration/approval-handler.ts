import type { Transaction } from 'firebase-admin/firestore';
import type { Actor, ApprovalRequestRecord } from 'ustp-domain';
import type { LedgerEvent } from '../ledger/ledger.service.js';

/** What an approved (or rejected) request does, computed after all of the transaction's reads. */
export interface PreparedDecision {
  /** Ledger entries recording the effect, appended after `approval.decided`. */
  readonly events: readonly LedgerEvent[];
  /** The writes; called after the ledger append. */
  readonly apply: () => void;
}

export const NO_EFFECT: PreparedDecision = { events: [], apply: () => {} };

/**
 * Executes one kind of two-person action (design §10.2). Methods run inside the decision transaction and may only
 * read; they re-check every precondition, because things may have changed since the request.
 */
export interface ApprovalHandler {
  /** Optional work before the transaction (e.g. storing a secret); its result is passed to `approve`. */
  beforeApprove?(request: ApprovalRequestRecord): Promise<unknown>;
  approve(tx: Transaction, request: ApprovalRequestRecord, approver: Actor, prepared: unknown): Promise<PreparedDecision>;
  reject?(tx: Transaction, request: ApprovalRequestRecord): Promise<PreparedDecision>;
}
