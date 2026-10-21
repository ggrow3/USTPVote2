import { bytesToHex } from '@noble/hashes/utils.js';
import { hashCanonical, isHex32 } from './hash.js';

/** One contest's portion of a ballot, as committed to in the browser and published in a sealed block. */
export interface BallotPart {
  readonly v: 1;
  readonly electionId: string;
  readonly contestId: string;
  /** The contest selection (see ustp-tally): "yes" | "no" | "abstain", or an array of candidate ids. */
  readonly selection: unknown;
  /** 32 random bytes, lowercase hex. Makes identical selections produce unrelated commitments. */
  readonly salt: string;
}

/** 32 bytes from the platform CSPRNG (Web Crypto; available in browsers and Node ≥ 19). */
export function newSalt(): string {
  return bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/** commitment = H(JCS(part)). The Merkle leaf for the part in its sealed block. */
export function ballotPartCommitment(part: BallotPart): string {
  if (part.v !== 1) throw new TypeError(`unsupported ballot part version ${String(part.v)}`);
  if (!isHex32(part.salt)) throw new TypeError('salt must be 64 lowercase hex digits');
  return hashCanonical({
    v: part.v,
    electionId: part.electionId,
    contestId: part.contestId,
    selection: part.selection,
    salt: part.salt,
  });
}
