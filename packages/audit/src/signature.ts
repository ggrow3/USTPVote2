/**
 * ECDSA P-256 / SHA-256 signatures in the form Cloud KMS produces them (`EC_SIGN_P256_SHA256`): an ASN.1 DER
 * `ECDSA-Sig-Value`, carried here as base64, with the public key as a PEM SubjectPublicKeyInfo. Checking one is the same
 * as `openssl dgst -sha256 -verify key.pem -signature sig.der data`. Verification uses Web Crypto, so it runs in
 * browsers and in Node alike.
 */

const COORDINATE_BYTES = 32;

/** True if `signatureBase64` is a valid signature of `data` by the key in `publicKeyPem`. Never throws. */
export async function verifyEcdsaP256(publicKeyPem: string, data: Uint8Array, signatureBase64: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('spki', pemToDer(publicKeyPem), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'verify',
    ]);
    const signature = derSignatureToP1363(fromBase64(signatureBase64));
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, new Uint8Array(data));
  } catch {
    return false; // malformed key or signature
  }
}

/** DER `SEQUENCE { INTEGER r, INTEGER s }` to the fixed-width r ‖ s form Web Crypto expects. */
export function derSignatureToP1363(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let pos = 0;
  const byte = () => {
    if (pos >= der.length) throw new RangeError('truncated signature');
    return der[pos++]!;
  };
  const length = () => {
    const first = byte();
    if (first < 0x80) return first;
    if (first !== 0x81) throw new RangeError('unsupported DER length');
    const long = byte();
    if (long < 0x80) throw new RangeError('non-minimal DER length');
    return long;
  };
  const integer = () => {
    if (byte() !== 0x02) throw new RangeError('expected an INTEGER');
    const len = length();
    if (len === 0 || pos + len > der.length) throw new RangeError('bad INTEGER length');
    let value = der.subarray(pos, pos + len);
    pos += len;
    if (value[0]! & 0x80) throw new RangeError('negative INTEGER');
    if (value.length > 1 && value[0] === 0 && !(value[1]! & 0x80)) throw new RangeError('non-minimal INTEGER');
    if (value[0] === 0) value = value.subarray(1);
    if (value.length > COORDINATE_BYTES) throw new RangeError('INTEGER too large for P-256');
    return value;
  };

  if (byte() !== 0x30) throw new RangeError('expected a SEQUENCE');
  if (length() !== der.length - pos) throw new RangeError('SEQUENCE length does not match');
  const r = integer();
  const s = integer();
  if (pos !== der.length) throw new RangeError('trailing bytes after signature');
  const out = new Uint8Array(COORDINATE_BYTES * 2);
  out.set(r, COORDINATE_BYTES - r.length);
  out.set(s, COORDINATE_BYTES * 2 - s.length);
  return out;
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const match = /-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----/.exec(pem);
  if (!match) throw new TypeError('expected a PEM public key');
  return fromBase64(match[1]!.replace(/\s+/g, ''));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
