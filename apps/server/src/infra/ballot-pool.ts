import {
  constants,
  createCipheriv,
  createDecipheriv,
  generateKeyPair,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { promisify } from 'node:util';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import type { Firestore } from 'firebase-admin/firestore';
import type { PoolEntryRecord } from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from './firebase.js';

/**
 * Ballot-pool keys (design §7.3): one asymmetric key version per secret election. The api encrypts ballots to its
 * public key and so never holds anything that decrypts them; only the worker can unwrap a ballot's data key, through
 * Cloud KMS. Destroying the version after certification makes every copy of the pool, backups included, unreadable.
 */
export interface BallotPoolKeys {
  /** Worker: a new key version for one election; returns its name. */
  create(electionId: string): Promise<string>;
  /** Worker: true once the version can be used (Cloud KMS generates asymmetric keys asynchronously). */
  isReady(keyVersion: string): Promise<boolean>;
  /** api: the public key ballots are encrypted to. */
  publicKey(keyVersion: string): Promise<string>;
  /** Worker, when sealing (M3b): recovers one ballot's data key. */
  unwrap(keyVersion: string, wrappedKey: Buffer): Promise<Buffer>;
  /**
   * Worker, once an election is certified or cancelled (M4b): destroys the version, so no copy of its pool can ever be
   * decrypted again. Idempotent.
   */
  destroy(keyVersion: string): Promise<void>;
}

export const BALLOT_POOL_KEYS = Symbol('BallotPoolKeys');

/** Both services use the same keys; IAM decides what each may do with them. */
export const ballotPoolKeysProvider = {
  provide: BALLOT_POOL_KEYS,
  inject: [CONFIG, Firebase],
  useFactory: (config: ServerConfig, firebase: Firebase): BallotPoolKeys =>
    config.ballotPool === 'emulator' ? new EmulatorBallotPoolKeys(firebase.db) : new KmsBallotPoolKeys(config.ballotPoolKey),
};

const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' } as const;

/**
 * Encrypts one ballot: AES-256-GCM under a fresh 32-byte data key, with the election ID as associated data so a
 * ciphertext cannot be moved to another election's pool; the data key is wrapped with RSA-OAEP-SHA256.
 */
export function encryptBallot(publicKeyPem: string, keyVersion: string, electionId: string, plaintext: Uint8Array): PoolEntryRecord {
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
  cipher.setAAD(Buffer.from(electionId));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const wrappedKey = publicEncrypt({ key: publicKeyPem, ...OAEP }, dataKey);
  dataKey.fill(0);
  return {
    v: 1,
    keyVersion,
    wrappedKey: wrappedKey.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/** The inverse of `encryptBallot`; throws if anything was altered or the entry belongs to another election. */
export async function decryptBallot(keys: BallotPoolKeys, electionId: string, entry: PoolEntryRecord): Promise<Buffer> {
  const dataKey = await keys.unwrap(entry.keyVersion, Buffer.from(entry.wrappedKey, 'base64'));
  try {
    const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(entry.iv, 'base64'));
    decipher.setAAD(Buffer.from(electionId));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, 'base64')), decipher.final()]);
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Cloud KMS: versions of one `ASYMMETRIC_DECRYPT` key with algorithm `RSA_DECRYPT_OAEP_3072_SHA256`. The worker's
 * service account needs `cloudkms.cryptoKeyVersions.create`, `.get` and `.useToDecrypt` on it; the api's needs only
 * `roles/cloudkms.publicKeyViewer`.
 */
export class KmsBallotPoolKeys implements BallotPoolKeys {
  private readonly client = new KeyManagementServiceClient();
  private readonly publicKeys = new Map<string, Promise<string>>();

  constructor(private readonly keyName: string | null) {}

  async create(): Promise<string> {
    const [version] = await this.client.createCryptoKeyVersion({ parent: this.requireKey(), cryptoKeyVersion: {} });
    if (!version.name) throw new Error('Cloud KMS created a key version without a name');
    return version.name;
  }

