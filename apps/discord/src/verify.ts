import { createPublicKey, verify } from 'node:crypto';

/** What goes before a raw Ed25519 public key to make the DER form node:crypto reads. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const KEY = /^[0-9a-f]{64}$/i;
const SIGNATURE = /^[0-9a-f]{128}$/i;

/**
 * Whether Discord signed this request (design §10.18): an Ed25519 signature, by the application's key, over the
 * timestamp header followed by the body exactly as it arrived. Anything malformed is simply not signed.
 */
export function signedByDiscord(publicKey: string, signature: string | undefined, timestamp: string | undefined, body: Buffer): boolean {
  if (!signature || !timestamp || !KEY.test(publicKey) || !SIGNATURE.test(signature)) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.concat([Buffer.from(timestamp, 'utf8'), body]), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}
