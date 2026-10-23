import type { ProblemDetails } from 'ustp-domain';
import { appCheckToken, auth } from './firebase.js';

/** An API error carrying the server's RFC 9457 problem details. */
export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
  }

  get status(): number {
    return this.problem.status;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** The current ID token and App Check token. */
async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const user = auth.currentUser;
  if (user) headers.authorization = `Bearer ${await user.getIdToken()}`;
  const appCheck = await appCheckToken();
  if (appCheck) headers['x-firebase-appcheck'] = appCheck;
  return headers;
}

/** Calls the same-origin API with JSON in and out. */
export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeaders()), accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return readJson<T>(res);
}

/** Uploads a file as the raw request body (profile photos). */
export async function apiUpload<T>(path: string, file: Blob): Promise<T> {
  const headers = { ...(await authHeaders()), accept: 'application/json', 'content-type': file.type };
  return readJson<T>(await fetch(path, { method: 'PUT', headers, body: file }));
}

/** Fetches a binary resource (e.g. a photo) that needs the caller's credentials, which an <img> cannot send. */
export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(path, { headers: await authHeaders() });
  if (!res.ok) throw await toError(res);
  return res.blob();
}

/** A user-facing message for any error thrown by `api` or the Firebase SDK. */
/**
 * Plain-language messages for sign-in errors. With email-enumeration protection on (design §4), a wrong password and
 * an unknown address both arrive as `auth/invalid-credential`, so the message must not say which.
 */
const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': "That email and password don't match. Check them, or use “Email me a link”.",
  'auth/invalid-login-credentials': "That email and password don't match. Check them, or use “Email me a link”.",
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes, then try again.',
  'auth/email-already-in-use': 'An account already uses this email. Sign in instead.',
  'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection and try again.',
  'auth/captcha-check-failed': "We couldn't confirm this sign-in came from a person. Reload the page and try again.",
  'auth/missing-recaptcha-token': "We couldn't confirm this sign-in came from a person. Reload the page and try again.",
  'auth/invalid-recaptcha-token': "We couldn't confirm this sign-in came from a person. Reload the page and try again.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  if (error instanceof Error) return error.message.replace(/^Firebase: /, '');
  return String(error);
}

async function readJson<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await toError(res);
  return (await res.json().catch(() => null)) as T;
}

async function toError(res: Response): Promise<ApiError> {
  const data: unknown = await res.json().catch(() => null);
  return new ApiError(
    isProblem(data) ? data : { type: 'about:blank', title: res.statusText || 'request failed', status: res.status },
  );
}

function isProblem(value: unknown): value is ProblemDetails {
  return typeof value === 'object' && value !== null && typeof (value as ProblemDetails).status === 'number';
}
