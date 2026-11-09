import type { User } from 'firebase/auth';
import { Dialog, Notify, type QDialogOptions } from 'quasar';
import { PROBLEM_TYPES } from 'ustp-domain';
import { ApiError, errorMessage } from './api.js';
import { auth } from './firebase.js';
import { CODE_PATTERN, isSecondFactorChallenge, resolveWithAuthenticator } from './mfa.js';
import { router } from './router.js';
import { isFederatedProvider, reauthenticate } from './sign-in.js';

/** Asks for the written reason every admin decision requires (design §5.1). Resolves null if cancelled. */
export function askReason(title: string, message: string): Promise<string | null> {
  return ask(title, message, 'Reason', 'textarea', (v) => v.trim().length > 0).then((v) => v?.trim() ?? null);
}

/** Asks for a 6-digit authenticator code. Resolves null if cancelled. */
export function askCode(message = 'Enter the 6-digit code from your authenticator app.'): Promise<string | null> {
  return ask('Authenticator code', message, 'Code', 'text', (v) => CODE_PATTERN.test(v.trim()));
}

function ask(
  title: string,
  message: string,
  label: string,
  type: 'text' | 'textarea' | 'password',
  isValid: (v: string) => boolean,
) {
  return new Promise<string | null>((resolve) => {
    dialog({ title, message, prompt: { model: '', type, label, isValid }, cancel: true, persistent: true })
      .onOk((value: string) => resolve(value))
      .onCancel(() => resolve(null));
  });
}

/** Quasar's Dialog plugin, with the title as the dialog's accessible name (the plugin leaves the dialog unnamed). */
export function dialog(options: QDialogOptions) {
  return Dialog.create({ ...options, ...(options.title ? { 'aria-label': options.title } : {}) });
}

/**
 * Re-authenticates the signed-in user (password or provider popup, then the authenticator code if they have one),
 * so the next request carries a fresh sign-in time. Resolves false if cancelled or failed.
 */
export async function confirmIdentity(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  const provider = (await user.getIdTokenResult()).signInProvider ?? '';
  try {
    if (isFederatedProvider(provider)) return await withAuthenticatorCode(user, () => reauthenticate(user, { provider }));
    if (provider !== 'password') throw new Error('Sign out and sign in again to continue.');
    const password = await ask(
      'Confirm it is you',
      `Enter the password for ${user.email}. (If you sign in with email links, sign out and sign in again instead.)`,
      'Password',
      'password',
      (v) => v.length > 0,
    );
    if (password === null) return false;
    return await withAuthenticatorCode(user, () => reauthenticate(user, { password }));
  } catch (e) {
    Notify.create({ type: 'negative', message: errorMessage(e) });
    return false;
  }
}

/**
 * Re-authenticates the signed-in user with a password they typed in a form of their own (changing it, design §4), then
 * the authenticator code if they have one, asked for with `codeMessage`. Resolves false if the code was not given;
 * throws if either is wrong.
 */
export function confirmPassword(user: User, password: string, codeMessage?: string): Promise<boolean> {
  return withAuthenticatorCode(user, () => reauthenticate(user, { password }), codeMessage);
}

/** Runs the first step of a re-authentication, asks for the authenticator code if it needs one, then refreshes the token. */
async function withAuthenticatorCode(user: User, firstStep: () => Promise<unknown>, codeMessage?: string): Promise<boolean> {
  try {
    await firstStep();
  } catch (e) {
    if (!isSecondFactorChallenge(e)) throw e;
    const code = await askCode(codeMessage);
    if (code === null) return false;
    await resolveWithAuthenticator(auth, e, code);
  }
  await user.getIdToken(true);
  return true;
}

/**
 * Runs an action, toasting any error (and `success`, if given); returns whether it succeeded. If the API asks for a
 * fresher sign-in, re-authenticates and retries once; if it needs two-step verification, points to the setup.
 */
export async function attempt(action: () => Promise<unknown>, success?: string, retried = false): Promise<boolean> {
  try {
    await action();
    if (success) Notify.create({ type: 'positive', message: success });
    return true;
  } catch (e) {
    const type = e instanceof ApiError ? e.problem.type : null;
    if (type === PROBLEM_TYPES.reauthRequired && !retried) {
      return (await confirmIdentity()) && attempt(action, success, true);
    }
    Notify.create({
      type: 'negative',
      message: errorMessage(e),
      ...(type === PROBLEM_TYPES.mfaRequired && {
        timeout: 0,
        actions: [
          { label: 'Set up two-step verification', color: 'white', handler: () => void router.push('/account') },
          { label: 'Dismiss', color: 'white' },
        ],
      }),
    });
    return false;
  }
}
