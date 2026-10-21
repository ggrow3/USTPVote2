import { utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { derSignatureToP1363, verifyEcdsaP256 } from './signature.js';

// Produced by OpenSSL (node:crypto `sign('sha256', data, p256Key)`), the DER form Cloud KMS also returns.
const OPENSSL = {
  pem: `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAElhBVI26UEMvEIXdBsJg0PY4o9Oyw
tGcKWTxcDFCQJw37f3Wa/C2jvYuCgwL3JWVDYyjegV1UYn++t+90KYQB7g==
-----END PUBLIC KEY-----
`,
  data: '{"index":1,"v":1}',
  signature: 'MEQCICyrXFX6vMvk3vVB9W0HRs/f7IUHDWE+94pNa+BRrcuSAiAoWWYg07z7JGsLSq+EqBoSlIBE1xXgIM1jO35oVxRzMg==',
};

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** r ‖ s to DER, as a KMS-style signer would hand it over. */
function p1363ToDer(sig: Uint8Array): Uint8Array {
  const int = (v: Uint8Array) => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    const body = v[i]! & 0x80 ? [0, ...v.subarray(i)] : [...v.subarray(i)];
    return [0x02, body.length, ...body];
  };
  const seq = [...int(sig.subarray(0, 32)), ...int(sig.subarray(32))];
  return Uint8Array.from([0x30, seq.length, ...seq]);
}

describe('ECDSA P-256 verification', () => {
  it('accepts an OpenSSL signature and rejects any change', async () => {
    const data = utf8ToBytes(OPENSSL.data);
    expect(await verifyEcdsaP256(OPENSSL.pem, data, OPENSSL.signature)).toBe(true);
    expect(await verifyEcdsaP256(OPENSSL.pem, utf8ToBytes('{"index":2,"v":1}'), OPENSSL.signature)).toBe(false);
    const flipped = Uint8Array.from(atob(OPENSSL.signature), (c) => c.charCodeAt(0));
    flipped[10]! ^= 1;
    expect(await verifyEcdsaP256(OPENSSL.pem, data, base64(flipped))).toBe(false);
  });

  it('round-trips Web Crypto signatures through DER, including short coordinates', async () => {
    const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
    const pem = `-----BEGIN PUBLIC KEY-----\n${base64(spki).replace(/(.{64})/g, '$1\n')}\n-----END PUBLIC KEY-----\n`;
    // Enough signatures that some have a coordinate with its top bit set (DER pads it) or a leading zero byte.
    for (let i = 0; i < 40; i++) {
      const data = utf8ToBytes(`message ${i}`);
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data));
      const der = p1363ToDer(raw);
      expect(derSignatureToP1363(der)).toEqual(raw);
      expect(await verifyEcdsaP256(pem, data, base64(der))).toBe(true);
    }
  });

  it('never throws on garbage', async () => {
    const data = utf8ToBytes(OPENSSL.data);
    expect(await verifyEcdsaP256('not a key', data, OPENSSL.signature)).toBe(false);
    expect(await verifyEcdsaP256(OPENSSL.pem, data, '%%%')).toBe(false);
    expect(await verifyEcdsaP256(OPENSSL.pem, data, base64(Uint8Array.of(0x30, 0x02, 0x02, 0x00)))).toBe(false);
  });

  it('rejects non-canonical DER', () => {
    const ok = Uint8Array.from(atob(OPENSSL.signature), (c) => c.charCodeAt(0));
    expect(() => derSignatureToP1363(Uint8Array.from([...ok, 0]))).toThrow(RangeError); // trailing byte
    const padded = Uint8Array.from([0x30, ok[1]! + 1, 0x02, ok[3]! + 1, 0x00, ...ok.subarray(4)]); // needless leading zero
    expect(() => derSignatureToP1363(padded)).toThrow(RangeError);
  });
});
