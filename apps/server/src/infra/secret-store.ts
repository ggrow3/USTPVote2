import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { Firestore } from 'firebase-admin/firestore';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from './firebase.js';

/** Small secrets the server must keep but never publish early, such as an election's tie-break seed (design §9). */
export interface SecretStore {
  /** Stores a new secret under a fresh ID and returns that ID (the reference, not the value). */
  create(prefix: string, value: string): Promise<string>;
  read(id: string): Promise<string | null>;
  /** Deletes the secret and every version of it; a secret that is already gone is not an error. */
  delete(id: string): Promise<void>;
}

export const SECRET_STORE = Symbol('SecretStore');

/** gRPC status NOT_FOUND, as the Secret Manager client reports it. */
const NOT_FOUND = 5;

/**
 * The api creates seeds when an election is scheduled and deletes them with a deleted election (design §6.1); the
 * worker reads them back to reveal them at tally (design §9).
 */
export const secretStoreProvider = {
  provide: SECRET_STORE,
  inject: [CONFIG, Firebase],
  useFactory: (config: ServerConfig, firebase: Firebase): SecretStore =>
    config.secretStore === 'emulator' ? new EmulatorSecretStore(firebase.db) : new SecretManagerStore(config.projectId),
};

/**
 * Google Secret Manager, one secret per value. Needs `projectId`; the api account creates secrets, and the worker
 * account may access their versions (to read seeds back at tally).
 */
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

  async delete(id: string): Promise<void> {
    try {
      await this.client.deleteSecret({ name: `projects/${this.requireProject()}/secrets/${id}` });
    } catch (e) {
      if ((e as { code?: number }).code !== NOT_FOUND) throw e;
    }
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

  async delete(id: string): Promise<void> {
    await this.db.collection('emulator_secrets').doc(id).delete();
  }
}
