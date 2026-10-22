import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptBallot, encryptBallot, type BallotPoolKeys } from './infra/ballot-pool.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/** Stands in for the worker's side: unwraps data keys with the private key, as KMS would. */
const keys: BallotPoolKeys = {
  create: async () => 'v1',
  isReady: async () => true,
  publicKey: async () => publicKey,
  unwrap: async (_version, wrapped) =>
    privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, wrapped),
};

const ballot = Buffer.from('[{"contestId":"chair","electionId":"e1","salt":"00","selection":["x"],"v":1}]');

describe('ballot-pool encryption', () => {
  it('round-trips a ballot and hides it, with a fresh data key every time', async () => {
    const entry = encryptBallot(publicKey, 'v1', 'e1', ballot);
    expect(entry).toMatchObject({ v: 1, keyVersion: 'v1' });
    expect(Buffer.from(entry.ciphertext, 'base64').includes(Buffer.from('chair'))).toBe(false);
    expect(await decryptBallot(keys, 'e1', entry)).toEqual(ballot);

    const again = encryptBallot(publicKey, 'v1', 'e1', ballot);
    expect(again.wrappedKey).not.toBe(entry.wrappedKey);
    expect(again.ciphertext).not.toBe(entry.ciphertext);
  });

  it('refuses an entry moved to another election or altered', async () => {
    const entry = encryptBallot(publicKey, 'v1', 'e1', ballot);
    await expect(decryptBallot(keys, 'e2', entry)).rejects.toThrow();
    const ciphertext = Buffer.from(entry.ciphertext, 'base64');
    ciphertext[0]! ^= 1;
    await expect(decryptBallot(keys, 'e1', { ...entry, ciphertext: ciphertext.toString('base64') })).rejects.toThrow();
  });
});
