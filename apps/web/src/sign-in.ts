import {
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  OAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  updatePassword,
  verifyPasswordResetCode,
  type Auth,
  type AuthProvider,
  type User,
} from 'firebase/auth';
import { SET_PASSWORD_PATH, type SignInProvider } from 'ustp-domain';
import { passwordProblem } from './password-policy.js';

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PASSWORD_HINT, passwordProblem } from './password-policy.js';

export type FederatedProvider = Exclude<SignInProvider, 'password'>;

export const PROVIDER_LABELS: Record<SignInProvider, string> = {
  'google.com': 'Google',
  'microsoft.com': 'Microsoft',
  'apple.com': 'Apple',
  password: 'Email',
};

/**
 * The provider for a sign-in window. `loginHint`, for confirming who is signed in, opens Google's and Microsoft's
 * window on that account instead of their account chooser, so a browser signed in to several accounts does not offer
 * another one (Firebase refuses it as `auth/user-mismatch`). Apple takes no hint.
 */
export function providerFor(id: FederatedProvider, loginHint?: string | null): AuthProvider {
  const hint = loginHint ? { login_hint: loginHint } : null;
  if (id === 'google.com') {
    const google = new GoogleAuthProvider();
    if (hint) google.setCustomParameters(hint);
    return google;
  }
  const provider = new OAuthProvider(id);
  provider.addScope('email');
  if (hint && id === 'microsoft.com') provider.setCustomParameters(hint);
  return provider;
}

export function signInWithProvider(auth: Auth, id: FederatedProvider) {
  return signInWithPopup(auth, providerFor(id));
}

export function isFederatedProvider(id: string): id is FederatedProvider {
  return id === 'google.com' || id === 'microsoft.com' || id === 'apple.com';
}

/** Proves the signed-in user is still present, refreshing `auth_time` (design §10.2: approvals need ≤ 15 minutes). */
export function reauthenticate(user: User, method: { provider: FederatedProvider } | { password: string }) {
  return 'provider' in method
    ? reauthenticateWithPopup(user, providerFor(method.provider, user.email))
    : reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? '', method.password));
}

/**
 * How often the password appears in known breaches (design §4, Q9), from Have I Been Pwned's k-anonymity range API:
 * only the first 5 hex digits of its SHA-1 leave the browser, and padded responses hide which range was of interest.
 * Null when the service cannot be reached, so an outage does not stop anyone signing up.
 */
export async function breachCount(password: string): Promise<number | null> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } });
    if (!res.ok) return null;
    const suffix = hex.slice(5);
    for (const line of (await res.text()).split('\n')) {
      const [candidate, count] = line.trim().split(':');
      if (candidate === suffix) return Number(count);
    }
    return 0;
  } catch {
    return null;
  }
}

/** The chosen password breaks the policy or is breached, so the form can show the message on the password field. */
export class PasswordRejected extends Error {}

/**
 * Refuses a password that breaks the rule for `email`'s login or has appeared in a breach (design §4), before it
 * reaches Identity Platform.
 */
export async function checkNewPassword(password: string, email: string): Promise<void> {
  const problem = passwordProblem(password, email);
  if (problem) throw new PasswordRejected(problem);
  const breaches = await breachCount(password);
  if (breaches) {
    throw new PasswordRejected('This password has appeared in a data breach. Choose another (a few unrelated words work well).');
  }
}

/** Creates an email/password login and sends the verification email, whose link leads back to registering. */
export async function signUpWithPassword(auth: Auth, email: string, password: string) {
  await checkNewPassword(password, email);
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(credential.user, { url: `${location.origin}/register` });
  return credential;
}

export function signInWithPassword(auth: Auth, email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

/**
 * Emails a link to choose a new password (design §4), which opens the email-action page. Email-enumeration protection
 * answers the same whether or not the address has a login; where it is off (the Auth emulator), an unknown address is
 * treated as sent too, so the form never tells.
 */
export async function sendPasswordReset(auth: Auth, email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(auth, email, { url: `${location.origin}/signin` });
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code !== 'auth/user-not-found') throw e;
  }
}

/** The email address a password-reset link is for; rejects if the link has expired or has been used. */
export function passwordResetEmail(auth: Auth, oobCode: string): Promise<string> {
  return verifyPasswordResetCode(auth, oobCode);
}

