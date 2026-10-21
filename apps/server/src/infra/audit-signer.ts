import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyEcdsaP256 } from 'ustp-audit';
import type { SignatureRecord } from 'ustp-domain';

/**
 * The `audit-signing` key (design §8.3): ECDSA P-256 / SHA-256 over ledger blocks and approved rolls. Only the worker
 * holds one; the api reads public keys from `signing_keys`, so a compromised api cannot sign.
 */
export interface AuditSigner {
  sign(data: Uint8Array): Promise<SignatureRecord>;
  /** The key version `sign` uses now, with its public key. */
  currentKey(): Promise<{ readonly keyVersion: string; readonly publicKeyPem: string }>;
}

export const AUDIT_SIGNER = Symbol('AuditSigner');

/**
 * Cloud KMS with an `EC_SIGN_P256_SHA256` key version. The worker's service account needs `roles/cloudkms.signer` and
 * `roles/cloudkms.publicKeyViewer` on that key; nobody else needs either.
 */
export class KmsAuditSigner implements AuditSigner {
  private readonly client = new KeyManagementServiceClient();
  private publicKey: Promise<string> | null = null;

  constructor(private readonly keyVersion: string | null) {}

  async sign(data: Uint8Array): Promise<SignatureRecord> {
    const name = this.requireKeyVersion();
    const digest = createHash('sha256').update(data).digest();
    const [response] = await this.client.asymmetricSign({ name, digest: { sha256: digest } });
    const raw = response.signature;
    if (!raw || response.name !== name) throw new Error('Cloud KMS returned no signature for the requested key version');
    const signature = typeof raw === 'string' ? raw : Buffer.from(raw).toString('base64');
    // Checking against the public key also catches corruption in transit, which KMS's CRC32C fields exist for.
    const { publicKeyPem } = await this.currentKey();
    if (!(await verifyEcdsaP256(publicKeyPem, data, signature))) throw new Error('the Cloud KMS signature does not verify');
    return { keyVersion: name, signature };
  }

  async currentKey(): Promise<{ keyVersion: string; publicKeyPem: string }> {
    const name = this.requireKeyVersion();
    if (!this.publicKey) {
      const pending = this.client.getPublicKey({ name }).then(([key]) => {
        if (!key.pem) throw new Error(`Cloud KMS has no public key for ${name}`);
        return key.pem;
      });
      pending.catch(() => {
        if (this.publicKey === pending) this.publicKey = null; // retry next time
      });
      this.publicKey = pending;
    }
    return { keyVersion: name, publicKeyPem: await this.publicKey };
  }

  private requireKeyVersion(): string {
    if (!this.keyVersion) throw new Error('ledger signing needs AUDIT_SIGNING_KEY_VERSION');
    return this.keyVersion;
  }
}

interface EmulatorKey {
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
}

/**
 * Emulator-only stand-in: a P-256 key kept in Firestore, created on first use, so every server process against the same
 * emulators shares it. The server refuses to use it outside the emulators.
 */
export class EmulatorAuditSigner implements AuditSigner {
  static readonly KEY_VERSION = 'emulator/audit-signing/1';

  constructor(private readonly db: Firestore) {}

  async sign(data: Uint8Array): Promise<SignatureRecord> {
    const { privateKeyPem } = await this.key();
    return { keyVersion: EmulatorAuditSigner.KEY_VERSION, signature: sign('sha256', data, privateKeyPem).toString('base64') };
  }

  async currentKey(): Promise<{ keyVersion: string; publicKeyPem: string }> {
    return { keyVersion: EmulatorAuditSigner.KEY_VERSION, publicKeyPem: (await this.key()).publicKeyPem };
  }

  /** Not cached: tests wipe the emulators between cases. */
  private key(): Promise<EmulatorKey> {
    const ref = this.db.collection('emulator_secrets').doc('audit-signing-key');
    return this.db.runTransaction(async (tx) => {
      const existing = (await tx.get(ref)).data() as EmulatorKey | undefined;
      if (existing) return existing;
      const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const key: EmulatorKey = {
        privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      };
      tx.create(ref, key);
      return key;
    });
  }
}
