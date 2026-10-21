import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAppCheck, type AppCheck } from 'firebase-admin/app-check';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';
import { CONFIG, type ServerConfig } from '../config.js';

/**
 * Firebase Admin clients. Credentials come from Application Default Credentials (the Cloud Run service
 * account); against the emulators none are needed. Each Nest application gets its own Admin app instance
 * so tests can start and stop applications freely.
 */
@Injectable()
export class Firebase implements OnApplicationShutdown {
  readonly app: App;
  readonly db: Firestore;
  readonly auth: Auth;
  readonly appCheck: AppCheck;
  readonly storage: Storage;

  constructor(@Inject(CONFIG) config: ServerConfig) {
    this.app = initializeApp(config.projectId ? { projectId: config.projectId } : {}, `ustp-${randomUUID()}`);
    this.db = getFirestore(this.app);
    this.db.settings({ ignoreUndefinedProperties: true });
    this.auth = getAuth(this.app);
    this.appCheck = getAppCheck(this.app);
    this.storage = getStorage(this.app);
  }

  async onApplicationShutdown(): Promise<void> {
    await deleteApp(this.app);
  }
}
