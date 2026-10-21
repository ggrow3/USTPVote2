import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Role } from 'ustp-domain';
import { ApiModule } from '../api/api.module.js';
import { createFastifyApp } from '../common/create-app.js';
import { Firebase } from '../infra/firebase.js';

/** Helpers for integration tests that run against the Firebase emulators (`npm run test:int`). */

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-ustpvote';

export const SA1_EMAIL = 'sa1@example.test';
export const SA2_EMAIL = 'sa2@example.test';
const PASSWORD = 'correct horse battery staple';

if (!AUTH_HOST || !FIRESTORE_HOST) throw new Error('integration tests must run via `npm run test:int` (Firebase emulators)');
process.env.APP_CHECK_ENFORCED = 'false';
process.env.ADMIN_MFA_REQUIRED = 'false';
process.env.BOOTSTRAP_SYSTEM_ADMIN_EMAILS = `${SA1_EMAIL},${SA2_EMAIL}`;

export interface Response {
  readonly status: number;
  readonly body: any;
  readonly contentType: string | undefined;
}

export interface User {
  readonly email: string;
  readonly token: string;
  readonly uid: string;
}

export class TestApi {
  private constructor(readonly app: NestFastifyApplication) {}

  static async start(): Promise<TestApi> {
    const app = await createFastifyApp(ApiModule, { quiet: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return new TestApi(app);
  }

  get firebase(): Firebase {
    return this.app.get(Firebase);
  }

  async call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, user?: User, body?: unknown): Promise<Response> {
    const res = await this.app.inject({
      method,
      url,
      headers: user ? { authorization: `Bearer ${user.token}` } : {},
      ...(body !== undefined && { payload: body as object }),
    });
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : undefined,
      contentType: res.headers['content-type']?.toString(),
    };
  }

  /** Creates an email/password user in the Auth emulator and signs them in. */
  async user(email: string, { emailVerified = true } = {}): Promise<User> {
    const { uid } = await this.firebase.auth.createUser({ email, password: PASSWORD, emailVerified });
    return { email, uid, token: await signIn(email) };
  }

  /** A user with a USTP account. */
  async member(email: string): Promise<User & { accountId: string }> {
    const user = await this.user(email);
    const res = await this.call('POST', '/v1/accounts', user);
    if (res.status !== 201) throw new Error(`account creation failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { ...user, accountId: res.body.accountId };
  }

  /** The two bootstrap System Admins. */
  async systemAdmins() {
    return [await this.member(SA1_EMAIL), await this.member(SA2_EMAIL)] as const;
  }

  /** Grants a role through the two-person flow: one System Admin requests, the other approves. */
  async grant(accountId: string, role: Role, requester: User, approver: User): Promise<void> {
    const req = await this.call('POST', '/v1/admin/roles', requester, { accountId, role, change: 'grant', reason: 'test' });
    if (req.status !== 201) throw new Error(`role request failed: ${req.status} ${JSON.stringify(req.body)}`);
    const dec = await this.call('POST', `/v1/admin/approvals/${req.body.id}/decision`, approver, {
      decision: 'approve',
      reason: 'test',
    });
    if (dec.status !== 201) throw new Error(`role approval failed: ${dec.status} ${JSON.stringify(dec.body)}`);
  }

  async close(): Promise<void> {
    await this.app.close();
  }
}

export async function signIn(email: string): Promise<string> {
  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    },
  );
  if (!res.ok) throw new Error(`emulator sign-in failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { idToken: string }).idToken;
}

/** Empties Firestore and Auth in the emulators. */
export async function resetEmulators(): Promise<void> {
  const responses = await Promise.all([
    fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' }),
    fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' }),
  ]);
  for (const r of responses) if (!r.ok) throw new Error(`emulator reset failed: ${r.status}`);
}
