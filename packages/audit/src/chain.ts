import { hashCanonical, isHex32 } from './hash.js';

/** `prevHash` of the first record in a chain. */
export const GENESIS_HASH = '0'.repeat(64);

export type Chained<T extends object> = T & { readonly prevHash: string; readonly hash: string };

/** Appends `body` after a record whose hash is `prevHash`: hash = H(JCS(body + prevHash)). */
export function linkRecord<T extends object>(body: T, prevHash: string): Chained<T> {
  if ('hash' in body || 'prevHash' in body) throw new TypeError('body must not contain hash or prevHash');
  if (!isHex32(prevHash)) throw new TypeError('prevHash must be 64 lowercase hex digits');
  const unhashed = { ...body, prevHash };
  return { ...unhashed, hash: hashCanonical(unhashed) };
}

/** The hash a chained record should carry: H(JCS(record without its `hash` field)). */
export function recordHash(record: { readonly hash?: unknown }): string {
  const { hash: _ignored, ...rest } = record;
  return hashCanonical(rest);
}

export type ChainCheck = { readonly ok: true; readonly head: string } | { readonly ok: false; readonly index: number; readonly reason: string };

/** Verifies hashes and links in order, starting from `startPrevHash` (genesis by default). */
export function verifyChain(
  records: readonly { readonly prevHash: string; readonly hash: string }[],
  startPrevHash: string = GENESIS_HASH,
): ChainCheck {
  let expectedPrev = startPrevHash;
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.prevHash !== expectedPrev) return { ok: false, index: i, reason: 'prevHash does not match previous record' };
    if (recordHash(record) !== record.hash) return { ok: false, index: i, reason: 'hash does not match record contents' };
    expectedPrev = record.hash;
  }
  return { ok: true, head: expectedPrev };
}
