import { sha256Hex, type InclusionProof, type LedgerBlock } from 'ustp-audit';
import type { LedgerEntry, LedgerEventType } from './ledger-events.js';

/**
 * Ledger blocks, signatures and anchors (design §8.3, §8.4). The block itself, its hash and its verification live in
 * `ustp-audit`; this module adds the stored and published shapes.
 */

/** A signature by the `audit-signing` key: ECDSA P-256 / SHA-256, ASN.1 DER as base64 (the form Cloud KMS returns). */
export interface SignatureRecord {
  /** The key version that signed: a Cloud KMS `cryptoKeyVersions/N` resource name, or `emulator/...` locally. */
  readonly keyVersion: string;
  readonly signature: string;
}

/** `blocks/{index}`: the block, its hash `H(JCS(block))` and the signature over `JCS(block)`. */
export interface LedgerBlockRecord extends LedgerBlock {
  readonly blockHash: string;
  readonly signature: SignatureRecord;
}

/** The content of an anchor object, `v1/blocks/{index}.json`: JCS of this, so it is byte-for-byte reproducible. */
export interface AnchorDocument {
  readonly v: 1;
  readonly block: LedgerBlock;
  readonly blockHash: string;
  readonly signature: SignatureRecord;
}

/** `anchors/{index}`: where block `index` was written outside Firestore. */
export interface AnchorRecord {
  readonly index: number;
  readonly blockHash: string;
  /** `gs://<bucket>/v1/blocks/<index>.json` */
  readonly uri: string;
  /** Cloud Storage object generation: with Bucket Lock, proof the object was written once. */
  readonly generation: string;
  readonly anchoredAt: string;
}

/** `signing_keys/{keyId}`: every key version that has signed, with its public key, as first used. */
export interface SigningKeyRecord {
  /** First 16 hex digits of SHA-256(keyVersion); also the anchor object name `v1/keys/{keyId}.pem`. */
  readonly keyId: string;
  readonly keyVersion: string;
  readonly publicKeyPem: string;
  readonly firstUsedAt: string;
}

export function signingKeyId(keyVersion: string): string {
  return sha256Hex(keyVersion).slice(0, 16);
}

/**
 * Entry types anyone may read, with an inclusion proof in their block. Everything else (member status, identities,
 * roles, approvals, photos, sign-in settings) names people or internal settings and stays with Auditors (design §8.2).
 */
export const PUBLIC_LEDGER_EVENT_TYPES = [
  'bylaws.published',
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
  'position.defined',
  'position_term.created',
  'position_term.appointed',
  'position_term.ended',
] as const satisfies readonly LedgerEventType[];

export function isPublicLedgerEvent(type: LedgerEventType): boolean {
  return (PUBLIC_LEDGER_EVENT_TYPES as readonly LedgerEventType[]).includes(type);
}

/** `GET /v1/public/ledger/entries/{seq}`: a public entry and the proof that its block contains it. */
export interface PublicLedgerEntry {
  readonly entry: LedgerEntry;
  readonly block: LedgerBlockRecord;
  readonly proof: InclusionProof;
}

/** `GET /v1/admin/audit/verify`: the entry chain, then blocks and their signatures, then anchors. */
export type LedgerVerification =
  | {
      readonly ok: true;
      readonly entries: number;
      readonly head: string;
      readonly blocks: number;
      /** Entries recorded after the last block; the next tick blocks them. */
      readonly unblocked: number;
      readonly anchored: number;
    }
  | {
      readonly ok: false;
      readonly entries: number;
      readonly part: 'entry' | 'block' | 'anchor';
      /** Entry seq or block index, when the problem is with one. */
      readonly at: number | null;
      readonly reason: string;
    };

/** What `POST /tasks/tick` did (design §13). */
export interface TickResult {
  readonly poolKeysCreated: number;
  readonly electionsOpened: number;
  readonly electionsClosed: number;
  /** Ballots moved from pools (or roll-call participation) into sealed blocks. */
  readonly ballotsSealed: number;
  /** Sealed elections tallied into a signed results bundle. */
  readonly resultsComputed: number;
  /** Ballot-pool key versions destroyed (certified or cancelled elections). */
  readonly poolKeysDestroyed: number;
  readonly blocksSealed: number;
  readonly rollsSigned: number;
  readonly anchored: number;
  /** Election notices sent (or recorded in the outbox) this tick (design §6.8). */
  readonly noticesSent: number;
  /** Test emails sent to the Election Admins who asked for them (design §6.8). */
  readonly testEmailsSent: number;
  /** Welcome emails sent (or recorded in the outbox) to members a Membership Admin added (design §5.13). */
  readonly welcomeEmailsSent: number;
  /** Notice recipients the mail provider reported as bounced since the last tick (design §6.8). */
  readonly bouncesRecorded: number;
  /** Suggestions a year old, and the form's limits for days gone, deleted (design §10.9). */
  readonly suggestionsDeleted: number;
  /** The room's messages, done action items and finished questions past their time, and questions given up on (design §5.10). */
  readonly roomExpired: number;
}
