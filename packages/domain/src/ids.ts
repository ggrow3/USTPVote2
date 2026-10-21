const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * RFC 9562 UUIDv7: 48-bit Unix-millisecond timestamp, then random bits. Used for account and election IDs.
 * IDs sort by creation time across milliseconds; order within one millisecond is random.
 */
export function uuidv7(nowMs: number = Date.now()): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs >= 2 ** 48) throw new RangeError('timestamp out of range');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let ts = nowMs;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 9562 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuidV7(value: unknown): value is string {
  return typeof value === 'string' && UUID_V7.test(value);
}

/** The creation time embedded in a UUIDv7, in Unix milliseconds. */
export function uuidv7Timestamp(id: string): number {
  if (!isUuidV7(id)) throw new TypeError('not a UUIDv7');
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
