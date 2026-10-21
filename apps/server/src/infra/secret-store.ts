import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { Firestore } from 'firebase-admin/firestore';

/** Small secrets the server must keep but never publish early, such as an election's tie-break seed (design §9). */
export interface SecretStore {
  /** Stores a new secret under a fresh ID and returns that ID (the reference, not the value). */
  create(prefix: string, value: string): Promise<string>;
  read(id: string): Promise<string | null>;
}

export const SECRET_STORE = Symbol('SecretStore');

/** Google Secret Manager, one secret per value. Needs `projectId` and secretmanager admin rights for the api account. */
export class SecretManagerStore implements SecretStore {
  private readonly client = new SecretManagerServiceClient();

  constructor(private readonly projectId: string | undefined) {}

  async create(prefix: string, value: string): Promise<string> {
    const parent = `projects/${this.requireProject()}`;
    const secretId = `${prefix}-${crypto.randomUUID()}`;
    await this.client.createSecret({ parent, secretId, secret: { replication: { automatic: {} } } });
    await this.client.addSecretVersion({ parent: `${parent}/secrets/${secretId}`, payload: { data: Buffer.from(value) } });
    return secretId;
  }

  async read(id: string): Promise<string | null> {
    const [version] = await this.client.accessSecretVersion({
      name: `projects/${this.requireProject()}/secrets/${id}/versions/latest`,
    });
    const data = version.payload?.data;
    return data ? Buffer.from(data).toString() : null;
  }

  private requireProject(): string {
    if (!this.projectId) throw new Error('Secret Manager needs GOOGLE_CLOUD_PROJECT');
    return this.projectId;
  }
}

/** Emulator-only stand-in: a Firestore collection. The server refuses to use it outside the emulators. */
export class EmulatorSecretStore implements SecretStore {
  constructor(private readonly db: Firestore) {}

  async create(prefix: string, value: string): Promise<string> {
    const id = `${prefix}-${crypto.randomUUID()}`;
    await this.db.collection('emulator_secrets').doc(id).create({ value, createdAt: new Date().toISOString() });
    return id;
  }

  async read(id: string): Promise<string | null> {
    const snap = await this.db.collection('emulator_secrets').doc(id).get();
    return (snap.data()?.value as string | undefined) ?? null;
  }
}
