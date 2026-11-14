import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { Firestore } from 'firebase-admin/firestore';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from './firebase.js';

/**
 * Small secrets the server must keep but never publish early, such as an election's tie-break seed (design §9), and the
 * Anthropic API key, a secret Terraform creates whose value people replace (design §5.6).
 */
export interface SecretStore {
  /** Stores a new secret under a fresh ID and returns that ID (the reference, not the value). */
  create(prefix: string, value: string): Promise<string>;
  /** The newest version's value. */
  read(id: string): Promise<string | null>;
  /**
   * The newest version's value and its name, in one call. For an account that may read a secret but not list its
   * versions (`secretAccessor`), which `latest` needs.
   */
  readVersion(id: string): Promise<{ readonly name: string; readonly value: string } | null>;
  /** Deletes the secret and every version of it; a secret that is already gone is not an error. */
  delete(id: string): Promise<void>;
  /** The newest enabled version of an existing secret, without its value; null when it has none. */
  latest(id: string): Promise<SecretVersion | null>;
  /** Adds the value as the newest version of an existing secret, destroys every older version, and returns the new one's name. */
  replace(id: string, value: string): Promise<string>;
  /** Destroys every version of an existing secret, keeping the secret. */
  clear(id: string): Promise<void>;
}

export interface SecretVersion {
  /** `projects/.../secrets/{id}/versions/{n}` (or the stand-in's own name). */
  readonly name: string;
  readonly createdAt: string;
}

export const SECRET_STORE = Symbol('SecretStore');

/** gRPC status NOT_FOUND, as the Secret Manager client reports it. */
const NOT_FOUND = 5;

type VersionState = string | number | null | undefined;
/** The client gives enum values as names; numbers are accepted too (ENABLED = 1, DESTROYED = 3). */
const isEnabled = (state: VersionState) => state === 'ENABLED' || state === 1;
const isDestroyed = (state: VersionState) => state === 'DESTROYED' || state === 3;
const versionNumber = (name: string | null | undefined) => Number(name?.split('/').pop() ?? 0);

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
 * account may access their versions (to read seeds back at tally). For the Anthropic API key the api account may add,
 * list and destroy versions but not read them (`secretVersionManager` on that secret alone).
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
    return (await this.readVersion(id))?.value ?? null;
  }

  async readVersion(id: string): Promise<{ name: string; value: string } | null> {
    // Secret Manager answers `versions/latest` with the name of the version it stood for.
    const [version] = await this.client.accessSecretVersion({
      name: `projects/${this.requireProject()}/secrets/${id}/versions/latest`,
    });
    const data = version.payload?.data;
    return data && version.name ? { name: version.name, value: Buffer.from(data).toString() } : null;
  }

  async delete(id: string): Promise<void> {
    try {
      await this.client.deleteSecret({ name: `projects/${this.requireProject()}/secrets/${id}` });
    } catch (e) {
      if ((e as { code?: number }).code !== NOT_FOUND) throw e;
    }
  }

  async latest(id: string): Promise<SecretVersion | null> {
    const [versions] = await this.client.listSecretVersions({ parent: this.secret(id) });
    const newest = versions.filter((v) => isEnabled(v.state)).sort((a, b) => versionNumber(b.name) - versionNumber(a.name))[0];
    if (!newest?.name) return null;
    const seconds = Number(newest.createTime?.seconds ?? 0);
    return { name: newest.name, createdAt: new Date(seconds * 1000 + Math.floor((newest.createTime?.nanos ?? 0) / 1e6)).toISOString() };
  }

  async replace(id: string, value: string): Promise<string> {
    const [version] = await this.client.addSecretVersion({ parent: this.secret(id), payload: { data: Buffer.from(value) } });
    await this.destroyVersions(id, version.name ?? null);
    return version.name!;
  }

  async clear(id: string): Promise<void> {
    await this.destroyVersions(id, null);
  }

  private async destroyVersions(id: string, keep: string | null): Promise<void> {
    const [versions] = await this.client.listSecretVersions({ parent: this.secret(id) });
    const doomed = versions.filter((v) => v.name && v.name !== keep && !isDestroyed(v.state));
    await Promise.all(doomed.map((v) => this.client.destroySecretVersion({ name: v.name! })));
  }

  private secret(id: string): string {
    return `projects/${this.requireProject()}/secrets/${id}`;
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

  async readVersion(id: string): Promise<{ name: string; value: string } | null> {
    const data = (await this.db.collection('emulator_secrets').doc(id).get()).data();
    return typeof data?.value === 'string' ? { name: `emulator_secrets/${id}/versions/${data.version ?? 1}`, value: data.value } : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.collection('emulator_secrets').doc(id).delete();
  }

  async latest(id: string): Promise<SecretVersion | null> {
    const data = (await this.db.collection('emulator_secrets').doc(id).get()).data();
    return data ? { name: `emulator_secrets/${id}/versions/${data.version ?? 1}`, createdAt: data.createdAt as string } : null;
  }

  async replace(id: string, value: string): Promise<string> {
    const ref = this.db.collection('emulator_secrets').doc(id);
    const version = await this.db.runTransaction(async (tx) => {
      const next = (((await tx.get(ref)).data()?.version as number | undefined) ?? 0) + 1;
      tx.set(ref, { value, createdAt: new Date().toISOString(), version: next });
      return next;
    });
    return `emulator_secrets/${id}/versions/${version}`;
  }

  async clear(id: string): Promise<void> {
    await this.db.collection('emulator_secrets').doc(id).delete();
  }
}
