import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Role } from 'ustp-domain';
import { ApiModule } from '../api/api.module.js';
import { createFastifyApp } from '../common/create-app.js';
import { Firebase } from '../infra/firebase.js';
import { WorkerModule } from '../worker/worker.module.js';

/** Helpers for integration tests that run against the Firebase emulators (`npm run test:int`). */

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const STORAGE_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-ustpvote';

export const SA1_EMAIL = 'sa1@example.test';
export const SA2_EMAIL = 'sa2@example.test';
/** Accounts with these emails may be deleted by a System Admin, if they are not members (design §4). */
export const DELETABLE_EMAILS = ['leaving@example.test', 'leaving-member@example.test'] as const;
const PASSWORD = 'correct horse battery staple';

if (!AUTH_HOST || !FIRESTORE_HOST || !STORAGE_HOST) {
  throw new Error('integration tests must run via `npm run test:int` (Firebase emulators)');
}
process.env.APP_CHECK_ENFORCED = 'false';
process.env.ADMIN_MFA_REQUIRED = 'false';
process.env.BOOTSTRAP_SYSTEM_ADMIN_EMAILS = `${SA1_EMAIL},${SA2_EMAIL}`;
process.env.DELETABLE_ACCOUNT_EMAILS = DELETABLE_EMAILS.join(',');
// Candidacies look districts up in a few made-up ones, not the Census Bureau: tests do not reach the internet.
process.env.DISTRICTS = 'local';
// The Bills page searches a few fixture bills, not Congress.gov and GovInfo (design §5.14).
process.env.BILLS = 'local';

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

  async call(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    user?: User,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const res = await this.app.inject({
      method,
      url,
      headers: { ...headers, ...(user && { authorization: `Bearer ${user.token}` }) },
      ...(body !== undefined && { payload: body as object }),
    });
    return {
      status: res.statusCode,
      body: res.body && res.headers['content-type']?.toString().includes('json') ? JSON.parse(res.body) : undefined,
      contentType: res.headers['content-type']?.toString(),
    };
  }

  /** Sends raw bytes (an image upload) with the given content type. */
  async upload(url: string, user: User, bytes: Buffer, contentType: string): Promise<Response> {
    const res = await this.app.inject({
      method: 'PUT',
      url,
      headers: { authorization: `Bearer ${user.token}`, 'content-type': contentType },
      payload: bytes,
    });
    return {
      status: res.statusCode,
      body: res.headers['content-type']?.toString().includes('json') ? JSON.parse(res.body) : undefined,
      contentType: res.headers['content-type']?.toString(),
    };
  }

  /** Raw response bytes (image endpoints). */
  async bytes(url: string, user: User): Promise<{ status: number; data: Buffer; contentType: string | undefined }> {
    const res = await this.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${user.token}` } });
    return { status: res.statusCode, data: res.rawPayload, contentType: res.headers['content-type']?.toString() };
  }

  /** Creates an email/password user in the Auth emulator and signs them in. */
  async user(email: string, { emailVerified = true } = {}): Promise<User> {
    const { uid } = await this.firebase.auth.createUser({ email, password: PASSWORD, emailVerified });
    return { email, uid, token: await signIn(email) };
  }

  /**
   * A user with an enrolled second factor, signed in through the full two-step flow. The Auth emulator supports
   * SMS factors but not TOTP; the server only checks that a second factor was used, so either proves the path.
   */
  async userWithMfa(email: string): Promise<User> {
    const { uid } = await this.firebase.auth.createUser({
      email,
      password: PASSWORD,
      emailVerified: true,
      multiFactor: { enrolledFactors: [{ factorId: 'phone', phoneNumber: '+15555550100', displayName: 'test phone' }] },
    });
    return { email, uid, token: await signInWithMfa(email) };
  }

  /** A user with a USTP account. */
  async member(email: string, { mfa = false } = {}): Promise<User & { accountId: string }> {
    const user = mfa ? await this.userWithMfa(email) : await this.user(email);
    const res = await this.call('POST', '/v1/accounts', user);
    if (res.status !== 201) throw new Error(`account creation failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { ...user, accountId: res.body.accountId };
  }

  /** The two bootstrap System Admins. */
  async systemAdmins() {
    return [await this.member(SA1_EMAIL), await this.member(SA2_EMAIL)] as const;
  }

  /** Grants a role as `by`, a System Admin; it takes effect at once (design §10.2). */
  async grant(accountId: string, role: Role, by: User): Promise<void> {
    const res = await this.call('POST', '/v1/admin/roles', by, { accountId, role, change: 'grant', reason: 'test' });
    if (res.status !== 201) throw new Error(`role change failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  async close(): Promise<void> {
    await this.app.close();
  }
}

/** The worker against the same emulators, as Cloud Scheduler would call it. */
export class TestWorker {
  private constructor(readonly app: NestFastifyApplication) {}

  static async start(): Promise<TestWorker> {
    const app = await createFastifyApp(WorkerModule, { quiet: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return new TestWorker(app);
  }

  async tick(): Promise<Response> {
    const res = await this.app.inject({ method: 'POST', url: '/tasks/tick' });
    return { status: res.statusCode, body: JSON.parse(res.body), contentType: res.headers['content-type']?.toString() };
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

async function authEmulator<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/${path}?key=fake-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Password, then the SMS challenge, using the code the emulator records instead of sending. */
export async function signInWithMfa(email: string): Promise<string> {
  const first = await authEmulator<{ mfaPendingCredential?: string; mfaInfo?: { mfaEnrollmentId: string }[] }>(
    'v1/accounts:signInWithPassword',
    { email, password: PASSWORD, returnSecureToken: true },
  );
  const { mfaPendingCredential } = first;
  const mfaEnrollmentId = first.mfaInfo?.[0]?.mfaEnrollmentId;
  if (!mfaPendingCredential || !mfaEnrollmentId) throw new Error('expected a second-factor challenge');

  const start = await authEmulator<{ phoneResponseInfo: { sessionInfo: string } }>('v2/accounts/mfaSignIn:start', {
    mfaPendingCredential,
    mfaEnrollmentId,
    phoneSignInInfo: {},
  });
  const { sessionInfo } = start.phoneResponseInfo;
  const codes = (await (
    await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/verificationCodes`)
  ).json()) as { verificationCodes: { sessionInfo: string; code: string }[] };
  const code = codes.verificationCodes.find((c) => c.sessionInfo === sessionInfo)?.code;
  if (!code) throw new Error('the emulator recorded no verification code');

  const done = await authEmulator<{ idToken: string }>('v2/accounts/mfaSignIn:finalize', {
    mfaPendingCredential,
    phoneVerificationInfo: { sessionInfo, code },
  });
  return done.idToken;
}

/** Empties Firestore and Auth in the emulators. */
export async function resetEmulators(): Promise<void> {
  const responses = await Promise.all([
    fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' }),
    fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' }),
  ]);
  for (const r of responses) if (!r.ok) throw new Error(`emulator reset failed: ${r.status}`);
  await switchEmailOn();
}

/**
 * Email is off until a System Admin switches it on (design §10.12); the tests mostly exercise what it does when on, so a
 * reset leaves it on. The ones about it being off delete this document. Written directly, as version 0: it is the
 * starting state, not a System Admin's save, and no ledger entry goes with it.
 */
async function switchEmailOn(): Promise<void> {
  const res = await fetch(`http://${FIRESTORE_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/notice_settings/current`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: { allEmails: { booleanValue: true } } }),
  });
  if (!res.ok) throw new Error(`could not switch email on: ${res.status}`);
}
