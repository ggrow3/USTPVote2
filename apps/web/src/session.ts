import { onIdTokenChanged, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { reactive, readonly, watch } from 'vue';
import type { MeResponse, Role } from 'ustp-domain';
import { api } from './api.js';
import { auth } from './firebase.js';

/**
 * A plain copy of the Firebase user's fields the UI reads. Firebase mutates its own User object internally
 * (e.g. on reload), which Vue cannot observe, so the session keeps snapshots and replaces them instead.
 */
export interface SessionUser {
  readonly uid: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly displayName: string | null;
}

interface SessionState {
  /** The first auth state has arrived. */
  ready: boolean;
  /** The account for the current user is being loaded or created. */
  loading: boolean;
  user: SessionUser | null;
  me: MeResponse | null;
  error: string | null;
}

const state = reactive<SessionState>({ ready: false, loading: false, user: null, me: null, error: null });
export const session = readonly(state);

let markReady: () => void;
/** Resolves once the initial sign-in state (and account) is known. */
export const sessionReady = new Promise<void>((resolve) => (markReady = resolve));

function snapshot(user: User | null): SessionUser | null {
  return user && { uid: user.uid, email: user.email, emailVerified: user.emailVerified, displayName: user.displayName };
}

let lastUid: string | null = null;
onIdTokenChanged(auth, async (user) => {
  state.user = snapshot(user);
  if (!user) {
    state.me = null;
    lastUid = null;
  } else if (user.uid !== lastUid) {
    lastUid = user.uid;
    await loadAccount();
  }
  state.ready = true;
  markReady();
});

/**
 * Every signed-in user gets a USTP account (design §4). `POST /v1/accounts` is idempotent and also applies the
 * bootstrap admin grant once an email is verified, so it runs on each new sign-in and after verification.
 */
async function loadAccount(): Promise<void> {
  state.loading = true;
  try {
    state.error = null;
    await api('POST', '/v1/accounts');
    state.me = await api<MeResponse>('GET', '/v1/me');
  } catch (e) {
    state.me = null;
    state.error = e instanceof Error ? e.message : String(e);
  } finally {
    state.loading = false;
  }
}

/** Resolves once `uid` is the signed-in user and their account has finished loading. */
export function whenSignedIn(uid: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const stop = watch(
      () => [state.user?.uid, state.loading] as const,
      ([current, loading]) => {
        if (settled || current !== uid || loading) return;
        settled = true;
        queueMicrotask(() => stop());
        resolve();
      },
      { immediate: true },
    );
  });
}

export async function refreshMe(): Promise<void> {
  if (auth.currentUser) state.me = await api<MeResponse>('GET', '/v1/me');
}

/** Reloads the Firebase user (e.g. after email verification) and forces a fresh ID token. */
export async function refreshUser(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  await user.reload();
  await user.getIdToken(true);
  state.user = snapshot(auth.currentUser);
  await loadAccount();
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}

export function hasRole(...roles: Role[]): boolean {
  return roles.some((r) => state.me?.roles.includes(r));
}
