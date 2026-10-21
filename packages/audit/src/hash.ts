import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { canonicalize } from './jcs.js';

const HEX_32 = /^[0-9a-f]{64}$/;

/** True for a 32-byte value written as 64 lowercase hex digits (our hash and salt format). */
export function isHex32(value: unknown): value is string {
  return typeof value === 'string' && HEX_32.test(value);
}

export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
}

/** SHA-256 of the UTF-8 encoded RFC 8785 canonical form, as lowercase hex. */
export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalize(value));
}

export { bytesToHex, hexToBytes };