/** Sets the password a reset link is for, after the same checks as signing up. Every session of that login ends. */
export async function resetPassword(auth: Auth, oobCode: string, email: string, password: string): Promise<void> {
  await checkNewPassword(password, email);
  await confirmPasswordReset(auth, oobCode, password);
}

/** How a password change ended: not made, made, or made with this session still to sign in again (see below). */
export type PasswordChange = 'cancelled' | 'changed' | 'sign-in-again';

/**
 * Changes the signed-in login's password (design §4): the same checks as signing up, then `reauthenticate` with the
 * current password (and the authenticator code if there is one), then the change. Identity Platform revokes the login's
 * sessions as it changes it, and the Auth emulator hands this one back a token with its old sign-in time, which the
 * routes that check revocation (admin routes, casting) refuse; so when the sign-in time has not moved, this session
 * re-authenticates with the new password too.
 */
export async function changePassword(
  user: User,
  current: string,
  replacement: string,
  reauthenticate: (password: string, step: 'confirm' | 'renew') => Promise<boolean>,
): Promise<PasswordChange> {
  await checkNewPassword(replacement, user.email ?? '');
  if (!(await reauthenticate(current, 'confirm'))) return 'cancelled';
  const signedInAt = (await user.getIdTokenResult()).authTime;
  await updatePassword(user, replacement);
  if ((await user.getIdTokenResult()).authTime !== signedInAt) return 'changed';
  try {
    return (await reauthenticate(replacement, 'renew')) ? 'changed' : 'sign-in-again';
  } catch {
    return 'sign-in-again';
  }
}

const EMAIL_LINK_KEY = 'ustp.emailLinkAddress';

/** Emails a sign-in link that opens `path` (the sign-in page by default), and remembers the address for when it does. */
export async function sendEmailLink(auth: Auth, email: string, path = '/signin'): Promise<void> {
  await sendSignInLinkToEmail(auth, email, { url: `${location.origin}${path}`, handleCodeInApp: true });
  try {
    localStorage.setItem(EMAIL_LINK_KEY, email);
  } catch {
    // Storage unavailable: the user will be asked for their email when they open the link.
  }
}

/**
 * Asks Identity Platform to email an added member its sign-in link, which opens the set-password page (design §5.13):
 * the welcome where the deployment sends no mail of its own. A Membership Admin's browser sends it for someone else,
 * so the address is not remembered here, and the member types it when they open the link.
 */
export function sendWelcomeLink(auth: Auth, email: string): Promise<void> {
  return sendSignInLinkToEmail(auth, email, { url: `${location.origin}${SET_PASSWORD_PATH}`, handleCodeInApp: true });
}

/**
 * Sets the signed-in person's password, under the same policy and breach check as signing up (design §4). A new
 * password ends every session of the login, and this one's tokens keep the earlier sign-in time, so the api's
 * revocation check (admin routes, casting) would refuse them: it signs in again with the new password at once.
 * Resolves false when that sign-in needs the second step; it has then signed out, and they sign in as usual.
 */
export async function setOwnPassword(auth: Auth, user: User, password: string): Promise<boolean> {
  await checkNewPassword(password, user.email ?? '');
  await updatePassword(user, password);
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? '', password));
    return true;
  } catch {
    await signOut(auth);
    return false;
  }
}

/** If the current URL is an email sign-in link, the address it was sent to (when this browser remembers it). */
export function pendingEmailLink(auth: Auth): { isLink: boolean; email: string | null } {
  if (!isSignInWithEmailLink(auth, location.href)) return { isLink: false, email: null };
  let email: string | null = null;
  try {
    email = localStorage.getItem(EMAIL_LINK_KEY);
  } catch {
    // ignore
  }
  return { isLink: true, email };
}

/** A sign-in link that can no longer sign anyone in: expired, used already, or not copied whole. */
export function isDeadLink(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'auth/expired-action-code' || code === 'auth/invalid-action-code';
}

export async function completeEmailLink(auth: Auth, email: string) {
  const credential = await signInWithEmailLink(auth, email, location.href);
  try {
    localStorage.removeItem(EMAIL_LINK_KEY);
  } catch {
    // ignore
  }
  return credential;
}
