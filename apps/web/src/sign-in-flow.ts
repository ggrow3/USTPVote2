import type { MultiFactorError, UserCredential } from 'firebase/auth';
import { ref, shallowRef } from 'vue';
import { errorMessage } from './api.js';
import { APP_NAME } from './app-name.js';
import { auth } from './firebase.js';
import { CODE_PATTERN, hasAuthenticatorHint, isSecondFactorChallenge, resolveWithAuthenticator } from './mfa.js';
import { whenSignedIn } from './session.js';

/**
 * Signing in from a page (the sign-in page, and the first step of registering): runs the sign-in or sign-up, asks for
 * the authenticator code when the account has two-step verification (design §4), and calls `onSignedIn` once the
 * account has loaded.
 */
export function useSignInFlow(onSignedIn: () => Promise<unknown> | void) {
  const busy = ref(false);
  const error = ref<string | null>(null);
  /** Set when the first step succeeded and the account needs its authenticator code. */
  const challenge = shallowRef<MultiFactorError | null>(null);
  const code = ref('');

  /** Runs `action`; it returns a credential when someone signed in, nothing when it only did something else. */
  async function run(action: () => Promise<UserCredential | void>): Promise<void> {
    busy.value = true;
    error.value = null;
    try {
      const credential = await action();
      if (!credential) return;
      challenge.value = null;
      await whenSignedIn(credential.user.uid);
      await onSignedIn();
    } catch (e) {
      if (isSecondFactorChallenge(e)) {
        if (hasAuthenticatorHint(auth, e)) challenge.value = e;
        else error.value = `This account's second step is not an authenticator app, which ${APP_NAME} does not support. Ask a System Admin for help.`;
        return;
      }
      error.value = errorMessage(e);
    } finally {
      busy.value = false;
    }
  }

  /** Second step of a sign-in that requires two-step verification. */
  function submitCode(): Promise<void> | void {
    const pending = challenge.value;
    if (!pending) return;
    if (!CODE_PATTERN.test(code.value.trim())) {
      error.value = 'Enter the 6-digit code from your authenticator app.';
      return;
    }
    return run(() => resolveWithAuthenticator(auth, pending, code.value));
  }

  return { busy, error, challenge, code, run, submitCode };
}
