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

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Calls the same-origin API with the current ID token and App Check token. */
export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const user = auth.currentUser;
  if (user) headers.authorization = `Bearer ${await user.getIdToken()}`;
  const appCheck = await appCheckToken();
  if (appCheck) headers['x-firebase-appcheck'] = appCheck;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      isProblem(data) ? data : { type: 'about:blank', title: res.statusText || 'request failed', status: res.status },
    );
  }
  return data as T;
}

/** A user-facing message for any error thrown by `api` or the Firebase SDK. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message.replace(/^Firebase: /, '');
  return String(error);
}

function isProblem(value: unknown): value is ProblemDetails {
  return typeof value === 'object' && value !== null && typeof (value as ProblemDetails).status === 'number';
}