  async isReady(keyVersion: string): Promise<boolean> {
    const [version] = await this.client.getCryptoKeyVersion({ name: this.own(keyVersion) });
    return version.state === 'ENABLED';
  }

  publicKey(keyVersion: string): Promise<string> {
    const name = this.own(keyVersion);
    let key = this.publicKeys.get(name);
    if (!key) {
      key = this.client.getPublicKey({ name }).then(([k]) => {
        if (!k.pem) throw new Error(`Cloud KMS has no public key for ${name}`);
        return k.pem;
      });
      key.catch(() => this.publicKeys.delete(name)); // retry next time
      this.publicKeys.set(name, key);
    }
    return key;
  }

  async unwrap(keyVersion: string, wrappedKey: Buffer): Promise<Buffer> {
    const [result] = await this.client.asymmetricDecrypt({ name: this.own(keyVersion), ciphertext: wrappedKey });
    if (!result.plaintext) throw new Error('Cloud KMS returned no plaintext');
    return Buffer.from(result.plaintext as Uint8Array);
  }

  /** Schedules destruction (Cloud KMS keeps the version restorable for the key's destroy window, 24 hours here). */
  async destroy(keyVersion: string): Promise<void> {
    const name = this.own(keyVersion);
    const [version] = await this.client.getCryptoKeyVersion({ name });
    if (version.state === 'DESTROY_SCHEDULED' || version.state === 'DESTROYED') return;
    await this.client.destroyCryptoKeyVersion({ name });
    this.publicKeys.delete(name);
  }

  /** Only versions of the configured key, so an altered election document cannot point the api at another key. */
  private own(keyVersion: string): string {
    if (!keyVersion.startsWith(`${this.requireKey()}/cryptoKeyVersions/`)) {
      throw new Error(`${keyVersion} is not a version of the ballot-pool key`);
    }
    return keyVersion;
  }

  private requireKey(): string {
    if (!this.keyName) throw new Error('secret ballots need BALLOT_POOL_KEY');
    return this.keyName;
  }
}

interface EmulatorPoolKey {
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
}

const generateRsa = promisify(generateKeyPair);

/** Emulator-only stand-in: RSA-3072 key pairs kept in Firestore. The server refuses to use it outside the emulators. */
export class EmulatorBallotPoolKeys implements BallotPoolKeys {
  static readonly PREFIX = 'emulator/ballot-pool/';

  constructor(private readonly db: Firestore) {}

  async create(electionId: string): Promise<string> {
    const { publicKey, privateKey } = await generateRsa('rsa', {
      modulusLength: 3072,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const keyVersion = `${EmulatorBallotPoolKeys.PREFIX}${electionId}-${randomUUID()}`;
    const key: EmulatorPoolKey = { publicKeyPem: publicKey, privateKeyPem: privateKey };
    await this.ref(keyVersion).create(key);
    return keyVersion;
  }

  async isReady(keyVersion: string): Promise<boolean> {
    return (await this.ref(keyVersion).get()).exists;
  }

  async publicKey(keyVersion: string): Promise<string> {
    return (await this.key(keyVersion)).publicKeyPem;
  }

  async unwrap(keyVersion: string, wrappedKey: Buffer): Promise<Buffer> {
    return privateDecrypt({ key: (await this.key(keyVersion)).privateKeyPem, ...OAEP }, wrappedKey);
  }

  async destroy(keyVersion: string): Promise<void> {
    await this.ref(keyVersion).delete();
  }

  private async key(keyVersion: string): Promise<EmulatorPoolKey> {
    const key = (await this.ref(keyVersion).get()).data() as EmulatorPoolKey | undefined;
    if (!key) throw new Error(`no emulator ballot-pool key ${keyVersion}`);
    return key;
  }

  private ref(keyVersion: string) {
    if (!keyVersion.startsWith(EmulatorBallotPoolKeys.PREFIX)) throw new Error(`${keyVersion} is not an emulator pool key`);
    return this.db.collection('emulator_secrets').doc(`ballot-pool-${keyVersion.slice(EmulatorBallotPoolKeys.PREFIX.length)}`);
  }
}
