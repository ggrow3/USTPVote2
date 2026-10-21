import { Dialog, Notify } from 'quasar';
import { PROBLEM_TYPES } from 'ustp-domain';
import { ApiError, errorMessage } from './api.js';
import { auth } from './firebase.js';
import { CODE_PATTERN, isSecondFactorChallenge, resolveWithAuthenticator } from './mfa.js';
import { router } from './router.js';
import { isFederatedProvider, reauthenticate } from './sign-in.js';

/** Asks for the written reason every admin decision requires (design §5.1). Resolves null if cancelled. */
export function askReason(title: string, message: string): Promise<string | null> {
  return ask(title, message, 'textarea', (v) => v.trim().length > 0).then((v) => v?.trim() ?? null);
}

/** Asks for a 6-digit authenticator code. Resolves null if cancelled. */
export function askCode(message = 'Enter the 6-digit code from your authenticator app.'): Promise<string | null> {
  return ask('Authenticator code', message, 'text', (v) => CODE_PATTERN.test(v.trim()));
}

function ask(title: string, message: string, type: 'text' | 'textarea' | 'password', isValid: (v: string) => boolean) {
  return new Promise<string | null>((resolve) => {
    Dialog.create({ title, message, prompt: { model: '', type, isValid }, cancel: true, persistent: true })
      .onOk((value: string) => resolve(value))
      .onCancel(() => resolve(null));
  });
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
    try {
      if (isFederatedProvider(provider)) {
        await reauthenticate(user, { provider });
      } else if (provider === 'password') {
        const password = await ask(
          'Confirm it is you',
          `Enter the password for ${user.email}. (If you sign in with email links, sign out and sign in again instead.)`,
          'password',
          (v) => v.length > 0,
        );
        if (password === null) return false;
        await reauthenticate(user, { password });
      } else {
        throw new Error('Sign out and sign in again to continue.');
      }
    } catch (e) {
      if (!isSecondFactorChallenge(e)) throw e;
      const code = await askCode();
      if (code === null) return false;
      await resolveWithAuthenticator(auth, e, code);
    }
    await user.getIdToken(true);
    return true;
  } catch (e) {
    Notify.create({ type: 'negative', message: errorMessage(e) });
    return false;
  }
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
